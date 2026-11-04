import { join, resolve } from "node:path";
import { loadConfig } from "./backends/index";

/** The schema the agent follows (rules, page format, workflows), shipped with the CLI. */
export const BUILTIN_SCHEMA = join(import.meta.dir, "schema.md");

/** Agent file the schema is written to: the one the configured client loads on its own. */
export const agentFile = (client?: string) => (client === "codex" || client === "opencode" ? "AGENTS.md" : "CLAUDE.md");

/** Effective schema: the file named by `schema` in cortex.json (relative to the root), else the built-in one; `{{language}}` filled from `language`. */
export async function schemaText(root: string): Promise<string> {
  const c = await loadConfig(root);
  const f = Bun.file(c.schema ? resolve(root, c.schema) : BUILTIN_SCHEMA);
  if (!(await f.exists())) throw new Error(`schéma introuvable : ${c.schema} (clé schema de cortex.json)`);
  return (await f.text()).replaceAll("{{language}}", c.language ?? "English");
}

/** Writes the effective schema to CLAUDE.md or AGENTS.md (per client). Keeps an existing file unless `overwrite`. */
export async function writeSchema(root: string, overwrite: boolean): Promise<{ file: string; written: boolean }> {
  const file = agentFile((await loadConfig(root)).client);
  const f = Bun.file(join(root, file));
  if (!overwrite && (await f.exists())) return { file, written: false };
  await Bun.write(f, await schemaText(root));
  return { file, written: true };
}
