import { join, resolve } from "node:path";
import { agentFileFor, loadConfig } from "./config";
import SCHEMA from "./schema.md" with { type: "text" }; // embedded: a compiled binary has no src/ next to it

/** Wiki language when `language` is unset in cortex.json. */
export const DEFAULT_LANGUAGE = "English";

/** Effective schema: the file named by `schema` in cortex.json (relative to the root), else the built-in one; `{{language}}` filled from `language`. */
export async function schemaText(root: string): Promise<string> {
  const c = await loadConfig(root);
  let text = SCHEMA;
  if (c.schema) {
    const f = Bun.file(resolve(root, c.schema));
    if (!(await f.exists())) throw new Error(`schema not found: ${c.schema} (schema key of cortex.json)`);
    text = await f.text();
  }
  return text.replaceAll("{{language}}", c.language ?? DEFAULT_LANGUAGE);
}

/** Writes the effective schema to CLAUDE.md or AGENTS.md (per client). Keeps an existing file unless `overwrite`. */
export async function writeSchema(root: string, overwrite: boolean): Promise<{ file: string; written: boolean }> {
  const file = await agentFileFor(root);
  const f = Bun.file(join(root, file));
  if (!overwrite && (await f.exists())) return { file, written: false };
  await Bun.write(f, await schemaText(root));
  return { file, written: true };
}
