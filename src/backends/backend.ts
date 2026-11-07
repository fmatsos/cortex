import type { Config } from "../config";
import type { Report } from "../print";
/** Bridge between the commands (compile, ask) and the agents. Each client implements `Backend`. */
export type Mode = "write" | "read";
export type { Config };

/** What the command will check once the agent is done: one line per miss, empty when the work is complete. */
export type Check = () => Promise<string[]>;

export interface Backend {
  /** Command of the interactive session: the agent presents its plan before writing. */
  interactive(prompt: string): string[];
  /** Non-interactive execution; returns the final text, throws on failure. `report` receives live notices (e.g. a refused tool call). */
  run(root: string, prompt: string, mode: Mode, report?: Report, check?: Check): Promise<string>;
}

export const split = (s: string) => s.split(/\s+/).filter(Boolean);

/** CLI option only if the value is defined. */
export const flag = (name: string, v?: string) => (v ? [name, v] : []);

/** CORTEX_AGENT replaces the interactive command of any backend. */
export const interactiveWith = (fallback: (prompt: string) => string[]) => (prompt: string) =>
  process.env.CORTEX_AGENT ? [...split(process.env.CORTEX_AGENT), prompt] : fallback(prompt);

/**
 * Agent CLI already installed: the SDKs drive it instead of shipping their own binary
 * (`bun install --omit optional` installation: ~94 MB instead of ~1.2 GB of per-platform binaries).
 */
export function cli(name: string): string {
  const p = Bun.which(name, { PATH: process.env.PATH }); // the current PATH: Bun.which alone may read the startup one
  if (!p) throw new Error(`CLI "${name}" not found in PATH: cortex drives the agent CLI already installed.`);
  return p;
}

/**
 * Lazy loading: the SDK of an unconfigured client is never imported. `importer` holds a literal `import("…")` so that
 * `bun build --compile` bundles the SDK (its JS only: the agent CLI stays the one installed, see `cli`).
 */
export async function load<T>(pkg: string, importer: () => Promise<unknown> = () => import(pkg)): Promise<T> {
  try { return (await importer()) as T; }
  catch (e) {
    // only "this very package is missing" is reported as such; any other failure (syntax error, missing peer…) keeps its own message
    const { message = "" } = e as { message?: string };
    const missing = message.match(/^Cannot find (?:module|package) ['"]([^'"]+)['"]/)?.[1]; // the specifier that failed to resolve
    if (missing !== pkg) throw e;
    throw new Error(`SDK missing: bun add ${pkg}`);
  }
}
