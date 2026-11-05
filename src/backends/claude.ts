import { isAbsolute, join, relative, resolve } from "node:path";
import { isUnder } from "../paths";
import { frontmatterError, identityChange } from "../lib";
import { cli, flag, interactiveWith, load, type Backend, type Config, type Mode } from "./backend";
import type { Effort } from "../config";
import { toLabel, toRegex } from "./policy";

// --- Claude Agent SDK: every tool call goes through the guard, before execution------------------

export default function claude(cfg: Config): Backend {
  return {
    interactive: interactiveWith((p) => ["claude", ...flag("--model", cfg.model), ...flag("--effort", cfg.effort), p]),
    async run(root, prompt, mode, report) {
      const { query } = await load<typeof import("@anthropic-ai/claude-agent-sdk")>("@anthropic-ai/claude-agent-sdk", () => import("@anthropic-ai/claude-agent-sdk"));
      const { schemaText } = await import("../schema");
      const schema = await schemaText(root);
      let out: string | undefined;
      for await (const m of query({
        prompt,
        options: {
          cwd: root,
          model: cfg.model,
          effort: cfg.effort as Effort<"claude"> | undefined, // validated against EFFORTS.claude by loadConfig; the schema types it as a plain string (opencode takes free-form variants)
          pathToClaudeCodeExecutable: cli("claude"),
          // No settings file is loaded: a permissions.allow rule or a hook (project, user or local) is
          // evaluated before canUseTool and could bypass the guard. The schema is passed explicitly instead.
          settingSources: [],
          systemPrompt: { type: "preset", preset: "claude_code", append: schema },
          permissionMode: "default", // acceptEdits/bypass would skip canUseTool
          allowedTools: [], // nothing approved by default: every call goes through canUseTool
          canUseTool: async (tool, input) => {
            const g = guard(root, tool, input as Record<string, any>, mode);
            // a page whose frontmatter would not parse is refused before the write, the agent rewrites it at once
            const bad = g.allow && await pageError(root, tool, input as Record<string, any>);
            const v: Verdict = bad ? { allow: false, reason: bad } : g;
            if (v.allow) return { behavior: "allow", updatedInput: input };
            report?.({ level: "warn", text: `refused: ${v.reason}`, mark: "  ⊘" });
            return { behavior: "deny", message: v.reason };
          },
        },
      })) {
        if (m.type === "result") {
          if (m.subtype !== "success") throw new Error(`Claude agent failed (${m.subtype})`);
          out = m.result;
        }
      }
      return out ?? "";
    },
  };
}

/** Error of the .md page a Write, Edit or MultiEdit would leave on disk (unreadable frontmatter, another page over an existing one, a reused file name); undefined otherwise. */
export async function pageError(root: string, tool: string, input: Record<string, any>): Promise<string | undefined> {
  const path = String(input.file_path ?? "");
  if (!path.endsWith(".md") || !WRITERS.has(tool)) return undefined;
  const file = Bun.file(resolve(root, path));
  let text: string = tool === "Write" ? String(input.content ?? "") : await file.exists() ? await file.text() : "";
  const edits: any[] = tool === "MultiEdit" ? input.edits ?? [] : tool === "Edit" ? [input] : [];
  for (const e of edits) text = e.replace_all ? text.split(String(e.old_string)).join(String(e.new_string)) : text.replace(String(e.old_string), () => String(e.new_string));
  const rel = relative(root, resolve(root, path));
  return frontmatterError(text) ?? (await file.exists() ? identityChange(rel, await file.text(), text)
    : `${rel} does not exist: create a page with cortex new <Type> "<title>" (it prints the path), then fill it in with Edit or Write.`);
}

// --- Permission guard (used by the Claude backend)----------------------------------------------

// What Bash may run comes from the policy table (policy.ts)
const CORTEX_CMD = { read: toRegex("read"), write: toRegex("write") };
const READ_ONLY = new Set(["Read", "Glob", "Grep", "LS"]);
const WRITERS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** Reads (Read, Glob, Grep, LS) are confined to the wiki root: every path argument, symlinks resolved. */
function readViolation(root: string, tool: string, input: Record<string, any>): string | undefined {
  const base = String(input.path ?? root);
  const paths = [base];
  if (input.file_path !== undefined) paths.push(String(input.file_path));
  // Glob: the static prefix of the pattern (before the first wildcard) must stay in the root too
  if (tool === "Glob" && typeof input.pattern === "string") {
    const pre = input.pattern.split(/[*?[{]/)[0];
    paths.push(isAbsolute(pre) ? pre : join(isAbsolute(base) ? base : resolve(root, base), pre));
  }
  return paths.find((p) => p.startsWith("~") || !isUnder(root, ".", p, { self: true }));
}

export type Verdict = { allow: true } | { allow: false; reason: string };

/**
 * Replaces each quoted string with `Q`: the shell takes it for text (that of a journal entry
 * contains `;`, `|`, `>`…). Refused (undefined): unclosed quote, or `$`, backtick, `\` inside double
 * quotes (expansion would run there), or `\` outside quotes (escaping a quote). Single quotes are literal.
 */
export function unquote(cmd: string): string | undefined {
  let out = "";
  for (let i = 0; i < cmd.length; i++) {
    const q = cmd[i];
    if (q === "\\") return undefined; // outside quotes, \' or \" would be a literal quote for the shell, and what follows, a command
    if (q !== "'" && q !== '"') { out += q; continue; }
    const j = cmd.indexOf(q, i + 1);
    if (j < 0 || (q === '"' && /[$`\\]/.test(cmd.slice(i + 1, j)))) return undefined;
    out += "Q";
    i = j;
  }
  return out;
}

/** Pure function: is a tool requested by the agent allowed? Writes limited to wiki/, Bash limited to cortex. */
export function guard(root: string, tool: string, input: Record<string, any>, mode: Mode): Verdict {
  if (tool === "TodoWrite") return { allow: true };
  if (READ_ONLY.has(tool)) {
    const bad = readViolation(root, tool, input);
    return bad === undefined ? { allow: true } : { allow: false, reason: `Read refused outside the wiki repository: ${bad}` };
  }
  if (tool === "Bash") {
    const raw = String(input.command ?? "").trim();
    const cmd = raw.includes("\n") ? undefined : unquote(raw);
    if (cmd === undefined || /[;&|<>`$]/.test(cmd)) return { allow: false, reason: `Bash: no chaining or redirection, quoted text without $ or backtick (${raw.slice(0, 80)}). Run cortex alone.` };
    return CORTEX_CMD[mode].test(cmd) ? { allow: true }
      : { allow: false, reason: `Bash limited to ${toLabel(mode)}.` };
  }
  if (WRITERS.has(tool)) {
    if (mode === "read") return { allow: false, reason: "Read-only: rerun with --file to write a synthesis." };
    const p = String(input.file_path ?? input.notebook_path ?? "");
    if (!p) return { allow: false, reason: "Missing path." };
    return isUnder(root, "wiki", p) ? { allow: true }
      : { allow: false, reason: `Write refused outside wiki/: ${p}` };
  }
  return { allow: false, reason: `Tool not allowed for cortex: ${tool}` };
}
