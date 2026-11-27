import { join } from "node:path";
import { CortexError, SPACE_NAME, findSpaces, listSpaces } from "./lib";

/**
 * A question that reads several spaces (`cortex ask "…" --space a,b|all`, the site's assistant with a scope): the agent runs from the
 * instance, and what it may read is a list of space names kept by the code that starts it, never an option of the agent's own tools.
 * Three places enforce it: the sandbox of every process it runs (backends/sandbox.ts hides the other spaces), the file tools and the
 * search of the tool pack (backends/tools.ts), and the site's assistant tools (ask-site.ts). The list reaches the pack's own server
 * (`cortex mcp --agent read`) and the commands the agent runs through this variable, set by the parent when it starts them.
 */
export const ASK_SPACES_ENV = "CORTEX_ASK_SPACES";

/** The environment of a process the agent runs: the process's own, plus the spaces of the question when it reads several (a bare `cortex search` there reads exactly those). */
export const askEnv = (spaces?: string[], extra: Record<string, string> = {}): Record<string, string | undefined> => (spaces ? { ...process.env, ...extra, [ASK_SPACES_ENV]: spaces.join(",") } : process.env);

/** The spaces this process was started with (the pack's server, a command the agent runs): undefined when it reads one. */
export function askSpacesFromEnv(env: Record<string, string | undefined> = process.env): string[] | undefined {
  const names = (env[ASK_SPACES_ENV] ?? "").split(",").filter((n) => SPACE_NAME.test(n));
  return names.length ? [...new Set(names)] : undefined;
}

/**
 * The spaces `spec` (`a,b` or `all`) names, for the current place, refused inside a space (it cannot read the others): at least one, no
 * duplicate. An unknown name is a usage error (findSpaces).
 */
export const askSpaceNames = (spec: string, from = process.cwd()): string[] => findSpaces(spec, from).map((s) => s.space);

/** What a command that already runs for a question may search: `spec` (a list, a name, `all`, or nothing) narrowed to `allowed`, else a usage error. */
export function narrowSpaces(spec: string | undefined, allowed: string[]): string[] {
  if (!spec || spec === "all") return allowed;
  const want = [...new Set(spec.split(",").map((s) => s.trim()).filter(Boolean))];
  const out = want.find((n) => !allowed.includes(n));
  if (out !== undefined) throw new CortexError(`space ${out} is outside what this question may read (${allowed.join(", ")}).`, "usage");
  return want;
}

/**
 * A path the agent gives that names a page by its link (`/s/<space>/wiki/x.md`, how a citation is written) read as the file it is
 * (`spaces/<space>/wiki/x.md`); anything else is left as it is.
 */
export const spacePath = (p: string): string => p.replace(/^\/?(?:s|spaces)\/([a-z0-9][a-z0-9-]{0,39})\//, "spaces/$1/");

/** The link that cites a page of a space (`path`: `wiki/x.md`, with or without a leading `/`). */
export const spaceCite = (space: string, path: string): string => `/s/${space}/${path.replace(/^\//, "")}`;

/** Absolute roots of the spaces, in the instance, for the names the question may read; those that no longer exist (archived since) are dropped. */
export function spaceRoots(instance: string, names: string[]): { space: string; root: string }[] {
  const have = new Set(listSpaces(instance));
  return names.filter((n) => have.has(n)).map((space) => ({ space, root: join(instance, "spaces", space) }));
}

/**
 * A page named by the link that cites it (`/s/<space>/wiki/x.md`, or the file `spaces/<space>/wiki/x.md`): its space and its path in
 * that space (`/wiki/x.md`). Refused unless the space is one of `spaces`, and the path a Markdown file under wiki/.
 */
export function parseSpacePath(spaces: string[], path: string): { space: string; file: string } {
  const m = /^\/?(?:s|spaces)\/([a-z0-9][a-z0-9-]{0,39})(\/wiki\/.+\.md)$/.exec(path.trim());
  if (!m || !spaces.includes(m[1]!)) throw new Error(`Path refused: ${path} (expected: /s/<space>/wiki/….md, in one of these spaces: ${spaces.join(", ")})`);
  return { space: m[1]!, file: m[2]! };
}
