import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { cli, flag, interactiveWith, load, type Backend, type Config, type Mode } from "./backend";
import type { Effort } from "../config";
import { toLabel, toRegex } from "./policy";
import { warn } from "../style";

// --- Claude Agent SDK: every tool call goes through the guard, before execution------------------

export default function claude(cfg: Config): Backend {
  return {
    interactive: interactiveWith((p) => ["claude", ...flag("--model", cfg.model), ...flag("--effort", cfg.effort), p]),
    async run(root, prompt, mode) {
      const { query } = await load<typeof import("@anthropic-ai/claude-agent-sdk")>("@anthropic-ai/claude-agent-sdk");
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
            const v = guard(root, tool, input as Record<string, any>, mode);
            if (v.allow) return { behavior: "allow", updatedInput: input };
            warn(`refusé : ${v.reason}`, "  ⊘");
            return { behavior: "deny", message: v.reason };
          },
        },
      })) {
        if (m.type === "result") {
          if (m.subtype !== "success") throw new Error(`agent Claude en échec (${m.subtype})`);
          out = m.result;
        }
      }
      return out ?? "";
    },
  };
}

// --- Permission guard (used by the Claude backend)----------------------------------------------

// What Bash may run comes from the policy table (policy.ts)
const CORTEX_CMD = { read: toRegex("read"), write: toRegex("write") };
const READ_ONLY = new Set(["Read", "Glob", "Grep", "LS"]);
const WRITERS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** Real path (symlinks resolved), including for a file not yet created. */
function real(p: string): string {
  let cur = p;
  const tail: string[] = [];
  while (!existsSync(cur) && dirname(cur) !== cur) { tail.unshift(cur.slice(dirname(cur).length + 1)); cur = dirname(cur); }
  return join(realpathSync(cur), ...tail);
}

const inside = (p: string, dir: string) => p === dir || p.startsWith(dir + sep);

/** Reads (Read, Glob, Grep, LS) are confined to the wiki root: every path argument, symlinks resolved. */
function readViolation(root: string, tool: string, input: Record<string, any>): string | undefined {
  const rr = real(root);
  const base = String(input.path ?? root);
  const paths = [base];
  if (input.file_path !== undefined) paths.push(String(input.file_path));
  // Glob: the static prefix of the pattern (before the first wildcard) must stay in the root too
  if (tool === "Glob" && typeof input.pattern === "string") {
    const pre = input.pattern.split(/[*?[{]/)[0];
    paths.push(isAbsolute(pre) ? pre : join(isAbsolute(base) ? base : resolve(root, base), pre));
  }
  return paths.find((p) => p.startsWith("~") || !inside(real(isAbsolute(p) ? p : resolve(root, p)), rr));
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
    return bad === undefined ? { allow: true } : { allow: false, reason: `Lecture refusée hors du dépôt du wiki : ${bad}` };
  }
  if (tool === "Bash") {
    const raw = String(input.command ?? "").trim();
    const cmd = raw.includes("\n") ? undefined : unquote(raw);
    if (cmd === undefined || /[;&|<>`$]/.test(cmd)) return { allow: false, reason: `Bash : pas d'enchaînement ni de redirection, texte entre guillemets sans $ ni accent grave (${raw.slice(0, 80)}). Lance cortex seul.` };
    return CORTEX_CMD[mode].test(cmd) ? { allow: true }
      : { allow: false, reason: `Bash limité à ${toLabel(mode)}.` };
  }
  if (WRITERS.has(tool)) {
    if (mode === "read") return { allow: false, reason: "Lecture seule : relance avec --file pour écrire une synthèse." };
    const p = String(input.file_path ?? input.notebook_path ?? "");
    if (!p) return { allow: false, reason: "Chemin manquant." };
    const target = real(isAbsolute(p) ? p : resolve(root, p));
    return target.startsWith(real(join(root, "wiki")) + sep) ? { allow: true }
      : { allow: false, reason: `Écriture refusée hors de wiki/ : ${p}` };
  }
  return { allow: false, reason: `Outil non autorisé pour cortex : ${tool}` };
}
