import { join, relative, resolve } from "node:path";
import { interactiveWith, type Backend, type Config, type Mode } from "./backend";
import { guard } from "./claude";
import { confine } from "./sandbox";
import { LIMITS } from "../limits";
import { frontmatterError, identityChange, serializeDoc } from "../lib";

// --- Any OpenAI-compatible API (Ollama, llama.cpp, LM Studio, vLLM, OpenRouter…): cortex runs the agent loop itself.
// The tools take Claude's names and fields, so every call goes through the same `guard` as the Claude backend.

const str = (description: string) => ({ type: "string", description });
const tool = (name: string, description: string, props: Record<string, object>, required = Object.keys(props)) =>
  ({ type: "function", function: { name, description, parameters: { type: "object", properties: props, required } } });

// a long result comes in parts, never cut: each part says the offset of the next one
const offset = { type: "integer", description: "character to start from, for the next part of a long result (default 0)" };
const READ_TOOLS = [
  tool("Read", "Read a file of the wiki repository.", { file_path: str("path, relative to the repository root"), offset }, ["file_path"]),
  tool("Glob", "List the files matching a glob pattern.", { pattern: str("e.g. wiki/**/*.md"), offset }, ["pattern"]),
  tool("Grep", "Lines matching a regular expression, in the files of a folder.", { pattern: str("regular expression"), path: str("folder, default: the root"), offset }, ["pattern"]),
  tool("Bash", "Run one cortex command (cortex search, cortex log…), nothing else.", { command: str("e.g. cortex search \"term\""), offset }, ["command"]),
];
const WRITE_TOOLS = [
  tool("WritePage", "Replace the content of a wiki page created by cortex new (Markdown under wiki/). Preferred for pages: cortex writes the YAML frontmatter.",
    { file_path: str("path under wiki/, ending in .md"), frontmatter: { type: "object", description: "frontmatter fields, as in the schema (type, title, description, status, sources…)" }, body: str("Markdown after the frontmatter") }),
  tool("Append", "Add text at the end of a file under wiki/: write a long page in parts (WritePage with the start, then Append).",
    { file_path: str("path under wiki/"), content: str("text to add, as is") }),
  tool("Write", "Create or replace a file under wiki/.", { file_path: str("path under wiki/"), content: str("whole file content") }),
  tool("Edit", "Replace one exact, unique string of a file under wiki/.", { file_path: str("path under wiki/"), old_string: str("exact text to replace"), new_string: str("replacement") }),
];

/** One part of a tool result, from `from`; the rest is never dropped: the part names the offset of the next one. */
export function part(s: string, from = 0): string {
  const start = Math.max(0, Math.trunc(Number(from) || 0)), end = start + LIMITS.toolOutputChars;
  return end >= s.length ? s.slice(start) : `${s.slice(start, end)}\n[part ${start}–${end} of ${s.length} characters: call again with offset=${end} for the rest]`;
}

/** Runs one tool call already allowed by `guard`; the result (or the error) goes back to the model as text. */
async function exec(root: string, mode: Mode, name: string, a: Record<string, any>): Promise<string> {
  const abs = (p = ".") => resolve(root, p);
  // a page whose frontmatter does not parse never lands on disk: the model gets the error at once, file unchanged
  const save = async (path: string, text: string, done: string) => {
    const bad = path.endsWith(".md") && frontmatterError(text);
    if (bad) return `not written: ${bad} Or use WritePage, which writes the YAML for you.`;
    if (path.endsWith(".md")) {
      const f = Bun.file(abs(path)), rel = relative(root, abs(path));
      const clash = await f.exists() ? identityChange(rel, await f.text(), text) : `${rel} does not exist: create a page with cortex new <Type> "<title>" (it prints the path), then fill it in with Edit or WritePage.`;
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

/**
 * `effort none` turns thinking off (Qwen3, DeepSeek…): the chat-template switch (vLLM, llama.cpp, OVMS) and Ollama's
 * `think`; servers ignore the field they do not know. Any other effort is sent as `reasoning_effort`.
 */
export const thinking = (effort?: string) =>
  effort === "none" ? { chat_template_kwargs: { enable_thinking: false }, think: false } : effort ? { reasoning_effort: effort } : {};

/** What the model is told when its tool calls were cut by the output limit: nothing ran, write in smaller parts. */
const CUT = `Your last answer exceeded the output limit (${LIMITS.llmMaxTokens} tokens) and was cut: none of its tool calls ran. ` +
  "Send fewer calls at once, and write a long page in parts: WritePage with the start, then Append for the rest.";

/** Base URL: `base_url` of cortex.json, else $OPENAI_BASE_URL, else a local Ollama. */
export const baseUrl = (cfg: Config) => (cfg.base_url ?? process.env.OPENAI_BASE_URL ?? "http://localhost:11434/v1").replace(/\/+$/, "");

export default function openai(cfg: Config): Backend {
  return {
    // no CLI to start: interactive only through $CORTEX_AGENT
    interactive: interactiveWith(() => { throw new Error("the openai client runs in batch only: use --batch (or set $CORTEX_AGENT)."); }),
    async run(root, prompt, mode, report, check) {
      if (!cfg.model) throw new Error(`the openai client needs a model: cortex config set model <name>.`);
      const { schemaText } = await import("../schema");
      const tools = mode === "write" ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS;
      const messages: any[] = [{ role: "system", content: await schemaText(root) }, { role: "user", content: prompt }];
      // secret: environment only. Never sent to a base_url that only cortex.json names: a cloned wiki could point it at any host.
      const key = !cfg.base_url || cfg.base_url === process.env.OPENAI_BASE_URL ? process.env.OPENAI_API_KEY : undefined;
      let fixes = 0, cuts = 0, text = ""; // text: the parts of a final answer cut by the output limit
      for (let turn = 0; turn < LIMITS.agentTurns; turn++) {
        const res = await fetch(`${baseUrl(cfg)}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(key && { authorization: `Bearer ${key}` }) },
          body: JSON.stringify({ model: cfg.model, messages, tools, max_tokens: LIMITS.llmMaxTokens, ...thinking(cfg.effort) }),
          signal: AbortSignal.timeout(LIMITS.llmRequestMs), timeout: false, // Bun cuts a fetch at 5 min by default: llmRequestMs decides
        });
        if (!res.ok) {
          const t = await res.text();
          // llama.cpp answers 500 when a cut answer leaves the tool arguments unreadable: same as finish_reason "length"
          if (res.status === 500 && /parse tool call arguments/i.test(t) && cuts++ < LIMITS.cutRetries) { messages.push({ role: "user", content: CUT }); continue; }
          // "does not support tools" (Ollama…): the model is the problem; any other body is cut, a runaway answer can be huge
          const hint = /(not|n't) support.{0,20}tool/i.test(t) ? " (the model must support tool calling)" : "";
          throw new Error(`${baseUrl(cfg)} answered ${res.status}: ${t.length > 300 ? `${t.slice(0, 300)}…` : t}${hint}`);
        }
        const body = await res.json();
        const msg = body.choices?.[0]?.message;
        if (!msg) throw new Error(`${baseUrl(cfg)}: answer without a message: ${JSON.stringify(body).slice(0, 300)}`);
        if (body.choices[0].finish_reason === "length") {
          // nothing of a cut answer is used as is: its tool calls may be incomplete, its text goes on in the next turn
          if (cuts++ >= LIMITS.cutRetries) throw new Error(`the model's answer exceeded ${LIMITS.llmMaxTokens} tokens ${LIMITS.cutRetries} times: raise LIMITS.llmMaxTokens.`);
          if (msg.tool_calls?.length) { messages.push({ role: "user", content: CUT }); continue; }
          text += msg.content ?? "";
          messages.push({ role: "assistant", content: msg.content ?? "" }, { role: "user", content: "Your answer was cut by the output limit. Continue exactly where it stopped, without repeating anything." });
          continue;
        }
        messages.push(msg);
        if (!msg.tool_calls?.length) {
          // the command's check (lint of the pages changed, compile's citation), fixed in this conversation: cheaper than a new run
          const errors = check && fixes < LIMITS.lintFixPasses ? await check() : [];
          if (!errors.length) return text + (msg.content ?? "");
          fixes++;
          report?.({ level: "info", text: `${errors.length} error(s), sent back to the model (pass ${fixes}/${LIMITS.lintFixPasses})`, mark: "  ↻" });
          messages.push({ role: "user", content: `The work is not complete (cortex lint and the compile check). Fix them with Edit or Write, then answer again:\n${errors.join("\n")}` });
          continue;
        }
        for (const c of msg.tool_calls) {
          let content: string;
          try {
            const args = JSON.parse(c.function.arguments || "{}");
            // the schema writes repo paths as `/raw/…`: a leading / outside the root means the repository root, not the system's
            for (const k of ["file_path", "path"]) if (typeof args[k] === "string" && args[k].startsWith("/") && !args[k].startsWith(root)) args[k] = "." + args[k];
            const v = guard(root, /^(WritePage|Append)$/.test(c.function.name) ? "Write" : c.function.name, args, mode); // same rule as Write
            if (!v.allow) { report?.({ level: "warn", text: `refused: ${v.reason}`, mark: "  ⊘" }); content = v.reason; }
            else content = await exec(root, mode, c.function.name, args);
          } catch (e) { content = `error: ${(e as Error).message}`; }
          messages.push({ role: "tool", tool_call_id: c.id, content });
        }
      }
      throw new Error(`openai agent stopped after ${LIMITS.agentTurns} turns.`);
    },
  };
}
