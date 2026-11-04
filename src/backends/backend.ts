import type { Config } from "../config";
/** Bridge between the commands (compile, ask) and the agents. Each client implements `Backend`. */
export type Mode = "write" | "read";
export type { Config };

export interface Backend {
  /** Command of the interactive session: the agent presents its plan before writing. */
  interactive(prompt: string): string[];
  /** Non-interactive execution; returns the final text, throws on failure. */
  run(root: string, prompt: string, mode: Mode): Promise<string>;
}

export const split = (s: string) => s.split(/\s+/).filter(Boolean);

/** CORTEX_AGENT replaces the interactive command of any backend. */
/** CLI option only if the value is defined. */
export const flag = (name: string, v?: string) => (v ? [name, v] : []);

export const interactiveWith = (fallback: (prompt: string) => string[]) => (prompt: string) =>
  process.env.CORTEX_AGENT ? [...split(process.env.CORTEX_AGENT), prompt] : fallback(prompt);

/**
 * Agent CLI already installed: the SDKs drive it instead of shipping their own binary
 * (`bun install --omit optional` installation: ~94 MB instead of ~1.2 GB of per-platform binaries).
 */
export function cli(name: string): string {
  const p = Bun.which(name);
  if (!p) throw new Error(`CLI « ${name} » introuvable dans le PATH : le SDK s'appuie sur la CLI installée.`);
  return p;
}

/** Lazy loading: the SDK of an unconfigured client is never imported. */
export async function load<T>(pkg: string): Promise<T> {
  try { return (await import(pkg)) as T; }
  catch { throw new Error(`SDK absent : bun add --cwd cli ${pkg}`); }
}
