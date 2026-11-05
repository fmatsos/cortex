import { existsSync } from "node:fs";
import { join } from "node:path";
import { openWiki, type Wiki } from "./context";
import { serializeDoc, slugify } from "./lib";
import { expand, TYPE_DIRS, type PageType } from "./template";

/** First free path: `p`, otherwise `p-2`, `p-3`… (the suffix goes on the last segment). */
export function free(p: string, taken: (p: string) => boolean): string {
  if (!taken(p)) return p;
  for (let n = 2; ; n++) if (!taken(`${p}-${n}`)) return `${p}-${n}`;
}

/**
 * `cortex new`: creates the page (minimal frontmatter, status: draft) at the path given by `page_path`, and returns that path.
 * Refuses an already-taken title (update before creating) by naming the existing page.
 */
export async function newPageCtx(w: Wiki, type: string, title: string, at = new Date(), init: { fm?: Record<string, unknown>; body?: string } = {}): Promise<string> {
  const root = w.root;
  const t = (Object.keys(TYPE_DIRS) as PageType[]).find((k) => k.toLowerCase() === type.toLowerCase());
  if (!t) throw new Error(`unknown type: ${type} (${Object.keys(TYPE_DIRS).join(" | ")})`);
  if (!title.trim()) throw new Error("empty title");
  const same = (await w.pages()).find((d) => d.fm.title && slugify(d.fm.title, Infinity) === slugify(title, Infinity));
  if (same) throw new Error(`a page already has this title: ${same.path} (update it instead of creating another)`);
  const base = `wiki/${expand((await w.naming()).page_path, { at, title, type: t })}`;
  const path = `${free(base, (p) => existsSync(join(root, `${p}.md`)))}.md`;
  await Bun.write(join(root, path), serializeDoc({ type: t, title: title.trim(), status: "draft", ...init.fm }, init.body ?? ""));
  return path;
}
export const newPage = (root: string, type: string, title: string, at = new Date()) => newPageCtx(openWiki(root), type, title, at);
