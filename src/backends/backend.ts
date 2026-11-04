import { realpathSync } from "node:fs";
import { join } from "node:path";
/** Pont (Bridge) entre les commandes (compile, ask) et les agents. Chaque client implémente `Backend`. */
export type Mode = "write" | "read";
export type Config = { client?: string; model?: string; effort?: string; language?: string; schema?: string; raw_path?: string; page_path?: string };

export interface Backend {
  /** Commande de la session interactive : l'agent présente son plan avant d'écrire. */
  interactive(prompt: string): string[];
  /** Exécution non interactive ; renvoie le texte final, lève en cas d'échec. */
  run(root: string, prompt: string, mode: Mode): Promise<string>;
}

export const split = (s: string) => s.split(/\s+/).filter(Boolean);

/** CORTEX_AGENT remplace la commande interactive de n'importe quel backend. */
/** Option de CLI seulement si la valeur est définie. */
export const flag = (name: string, v?: string) => (v ? [name, v] : []);

export const interactiveWith = (fallback: (prompt: string) => string[]) => (prompt: string) =>
  process.env.CORTEX_AGENT ? [...split(process.env.CORTEX_AGENT), prompt] : fallback(prompt);

/**
 * CLI de l'agent déjà installée : les SDK la pilotent au lieu d'embarquer leur propre binaire
 * (installation `bun install --omit optional` : ~94 Mo au lieu de ~1,2 Go de binaires par plateforme).
 */
export function cli(name: string): string {
  const p = Bun.which(name);
  if (!p) throw new Error(`CLI « ${name} » introuvable dans le PATH : le SDK s'appuie sur la CLI installée.`);
  return p;
}

/** Chargement à la demande : le SDK d'un client non configuré n'est jamais importé. */
export async function load<T>(pkg: string): Promise<T> {
  try { return (await import(pkg)) as T; }
  catch { throw new Error(`SDK absent : bun add --cwd cli ${pkg}`); }
}

/**
 * Enferme une commande d'agent : tout le dépôt en lecture seule, sauf wiki/ en mode écriture.
 * Vaut pour n'importe quelle CLI (moteur par défaut, sessions interactives) ; le reste du système reste inscriptible
 * (état propre de l'agent : ~/.claude, ~/.codex…).
 * Linux : bubblewrap. macOS : sandbox-exec (Seatbelt, celui qu'utilisent Codex et Claude Code).
 */
export function confine(root: string, cmd: string[], mode: Mode): string[] {
  const r = realpathSync(root); // macOS : /var → /private/var, le profil doit viser le chemin réel
  const wiki = join(r, "wiki");
  if (process.platform === "darwin") {
    const q = (p: string) => JSON.stringify(p); // chaîne SBPL entre guillemets, échappée
    const write = mode === "write" ? `(require-not (subpath ${q(wiki)}))` : "";
    const profile = `(version 1)(allow default)(deny file-write* (require-all (subpath ${q(r)}) ${write}))`;
    return ["sandbox-exec", "-p", profile, ...cmd];
  }
  if (!Bun.which("bwrap")) throw new Error("bubblewrap (bwrap) introuvable : il confine l'agent à wiki/. Installe-le (apt install bubblewrap).");
  return ["bwrap", "--dev-bind", "/", "/", "--ro-bind", r, r, ...(mode === "write" ? ["--bind", wiki, wiki] : []), "--die-with-parent", "--", ...cmd];
}
