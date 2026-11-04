import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config";
import { readDocs, serializeDoc, slugify } from "./lib";
import { expand, NAMING_DEFAULTS, TYPE_DIRS, type NamingKey, type PageType } from "./template";

/** Templates in force: config.json, otherwise the defaults (UUID v7). */
export async function naming(root: string): Promise<Record<NamingKey, string>> {
  const c = await loadConfig(root);
  return { raw_path: c.raw_path ?? NAMING_DEFAULTS.raw_path, page_path: c.page_path ?? NAMING_DEFAULTS.page_path };
}

/** First free path: `p`, otherwise `p-2`, `p-3`… (the suffix goes on the last segment). */
export function free(p: string, taken: (p: string) => boolean): string {
  if (!taken(p)) return p;
  for (let n = 2; ; n++) if (!taken(`${p}-${n}`)) return `${p}-${n}`;
}

/** Raw id (last segment of its folder) already taken somewhere under raw/? It must be unique: the journal only cites it. */
export const rawIdTaken = (root: string, id: string) =>
  existsSync(join(root, "raw")) && new Bun.Glob(`**/${id}/source.md`).scanSync(join(root, "raw")).next().done === false;

/**
 * `cortex new`: creates the page (minimal frontmatter, status: draft) at the path given by `page_path`, and returns that path.
 * Refuses an already-taken title (update before creating) by naming the existing page.
 */
export async function newPage(root: string, type: string, title: string, at = new Date()): Promise<string> {
  const t = (Object.keys(TYPE_DIRS) as PageType[]).find((k) => k.toLowerCase() === type.toLowerCase());
  if (!t) throw new Error(`type inconnu : ${type} (${Object.keys(TYPE_DIRS).join(" | ")})`);
  if (!title.trim()) throw new Error("titre vide");
  const same = (await readDocs(root, "wiki")).docs.find((d) => d.fm.title && slugify(String(d.fm.title)) === slugify(title));
  if (same) throw new Error(`une page porte déjà ce titre : ${same.path} (mets-la à jour plutôt que d'en créer une autre)`);
  const base = `wiki/${expand((await naming(root)).page_path, { at, title, type: t })}`;
  const path = `${free(base, (p) => existsSync(join(root, `${p}.md`)))}.md`;
  await Bun.write(join(root, path), serializeDoc({ type: t, title: title.trim(), status: "draft" }, ""));
  return path;
}
