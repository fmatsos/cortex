import { join, resolve } from "node:path";
import { agentFileFor, contentOf, loadConfig } from "./config";
import { instanceRoot, spaceNameOf } from "./lib";
import NOTES from "./schema-notes.md" with { type: "text" };
import SCHEMA from "./schema.md" with { type: "text" }; // embedded: a compiled binary has no src/ next to it

/** Wiki language when `language` is unset in cortex.json. */
export const DEFAULT_LANGUAGE = "English";

const MARKS = /^<!-- notes:(?:begin|end) -->\n/gm;
/** What only a space of notes needs, marked in schema-notes.md (one source of truth): added to the default schema in a space of both. */
const NOTES_PART = [...NOTES.matchAll(/<!-- notes:begin -->\n([\s\S]*?)<!-- notes:end -->/g)].map((m) => m[1]!.trim()).join("\n\n").replace(/^8\. /m, "- ");
const BOTH = `${SCHEMA.trimEnd()}\n\n## Notes in this space\n\nThis space holds resources and the human's own notes. A raw source with \`content: note\` is the human's own writing: the rules below apply to it, on top of those above. Every other source is a resource and follows the rules above.\n\n${NOTES_PART}\n`;

/** Effective schema: the `schema` of the space (`spaces.<name>`), else the global one (a file relative to the instance root), else the built-in one for the `content` of the space (resources, notes, or both); `{{language}}` filled from `language`. */
export async function schemaText(root: string): Promise<string> {
  const c = await loadConfig(root), name = spaceNameOf(root);
  const ref = (name ? c.spaces?.[name]?.schema : undefined) ?? c.schema;
  const content = contentOf(c, name);
  let text = content.includes("notes") ? (content.includes("resources") ? BOTH : NOTES) : SCHEMA;
  if (ref) {
    const f = Bun.file(resolve(instanceRoot(root), ref));
    if (!(await f.exists())) throw new Error(`schema not found: ${ref} (schema key of cortex.json)`);
    text = await f.text();
  }
  return text.replace(MARKS, "").replaceAll("{{language}}", c.language ?? DEFAULT_LANGUAGE);
}

/** Writes the effective schema to CLAUDE.md or AGENTS.md (per client). Keeps an existing file unless `overwrite`. */
export async function writeSchema(root: string, overwrite: boolean): Promise<{ file: string; written: boolean }> {
  const file = await agentFileFor(root);
  const f = Bun.file(join(root, file));
  if (!overwrite && (await f.exists())) return { file, written: false };
  await Bun.write(f, await schemaText(root));
  return { file, written: true };
}
