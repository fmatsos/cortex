import { isAbsolute, join, relative, resolve } from "node:path";
import { isUnder } from "../paths";
import { cli, flag, interactiveWith, load, type Backend, type Config, type Mode } from "./backend";
import type { Effort } from "../config";
import { toLabel, toRegex } from "./policy";

// --- Claude Agent SDK: the cortex tool pack (tools.ts) in process, every call guarded; Claude Code's own tools are off------------------

export default function claude(cfg: Config): Backend {
  return {
    interactive: interactiveWith((p) => ["claude", ...flag("--model", cfg.model), ...flag("--effort", cfg.effort), p]),
    async run(root, prompt, mode, report) {
      const { query, createSdkMcpServer, tool } = await load<typeof import("@anthropic-ai/claude-agent-sdk")>("@anthropic-ai/claude-agent-sdk", () => import("@anthropic-ai/claude-agent-sdk"));
      const { schemaText } = await import("../schema");
      const { callTool, toolPack, zodShape } = await import("./tools");
      const schema = await schemaText(root);
      const refused = (reason: string) => report?.({ level: "warn", text: `refused: ${reason}`, mark: "  ⊘" });
      // the cortex tool pack, in process: the same tools as every backend; Claude Code's own tools are off
      const cortex = createSdkMcpServer({ name: "cortex", alwaysLoad: true, tools: toolPack(mode).map((t) =>
        tool(t.name, t.description, zodShape(t) as any, async (args: Record<string, unknown>) => ({ content: [{ type: "text" as const, text: await callTool(root, mode, t.name, args, refused) }] }))) });
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
          mcpServers: { cortex },
          disallowedTools: BUILTINS, // not even offered: the cortex tools replace them
          allowedTools: [], // nothing approved by default: every call goes through canUseTool
          // only the cortex tools (they guard each call themselves) and the todo list; anything else is refused
          canUseTool: async (name, input) => {
            if (name.startsWith("mcp__cortex__") || name === "TodoWrite") return { behavior: "allow", updatedInput: input };
            const reason = `Tool not allowed for cortex: ${name}. Use the cortex tools (Read, Glob, Grep, Bash, NewPage, WritePage, Append, Write, Edit).`;
            refused(reason);
            return { behavior: "deny", message: reason };
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

/** Claude Code's own tools, switched off: the cortex tool pack replaces them. */
export const BUILTINS = ["Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "Glob", "Grep", "LS", "WebFetch", "WebSearch", "Task", "BashOutput", "KillShell"];

// --- Permission guard (used by the cortex tool pack, tools.ts)----------------------------------------------

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
