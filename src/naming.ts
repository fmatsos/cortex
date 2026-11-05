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
 * Two titles name the same thing: same words in any order, or one adds a single word to the other (« Qwen3 4B
 * Instruct » / « Qwen3-4B-Instruct-2507 »). Words are slugified, a final s ignored; a one-word title never matches
 * another (too broad).
 */
export function nearTitle(a: string, b: string): boolean {
  const words = (s: string) => new Set(slugify(s, Infinity).split("-").map((w) => w.replace(/s$/, "")).filter(Boolean));
  const x = words(a), y = words(b), [small, big] = x.size <= y.size ? [x, y] : [y, x];
  return small.size >= 2 && [...small].every((w) => big.has(w)) && big.size - small.size <= 1;
}

/**
 * `cortex new`: creates the page (minimal frontmatter, status: draft) at the path given by `page_path`, and returns that path.
 * Refuses an already-taken title (update before creating) by naming the existing page, and a near title of the same type (`force`: by hand only).
 */
export async function newPageCtx(w: Wiki, type: string, title: string, at = new Date(), init: { fm?: Record<string, unknown>; body?: string; force?: boolean } = {}): Promise<string> {
  const root = w.root;
  const t = (Object.keys(TYPE_DIRS) as PageType[]).find((k) => k.toLowerCase() === type.toLowerCase());
  if (!t) throw new Error(`unknown type: ${type} (${Object.keys(TYPE_DIRS).join(" | ")})`);
  if (!title.trim()) throw new Error("empty title");
  const pages = await w.pages();
  const same = pages.find((d) => d.fm.title && slugify(d.fm.title, Infinity) === slugify(title, Infinity));
  if (same) throw new Error(`a page already has this title: ${same.path} (update it instead of creating another)`);
  const near = pages.find((d) => d.fm.type === t && d.fm.title && nearTitle(String(d.fm.title), title));
  if (near && !init.force) throw new Error(`a ${t} page has a near title: ${near.path} « ${near.fm.title} » (update it instead of creating another, or pick a title that tells them apart; by hand: cortex new --force)`);
  const base = `wiki/${expand((await w.naming()).page_path, { at, title, type: t })}`;
  const path = `${free(base, (p) => existsSync(join(root, `${p}.md`)))}.md`;
  await Bun.write(join(root, path), serializeDoc({ type: t, title: title.trim(), status: "draft", ...init.fm }, init.body ?? ""));
  return path;
}
export const newPage = (root: string, type: string, title: string, at = new Date()) => newPageCtx(openWiki(root), type, title, at);
