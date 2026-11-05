import { join, relative, resolve } from "node:path";
import { interactiveWith, type Backend, type Config, type Mode } from "./backend";
import { guard } from "./claude";
import { confine } from "./sandbox";
import { LIMITS } from "../limits";

// --- Any OpenAI-compatible API (Ollama, llama.cpp, LM Studio, vLLM, OpenRouter…): cortex runs the agent loop itself.
// The tools take Claude's names and fields, so every call goes through the same `guard` as the Claude backend.

const str = (description: string) => ({ type: "string", description });
const tool = (name: string, description: string, props: Record<string, object>, required = Object.keys(props)) =>
  ({ type: "function", function: { name, description, parameters: { type: "object", properties: props, required } } });

const READ_TOOLS = [
  tool("Read", "Read a file of the wiki repository.", { file_path: str("path, relative to the repository root") }),
  tool("Glob", "List the files matching a glob pattern.", { pattern: str("e.g. wiki/**/*.md") }),
  tool("Grep", "Lines matching a regular expression, in the files of a folder.", { pattern: str("regular expression"), path: str("folder, default: the root") }, ["pattern"]),
  tool("Bash", "Run one cortex command (cortex search, cortex log…), nothing else.", { command: str("e.g. cortex search \"term\"") }),
];
const WRITE_TOOLS = [
  tool("Write", "Create or replace a file under wiki/.", { file_path: str("path under wiki/"), content: str("whole file content") }),
  tool("Edit", "Replace one exact, unique string of a file under wiki/.", { file_path: str("path under wiki/"), old_string: str("exact text to replace"), new_string: str("replacement") }),
];

const cap = (s: string) => s.length > LIMITS.toolOutputChars ? `${s.slice(0, LIMITS.toolOutputChars)}\n[truncated]` : s;

/** Runs one tool call already allowed by `guard`; the result (or the error) goes back to the model as text. */
async function exec(root: string, mode: Mode, name: string, a: Record<string, any>): Promise<string> {
  const abs = (p = ".") => resolve(root, p);
  switch (name) {
    case "Read": return cap(await Bun.file(abs(a.file_path)).text());
    case "Glob": return cap([...new Bun.Glob(a.pattern).scanSync({ cwd: abs(a.path) })].sort().join("\n") || "(no file)"); // same base folder as the one `guard` checked
    case "Grep": {
      const re = new RegExp(a.pattern);
      const out: string[] = [];
      let size = 0;
      for (const f of new Bun.Glob("**/*").scanSync({ cwd: abs(a.path) })) {
        const p = join(abs(a.path), f);
        (await Bun.file(p).text()).split("\n").forEach((l, i) => {
          if (!re.test(l)) return;
          const hit = `${relative(root, p)}:${i + 1}: ${l}`;
          out.push(hit);
          size += hit.length + 1;
        });
        if (size > LIMITS.toolOutputChars) break;
      }
      return cap(out.join("\n") || "(no match)");
    }
    case "Write":
      if (typeof a.content !== "string") return "content must be a string.";
      await Bun.write(abs(a.file_path), a.content); return "written";
    case "Edit": {
      if (typeof a.old_string !== "string" || typeof a.new_string !== "string") return "old_string and new_string must be strings.";
      const text = await Bun.file(abs(a.file_path)).text();
      if (text.split(a.old_string).length !== 2) return "old_string must occur exactly once in the file.";
      await Bun.write(abs(a.file_path), text.replace(a.old_string, () => a.new_string));
      return "edited";
    }
    case "Bash": {
      // guard allowed a single cortex command, quotes without expansion; sh only parses them, bwrap still confines it
      const p = Bun.spawn(confine(root, ["sh", "-c", a.command], mode), { cwd: root, stdout: "pipe", stderr: "pipe" });
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      return cap(`${out}${err}${code ? `\n(exit ${code})` : ""}`);
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

/** Lint errors of the given pages (paths relative to the root), one line each. */
async function lintErrors(root: string, pages: Set<string>): Promise<string[]> {
  const { lint } = await import("../lint");
  return (await lint(root)).filter((i) => i.level === "error" && pages.has(i.path)).map((i) => `${i.path}: ${i.msg}`);
}

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
      const touched = new Set<string>(); // pages written this run: only their lint errors go back to the model
      let fixes = 0;
      for (let turn = 0; turn < LIMITS.agentTurns; turn++) {
        const res = await fetch(`${baseUrl(cfg)}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(key && { authorization: `Bearer ${key}` }) },
          body: JSON.stringify({ model: cfg.model, messages, tools, ...thinking(cfg.effort) }),
          signal: AbortSignal.timeout(LIMITS.llmRequestMs), timeout: false, // Bun cuts a fetch at 5 min by default: llmRequestMs decides
        });
        if (!res.ok) { const t = await res.text(); throw new Error(`${baseUrl(cfg)} answered ${res.status}: ${t}${/tool/i.test(t) ? " (the model must support tool calling)" : ""}`); }
        const body = await res.json();
        const msg = body.choices?.[0]?.message;
        if (!msg) throw new Error(`${baseUrl(cfg)}: answer without a message: ${JSON.stringify(body).slice(0, 300)}`);
        messages.push(msg);
        if (!msg.tool_calls?.length) {
          // small models forget a field or copy a raw `status: pending`: lint names it, one more turn fixes it
          const errors = fixes < LIMITS.lintFixPasses ? [...(touched.size ? await lintErrors(root, touched) : []), ...(await check?.() ?? [])] : [];
          if (!errors.length) return msg.content ?? "";
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
            const v = guard(root, c.function.name, args, mode);
            if (!v.allow) { report?.({ level: "warn", text: `refused: ${v.reason}`, mark: "  ⊘" }); content = v.reason; }
            else {
              content = await exec(root, mode, c.function.name, args);
              if (c.function.name === "Write" || c.function.name === "Edit") touched.add(relative(root, resolve(root, args.file_path)));
            }
          } catch (e) { content = `error: ${(e as Error).message}`; }
          messages.push({ role: "tool", tool_call_id: c.id, content });
        }
      }
      throw new Error(`openai agent stopped after ${LIMITS.agentTurns} turns.`);
    },
  };
}
