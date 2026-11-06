import { existsSync } from "node:fs";
import { join } from "node:path";
import { openWiki, type Wiki } from "./context";
import { nearest } from "./embed";
import { clip, judge } from "./judge";
import { serializeDoc, slugify } from "./lib";
import { LIMITS } from "./limits";
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
 * Duplicate guard (by meaning): the same-type pages closest to the new page by embeddings; when the judge is there it picks
 * the one the page duplicates (or none), else a very close cosine decides. Returns what to refuse (`refuse`, the pages
 * to complete instead) or only warn about; nothing when embeddings are off or no page is close.
 */
async function nearDuplicate(root: string, pages: { path: string; fm: Record<string, unknown> }[], type: string, title: string, description: string): Promise<{ refuse: boolean; near: { path: string; title: string; score: number }[] } | undefined> {
  const hits = await nearest(root, `${title}\n${description}`, LIMITS.dupCandidates * 5, false);
  const byPath = new Map(pages.map((d) => [d.path, d]));
  const near = (hits ?? []).filter((h) => byPath.get(h.path)?.fm.type === type).slice(0, LIMITS.dupCandidates)
    .map((h) => ({ ...h, title: String(byPath.get(h.path)!.fm.title ?? h.path), description: String(byPath.get(h.path)!.fm.description ?? "") }));
  if (!near.length) return;
  const criteria = Object.fromEntries([...near.map((n, i) => [`p${i + 1}`, `\`candidates[${i}]\` is the same subject as \`new_page\``]), ["none", "none of the candidates: `new_page` is a different subject, even if related"]]);
  const a = (await judge(root, { new_page: { type, title, description: clip(description, 500) }, candidates: near.map((n) => ({ title: n.title, description: clip(n.description, 500) })) }, {
    dup: { type: "choice", instructions: "Is `new_page` the same subject as one of the `candidates`, so that its content belongs on that existing page instead of a new page?", criteria },
  }))?.dup;
  if (a?.type === "choice") {
    const picked = near[Number(a.choice.slice(1)) - 1];
    if (picked && a.probabilities[a.choice] >= LIMITS.dupJudge) return { refuse: true, near: [picked] };
    if (!picked && a.probabilities.none >= LIMITS.dupJudge) return; // judged different from all of them
    return { refuse: false, near: near.filter((n) => n.score >= LIMITS.dupWarn) };
  }
  if (near[0].score >= LIMITS.dupCosine) return { refuse: true, near: near.filter((n) => n.score >= LIMITS.dupCosine) };
  return { refuse: false, near: near.filter((n) => n.score >= LIMITS.dupWarn) };
}

/**
 * `cortex new`: creates the page (minimal frontmatter, status: draft) at the path given by `page_path`, and returns that path.
 * Refuses an already-taken title (update before creating) by naming the existing page, a near title of the same type, and
 * (embeddings, ideally with the judge) a page of the same type that covers the same subject (`force`: by hand only).
 * A close page that is not refused is a note in `init.notes`. A Source page is 1:1 with a raw source: no check by meaning.
 */
export async function newPageCtx(w: Wiki, type: string, title: string, at = new Date(), init: { fm?: Record<string, unknown>; body?: string; force?: boolean; notes?: string[] } = {}): Promise<string> {
  const root = w.root;
  const t = (Object.keys(TYPE_DIRS) as PageType[]).find((k) => k.toLowerCase() === type.toLowerCase());
  if (!t) throw new Error(`unknown type: ${type} (${Object.keys(TYPE_DIRS).join(" | ")})`);
  if (!title.trim()) throw new Error("empty title");
  const pages = await w.pages();
  const same = pages.find((d) => d.fm.title && slugify(d.fm.title, Infinity) === slugify(title, Infinity));
  if (same) throw new Error(`a page already has this title: ${same.path} (update it instead of creating another)`);
  const near = pages.find((d) => d.fm.type === t && d.fm.title && nearTitle(String(d.fm.title), title));
  if (near && !init.force) throw new Error(`a ${t} page has a near title: ${near.path} « ${near.fm.title} » (update it instead of creating another, or pick a title that tells them apart; by hand: cortex new --force)`);
  if (!init.force && t !== "Source") {
    const dup = await nearDuplicate(root, pages, t, title.trim(), String(init.fm?.description ?? ""));
    const list = dup?.near.map((n) => `${n.path} « ${n.title} »`).join(", ");
    if (dup?.refuse) throw new Error(`a ${t} page covers the same subject: ${list} (complete that page instead of creating another, or pick a title that tells them apart; by hand: cortex new --force)`);
    if (list) init.notes?.push(`close in meaning: ${list}. Check that this page does not duplicate one of them.`);
  }
  const base = `wiki/${expand((await w.naming()).page_path, { at, title, type: t })}`;
  const path = `${free(base, (p) => existsSync(join(root, `${p}.md`)))}.md`;
  await Bun.write(join(root, path), serializeDoc({ type: t, title: title.trim(), status: "draft", ...init.fm }, init.body ?? ""));
  return path;
}
export const newPage = (root: string, type: string, title: string, at = new Date()) => newPageCtx(openWiki(root), type, title, at);
