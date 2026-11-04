/** Pont (Bridge) entre les commandes (compile, ask) et les agents. Chaque client implémente `Backend`. */
export type Mode = "write" | "read";
export type Config = { client?: string; model?: string };

export interface Backend {
  /** Commande de la session interactive : l'agent présente son plan avant d'écrire. */
  interactive(prompt: string): string[];
  /** Exécution non interactive ; renvoie le texte final, lève en cas d'échec. */
  run(root: string, prompt: string, mode: Mode): Promise<string>;
}

export const split = (s: string) => s.split(/\s+/).filter(Boolean);

/** BRAIN_AGENT remplace la commande interactive de n'importe quel backend. */
export const interactiveWith = (fallback: (prompt: string) => string[]) => (prompt: string) =>
  process.env.BRAIN_AGENT ? [...split(process.env.BRAIN_AGENT), prompt] : fallback(prompt);

/** Chargement à la demande : le SDK d'un client non configuré n'est jamais importé. */
export async function load<T>(pkg: string): Promise<T> {
  try { return (await import(pkg)) as T; }
  catch { throw new Error(`SDK absent : bun add --cwd cli ${pkg}`); }
}
