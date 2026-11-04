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

// `cortex log` en lecture : seules ses options ; `cortex log add` n'est permis qu'en écriture
const LOG_READ = "log( --json| --limit \\d+| --kind \\w+)*$";
const CORTEX_CMD = {
  read: new RegExp(`^cortex (search( |$)|${LOG_READ})`),
  write: new RegExp(`^cortex (search|index|lint|log add)( |$)|^cortex ${LOG_READ}`),
};
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

/**
 * Remplace chaque chaîne entre guillemets par `Q` : le shell la prend pour du texte (celui d'une entrée de journal
 * contient `;`, `|`, `>`…). Refusé (undefined) : guillemet non fermé, ou `$`, accent grave, `\` dans des guillemets
 * doubles (l'expansion s'y exécuterait), ou `\` hors guillemets (échappement d'un guillemet). Les guillemets simples sont littéraux.
 */
export function unquote(cmd: string): string | undefined {
  let out = "";
  for (let i = 0; i < cmd.length; i++) {
    const q = cmd[i];
    if (q === "\\") return undefined; // hors guillemets, \' ou \" serait un guillemet littéral pour le shell, et ce qui suit, une commande
    if (q !== "'" && q !== '"') { out += q; continue; }
    const j = cmd.indexOf(q, i + 1);
    if (j < 0 || (q === '"' && /[$`\\]/.test(cmd.slice(i + 1, j)))) return undefined;
    out += "Q";
    i = j;
  }
  return out;
}

/** Fonction pure : un outil demandé par l'agent est-il permis ? Écritures limitées à wiki/, Bash limité à cortex. */
export function guard(root: string, tool: string, input: Record<string, any>, mode: Mode): Verdict {
  if (READ_ONLY.has(tool)) return { allow: true };
  if (tool === "Bash") {
    const raw = String(input.command ?? "").trim();
    const cmd = raw.includes("\n") ? undefined : unquote(raw);
    if (cmd === undefined || /[;&|<>`$]/.test(cmd)) return { allow: false, reason: `Bash : pas d'enchaînement ni de redirection, texte entre guillemets sans $ ni accent grave (${raw.slice(0, 80)}). Lance cortex seul.` };
    return CORTEX_CMD[mode].test(cmd) ? { allow: true }
      : { allow: false, reason: `Bash limité à ${mode === "read" ? "cortex search|log" : "cortex search|index|lint|log add"}.` };
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
