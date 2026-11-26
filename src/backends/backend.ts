import type { Config } from "../config";
import type { Report } from "../print";
/** Bridge between the commands (compile, ask) and the agents. Each client implements `Backend`. */
export type Mode = "write" | "read";
export type { Config };

/**
 * What the command will check once the agent is done (`answer`: its final text): one line per miss, empty when the work is
 * complete. `prompt` words the send-back when the misses are not lint errors (the openai client sends them back in the same
 * conversation).
 */
export type Check = ((answer?: string) => Promise<string[]>) & { prompt?: (misses: string[]) => string };

/**
 * A tool of one run only, beside the cortex pack (the site's questions: render_blocks). Its arguments are checked against
 * `schema` before `run`; a mismatch goes back to the model as text, so it can correct the call.
 */
export type ExtraTool = { name: string; description: string; schema: import("zod").ZodObject; run: (args: any) => Promise<string> };

/** Runs one extra tool call: the schema first, its errors as text for the model. */
export async function runExtra(t: ExtraTool, args: unknown): Promise<string> {
  const r = t.schema.safeParse(args);
  if (!r.success) return `invalid arguments: ${r.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}. Fix them and call ${t.name} again.`;
  try { return await t.run(r.data); } catch (e) { return `error: ${(e as Error).message}`; }
}

/** Live view of an answer being written (the site's questions): `text` gets each piece, `reset` says that what was sent is void (a new model turn). */
export type Stream = { text: (delta: string) => void; reset: () => void };

export interface Backend {
  /** Command of the interactive session: the agent presents its plan before writing. */
  interactive(prompt: string): string[];
  /**
   * Non-interactive execution; returns the final text, throws on failure. `report` receives live notices (e.g. a refused tool
   * call). `extra`: tools of this run only; the openai and claude clients offer them, the others ignore them (`EXTRA_TOOLS`).
   * `stream`: the answer as it is written; only the openai client sends it, the others ignore it.
   */
  run(root: string, prompt: string, mode: Mode, report?: Report, check?: Check, extra?: ExtraTool[], stream?: Stream): Promise<string>;
}

/** The clients that offer a run's extra tools to the model. */
export const EXTRA_TOOLS = new Set(["openai", "claude"]);

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
