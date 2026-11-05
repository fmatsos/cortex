import { join, relative, resolve } from "node:path";
import { z } from "zod";
import type { Mode } from "./backend";
import { guard } from "./claude";
import { confine } from "./sandbox";
import { LIMITS } from "../limits";
import { frontmatterError, identityChange, serializeDoc } from "../lib";

// --- The cortex tool pack: the tools every agent gets, whatever the backend. openai calls `callTool` in its own loop;
// the other backends reach the same pack over MCP (`cortex mcp --agent`, or in process for the Claude SDK).

type Prop = { type: "string" | "integer" | "object"; description: string };
export type ToolDef = { name: string; description: string; parameters: { type: "object"; properties: Record<string, Prop>; required: string[] } };

const str = (description: string): Prop => ({ type: "string", description });
const def = (name: string, description: string, properties: Record<string, Prop>, required = Object.keys(properties)): ToolDef =>
  ({ name, description, parameters: { type: "object", properties, required } });

// a long result comes in parts, never cut: each part says the offset of the next one
const offset: Prop = { type: "integer", description: "character to start from, for the next part of a long result (default 0)" };
const fm = (description: string): Prop => ({ type: "object", description });
const READ_TOOLS = [
  def("Read", "Read a file of the wiki repository.", { file_path: str("path, relative to the repository root"), offset }, ["file_path"]),
  def("Glob", "List the files matching a glob pattern.", { pattern: str("e.g. wiki/**/*.md"), offset }, ["pattern"]),
  def("Grep", "Lines matching a regular expression, in the files of a folder.", { pattern: str("regular expression"), path: str("folder, default: the root"), offset }, ["pattern"]),
  def("Bash", "Run one cortex command (cortex search, cortex log…), nothing else.", { command: str("e.g. cortex search \"term\""), offset }, ["command"]),
];
const WRITE_TOOLS = [
  def("NewPage", "Create a new wiki page: cortex names the file and writes the YAML frontmatter, then returns the path. Refused when a page has the same or a near title: complete that page instead.",
    { type: str("Source, Concept, Entity or Synthesis"), title: str("page title"), frontmatter: fm("other frontmatter fields, as in the schema (description, tags, sources…)"), body: str("Markdown after the frontmatter") }, ["type", "title", "body"]),
  def("WritePage", "Replace the content of an existing wiki page (Markdown under wiki/). Preferred for pages: cortex writes the YAML frontmatter.",
    { file_path: str("path under wiki/, ending in .md"), frontmatter: fm("frontmatter fields, as in the schema (type, title, description, status, sources…)"), body: str("Markdown after the frontmatter") }),
  def("Append", "Add text at the end of a file under wiki/: write a long page in parts (WritePage with the start, then Append).",
    { file_path: str("path under wiki/"), content: str("text to add, as is") }),
  def("Write", "Replace a file under wiki/ (a new page: NewPage).", { file_path: str("path under wiki/"), content: str("whole file content") }),
  def("Edit", "Replace one exact, unique string of a file under wiki/.", { file_path: str("path under wiki/"), old_string: str("exact text to replace"), new_string: str("replacement") }),
];

/** The tools of a mode: read mode never lists a writing tool. */
export const toolPack = (mode: Mode): ToolDef[] => (mode === "write" ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS);

/** Zod shape of a tool's parameters, for the MCP servers (they take zod, the OpenAI API takes the JSON schema above). */
export function zodShape(t: ToolDef): Record<string, z.ZodType> {
  const one = (p: Prop): z.ZodType => (p.type === "string" ? z.string() : p.type === "integer" ? z.number().int() : z.record(z.string(), z.unknown())).describe(p.description);
  return Object.fromEntries(Object.entries(t.parameters.properties).map(([k, p]) => [k, t.parameters.required.includes(k) ? one(p) : one(p).optional()]));
}

/**
 * MCP config that starts the pack for an agent CLI: `cortex mcp --agent <mode>` with this very cortex (the compiled
 * binary, or bun and the script), on `root`.
 */
export function packMcpConfig(root: string, mode: Mode): string {
  const self = /\.[jt]s$/.test(Bun.main) ? [process.execPath, Bun.main] : [process.execPath];
  return JSON.stringify({ mcpServers: { cortex: { command: self[0], args: [...self.slice(1), "mcp", "--agent", mode], env: { CORTEX_ROOT: root } } } });
}

/** One part of a tool result, from `from`; the rest is never dropped: the part names the offset of the next one. */
export function part(s: string, from = 0): string {
  const start = Math.max(0, Math.trunc(Number(from) || 0)), end = start + LIMITS.toolOutputChars;
  return end >= s.length ? s.slice(start) : `${s.slice(start, end)}\n[part ${start}–${end} of ${s.length} characters: call again with offset=${end} for the rest]`;
}

/**
 * Runs one tool call of the pack, the only entry point: path normalization, then `guard` (the same rule as the Claude
 * backend: reads in the repository, writes under wiki/, Bash limited to cortex), then the tool. The result, a refusal
 * or an error is text for the model. `refused` hears each refusal (a live notice).
 */
export async function callTool(root: string, mode: Mode, name: string, args: Record<string, any>, refused?: (reason: string) => void): Promise<string> {
  try {
    const a = { ...args };
    // the schema writes repo paths as `/raw/…`: a leading / outside the root means the repository root, not the system's
    for (const k of ["file_path", "path"]) if (typeof a[k] === "string" && a[k].startsWith("/") && !a[k].startsWith(root)) a[k] = "." + a[k];
    // WritePage, Append and NewPage write one page under wiki/: the Write rule (NewPage on a stand-in path)
    const v = guard(root, /^(WritePage|Append|NewPage)$/.test(name) ? "Write" : name, name === "NewPage" ? { ...a, file_path: "wiki/new.md" } : a, mode);
    if (!v.allow) { refused?.(v.reason); return v.reason; }
    return await exec(root, mode, name, a);
  } catch (e) { return `error: ${(e as Error).message}`; }
}

/** Runs one tool call already allowed by `guard`. */
async function exec(root: string, mode: Mode, name: string, a: Record<string, any>): Promise<string> {
  const abs = (p = ".") => resolve(root, p);
  // a page whose frontmatter does not parse never lands on disk, nor a page replacing another or created outside NewPage
  const save = async (path: string, text: string, done: string) => {
    const bad = path.endsWith(".md") && frontmatterError(text);
    if (bad) return `not written: ${bad} Or use WritePage, which writes the YAML for you.`;
    if (path.endsWith(".md")) {
      const f = Bun.file(abs(path)), rel = relative(root, abs(path));
      const clash = await f.exists() ? identityChange(rel, await f.text(), text) : `${rel} does not exist: create a new page with NewPage, which names the file.`;
      if (clash) return `not written: ${clash}`;
    }
    await Bun.write(abs(path), text);
    return done;
  };
  switch (name) {
    case "Read": return part(await Bun.file(abs(a.file_path)).text(), a.offset);
    case "Glob": return part([...new Bun.Glob(a.pattern).scanSync({ cwd: abs(a.path) })].sort().join("\n") || "(no file)", a.offset); // same base folder as the one `guard` checked
    case "Grep": {
      const re = new RegExp(a.pattern);
      const out: string[] = [];
      for (const f of [...new Bun.Glob("**/*").scanSync({ cwd: abs(a.path) })].sort()) { // sorted: every part sees the same order
        const p = join(abs(a.path), f);
        (await Bun.file(p).text()).split("\n").forEach((l, i) => { if (re.test(l)) out.push(`${relative(root, p)}:${i + 1}: ${l}`); });
      }
      return part(out.join("\n") || "(no match)", a.offset);
    }
    case "NewPage": {
      if (typeof a.type !== "string" || typeof a.title !== "string" || typeof a.body !== "string") return "type, title and body must be strings.";
      const extra = a.frontmatter && typeof a.frontmatter === "object" && !Array.isArray(a.frontmatter) ? { ...a.frontmatter } : {};
      delete extra.type; delete extra.title; // the tool arguments win
      const [{ newPageCtx }, { openWiki }] = await Promise.all([import("../naming"), import("../context")]);
      return `created ${await newPageCtx(openWiki(root), a.type, a.title, new Date(), { fm: extra, body: a.body })}`;
    }
    case "WritePage":
      if (!a.frontmatter || typeof a.frontmatter !== "object" || Array.isArray(a.frontmatter) || typeof a.body !== "string") return "frontmatter must be an object and body a string.";
      return save(a.file_path, serializeDoc(a.frontmatter, a.body), "written");
    case "Append": {
      if (typeof a.content !== "string") return "content must be a string.";
      const f = Bun.file(abs(a.file_path));
      return save(a.file_path, `${await f.exists() ? await f.text() : ""}${a.content}`, "appended");
    }
    case "Write":
      if (typeof a.content !== "string") return "content must be a string.";
      return save(a.file_path, a.content, "written");
    case "Edit": {
      if (typeof a.old_string !== "string" || typeof a.new_string !== "string") return "old_string and new_string must be strings.";
      const text = await Bun.file(abs(a.file_path)).text();
      if (text.split(a.old_string).length !== 2) return "old_string must occur exactly once in the file.";
      return save(a.file_path, text.replace(a.old_string, () => a.new_string), "edited");
    }
    case "Bash": {
      // guard allowed a single cortex command, quotes without expansion; sh only parses them, bwrap still confines it
      const p = Bun.spawn(confine(root, ["sh", "-c", a.command], mode), { cwd: root, stdout: "pipe", stderr: "pipe" });
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      return part(`${out}${err}${code ? `\n(exit ${code})` : ""}`, a.offset);
    }
  }
  return `unknown tool ${name}`;
}
