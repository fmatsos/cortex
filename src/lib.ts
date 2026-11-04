import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Wiki root: $CORTEX_ROOT, otherwise the nearest parent directory holding cortex.json. */
export function findRoot(from = process.cwd()): string {
  if (process.env.CORTEX_ROOT) return process.env.CORTEX_ROOT;
  for (let d = from; ; d = dirname(d)) {
    if (existsSync(join(d, "cortex.json"))) return d;
    if (dirname(d) === d) throw new Error("cortex.json introuvable : lance cortex dans le wiki (cortex config init le crée) ou définis CORTEX_ROOT.");
  }
}

export type Doc = { path: string; fm: Record<string, any>; body: string };

export function parseDoc(path: string, txt: string): Doc {
  txt = txt.replace(/^﻿/, ""); // BOM
  const m = txt.match(/^---\r?\n(?:([\s\S]*?)\r?\n)?---\r?\n?/);
  if (!m) return { path, fm: {}, body: txt };
  const fm = (m[1] === undefined ? null : Bun.YAML.parse(m[1])) ?? {};
  if (typeof fm !== "object" || Array.isArray(fm)) throw new Error("frontmatter invalide : objet YAML attendu");
  return { path, fm: fm as Record<string, any>, body: txt.slice(m[0].length) };
}

/** `.md` files under `dir` (relative to root), paths returned relative to root. */
export async function readDocs(root: string, dir: string): Promise<Doc[]> {
  const out: Doc[] = [];
  if (!existsSync(join(root, dir))) return out;
  for (const f of new Bun.Glob("**/*.md").scanSync(join(root, dir))) {
    const path = `${dir}/${f}`;
    out.push(parseDoc(path, await Bun.file(join(root, path)).text()));
  }
  return out;
}

/** Local ISO timestamp with the real UTC offset (handles daylight saving). */
export function localIso(d = new Date()): string {
  const off = -d.getTimezoneOffset();
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19);
  return `${local}${off >= 0 ? "+" : "-"}${p(off / 60)}:${p(off % 60)}`;
}

export function slugify(s: string, max = 50): string {
  const words = s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let out = "";
  for (const w of words) if ((out + "-" + w).length <= max + 1) out += "-" + w; else break;
  return out.slice(1) || "source";
}

/** UUID v7: timestamped then random, sorted in creation order (default naming, see naming.ts). */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const newId = (at = new Date()) => Bun.randomUUIDv7("hex", at);

/** Raw id: the last segment of a source's folder (unique under raw/). */
export const RAW_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Path (relative to root) of raw source `id`, wherever the naming filed it under raw/; undefined if absent. */
export function rawPath(root: string, id: string): string | undefined {
  if (!RAW_ID.test(id) || !existsSync(join(root, "raw"))) return;
  for (const f of new Bun.Glob(`**/${id}/source.md`).scanSync(join(root, "raw"))) return `raw/${f}`;
}

export const sha256 = (s: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

/** Comparable URL: no fragment, no tracking parameters, no trailing /, lowercase host. */
export function normUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|source$)/.test(k)) x.searchParams.delete(k);
    return (x.origin.toLowerCase() + x.pathname.replace(/\/+$/, "") + x.search);
  } catch { return u; }
}

const norm = (p: string) => p.trim().replace(/^\/+/, "");
export type Related = { path: string; title: string; score: number; reasons: string[] };

export const wikiLinks = (d: Doc) => new Set([...d.body.matchAll(/\]\((\/wiki\/[^)#\s]+)/g)].map((m) => norm(m[1])));
const resources = (d: Doc) => new Set<string>((d.fm.sources ?? []).map((s: any) => s.resource));

/**
 * Wiki pages linked to `path`, by decreasing strength: outgoing or incoming link (3 each), shared raw source (2),
 * shared tag (1). Pure: works on pages already read (index.md and log.md excluded).
 */
export function related(docs: Doc[], path: string): Related[] {
  const pages = docs.filter((d) => !/^wiki\/(index|log)\.md$/.test(d.path));
  const me = pages.find((d) => d.path === norm(path));
  if (!me) throw new Error(`Page wiki introuvable : ${path}`);
  const out = wikiLinks(me), mine = resources(me), tags = new Set<string>(me.fm.tags ?? []);
  const hits: Related[] = [];
  for (const d of pages) {
    if (d === me) continue;
    const reasons: string[] = [];
    let score = 0;
    const plus = (n: number, why: string) => { score += n; reasons.push(why); };
    if (out.has(d.path)) plus(3, "lien sortant");
    if (wikiLinks(d).has(me.path)) plus(3, "lien entrant");
    for (const r of resources(d)) if (mine.has(r)) plus(2, `source partagée : ${r}`);
    for (const t of d.fm.tags ?? []) if (tags.has(t)) plus(1, `tag partagé : ${t}`);
    if (score) hits.push({ path: d.path, title: String(d.fm.title ?? ""), score, reasons });
  }
  return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

