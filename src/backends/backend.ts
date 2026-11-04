import { realpathSync } from "node:fs";
import { join } from "node:path";
/** Bridge between the commands (compile, ask) and the agents. Each client implements `Backend`. */
export type Mode = "write" | "read";
export type Config = { client?: string; model?: string; effort?: string; language?: string; schema?: string; raw_path?: string; page_path?: string };

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

/**
 * Confines an agent command: whole repo read-only, except wiki/ in write mode.
 * Applies to any CLI (default engine, interactive sessions); the rest of the system stays writable
 * (the agent's own state: ~/.claude, ~/.codex…).
 * Linux: bubblewrap. macOS: sandbox-exec (Seatbelt, the one Codex and Claude Code use).
 */
export function confine(root: string, cmd: string[], mode: Mode): string[] {
  const r = realpathSync(root); // macOS: /var → /private/var, the profile must target the real path
  const wiki = join(r, "wiki");
  if (process.platform === "darwin") {
    const q = (p: string) => JSON.stringify(p); // quoted, escaped SBPL string
    const write = mode === "write" ? `(require-not (subpath ${q(wiki)}))` : "";
    const profile = `(version 1)(allow default)(deny file-write* (require-all (subpath ${q(r)}) ${write}))`;
    return ["sandbox-exec", "-p", profile, ...cmd];
  }
  if (!Bun.which("bwrap")) throw new Error("bubblewrap (bwrap) introuvable : il confine l'agent à wiki/. Installe-le (apt install bubblewrap).");
  return ["bwrap", "--dev-bind", "/", "/", "--ro-bind", r, r, ...(mode === "write" ? ["--bind", wiki, wiki] : []), "--die-with-parent", "--", ...cmd];
}
