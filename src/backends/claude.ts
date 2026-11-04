import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { cli, flag, interactiveWith, load, type Backend, type Config, type Mode } from "./backend";

// --- Claude Agent SDK : chaque appel d'outil passe par le garde-fou, avant exécution ------------

export default function claude(cfg: Config): Backend {
  return {
    interactive: interactiveWith((p) => ["claude", ...flag("--model", cfg.model), ...flag("--effort", cfg.effort), p]),
    async run(root, prompt, mode) {
      const { query } = await load<typeof import("@anthropic-ai/claude-agent-sdk")>("@anthropic-ai/claude-agent-sdk");
      let out: string | undefined;
      for await (const m of query({
        prompt,
        options: {
          cwd: root,
          model: cfg.model,
          effort: cfg.effort as any, // low | medium | high | xhigh | max
          pathToClaudeCodeExecutable: cli("claude"),
          settingSources: ["project"], // CLAUDE.md, sans les autorisations de ~/.claude qui court-circuiteraient le garde-fou
          permissionMode: "default", // acceptEdits/bypass sauteraient canUseTool
          allowedTools: [], // rien d'approuvé d'office : chaque appel passe par canUseTool
          canUseTool: async (tool, input) => {
            const v = guard(root, tool, input as Record<string, any>, mode);
            if (v.allow) return { behavior: "allow", updatedInput: input };
            console.error(`  ⊘ refusé : ${v.reason}`);
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

// --- Garde-fou de permissions (utilisé par le backend Claude) ----------------------------------

const BRAIN_CMD = { read: /^brain search( |$)/, write: /^brain (search|index|lint)( |$)/ };
const READ_ONLY = new Set(["Read", "Glob", "Grep", "LS", "TodoWrite"]);
const WRITERS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** Chemin réel (symlinks résolus), y compris pour un fichier pas encore créé. */
function real(p: string): string {
  let cur = p;
  const tail: string[] = [];
  while (!existsSync(cur) && dirname(cur) !== cur) { tail.unshift(cur.slice(dirname(cur).length + 1)); cur = dirname(cur); }
  return join(realpathSync(cur), ...tail);
}

export type Verdict = { allow: true } | { allow: false; reason: string };

/** Fonction pure : un outil demandé par l'agent est-il permis ? Écritures limitées à wiki/, Bash limité à brain. */
export function guard(root: string, tool: string, input: Record<string, any>, mode: Mode): Verdict {
  if (READ_ONLY.has(tool)) return { allow: true };
  if (tool === "Bash") {
    const cmd = String(input.command ?? "").trim();
    if (/[;&|<>`$\n]/.test(cmd)) return { allow: false, reason: `Bash : pas d'enchaînement ni de redirection (${cmd.slice(0, 80)}). Lance brain seul.` };
    return BRAIN_CMD[mode].test(cmd) ? { allow: true }
      : { allow: false, reason: `Bash limité à ${mode === "read" ? "brain search" : "brain search|index|lint"}.` };
  }
  if (WRITERS.has(tool)) {
    if (mode === "read") return { allow: false, reason: "Lecture seule : relance avec --file pour écrire une synthèse." };
    const p = String(input.file_path ?? input.notebook_path ?? "");
    if (!p) return { allow: false, reason: "Chemin manquant." };
    const target = real(isAbsolute(p) ? p : resolve(root, p));
    return target.startsWith(real(join(root, "wiki")) + sep) ? { allow: true }
      : { allow: false, reason: `Écriture refusée hors de wiki/ : ${p}` };
  }
  return { allow: false, reason: `Outil non autorisé pour brain : ${tool}` };
}
