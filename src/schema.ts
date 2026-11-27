import { join, relative, resolve, sep } from "node:path";
import { agentFileFor, BUILT_IN_SCHEMAS, loadConfig } from "./config";
import { instanceRoot } from "./lib";
import NOTES from "./schema-notes.md" with { type: "text" };
import SCHEMA from "./schema.md" with { type: "text" }; // embedded: a compiled binary has no src/ next to it

/** Wiki language when `language` is unset in cortex.json. */
export const DEFAULT_LANGUAGE = "English";

/** Effective schema: the `schema` of the space (`spaces.<name>`), else the global one (a file relative to the instance root, or a built-in name), else the built-in default; `{{language}}` filled from `language`. */
export async function schemaText(root: string): Promise<string> {
  const c = await loadConfig(root), inst = instanceRoot(root), [dir, name, deeper] = relative(inst, resolve(root)).split(sep);
  const ref = (dir === "spaces" && name && !deeper ? c.spaces?.[name]?.schema : undefined) ?? c.schema;
  let text = SCHEMA;
  if (ref === "notes") text = NOTES; // BUILT_IN_SCHEMAS (config.ts) lists the names
  else if (ref) {
    const f = Bun.file(resolve(inst, ref));
    if (!(await f.exists())) throw new Error(`schema not found: ${ref} (schema key of cortex.json)`);
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
