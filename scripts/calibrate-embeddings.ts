#!/usr/bin/env bun
// Distribution of the cosines of the configured embedding model on a real wiki, to set the thresholds of its profile (src/embed.ts PROFILES):
//   bun scripts/calibrate-embeddings.ts [wiki root]      (run `cortex index` first: the vectors are read from .cortex/search.db)
// Prints, in percentiles: page against page (all pairs: the « unrelated » floor), each page's nearest neighbours by rank (what `related` keeps),
// and each page's title as a query against the sections (what the vector ranking of `search` keeps: the best one, and the best of another page),
// then how many pairs the duplicate thresholds (`dups.warn`, `dups.cosine`) and the related rule would select, and how a page that is NOT a duplicate fares in the check of `cortex new`
// (its title and description against the whole-page vectors of the same type: the page/page pairs overestimate those cosines).
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { EMBED, embed, embedConfig, keep, profileFor } from "../src/embed";
import { findRoot, parseDoc } from "../src/lib";

const root = process.argv[2] ?? findRoot();
const cfg = await embedConfig(root);
if (!cfg) { console.error("no `embed` in cortex.json"); process.exit(1); }
const prof = profileFor(cfg.model);
const db = new Database(join(root, ".cortex/search.db"), { readonly: true });
const f32 = (b: Uint8Array) => new Float32Array(b.slice().buffer);
const rows = db.query("SELECT d.id, d.path, d.kind, d.title, v.vec FROM docs d JOIN vecs v ON v.key = d.vkey WHERE d.area = 'wiki'").all() as { id: number; path: string; kind: string; title: string; vec: Uint8Array }[];
const pages = rows.filter((r) => r.kind === "page").map((r) => ({ ...r, v: f32(r.vec) }));
const units = rows.map((r) => ({ ...r, v: f32(r.vec) }));
if (pages.length < 3) { console.error("fewer than 3 embedded pages: run cortex index"); process.exit(1); }
const dot = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const pct = (xs: number[]) => {
  if (!xs.length) return "n=0";
  const s = [...xs].sort((a, b) => a - b), q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3);
  return `n=${s.length}  min ${q(0)}  p10 ${q(0.1)}  p50 ${q(0.5)}  p90 ${q(0.9)}  p99 ${q(0.99)}  max ${s.at(-1)!.toFixed(3)}`;
};

console.log(`model ${cfg.model} (${prof.name} profile), ${pages.length} pages, ${units.length} pages and sections\n`);
const pairs: number[] = [];
for (let i = 0; i < pages.length; i++) for (let j = i + 1; j < pages.length; j++) pairs.push(dot(pages[i].v, pages[j].v));
console.log("page / page, every pair      ", pct(pairs));
const byRank: number[][] = [[], [], [], [], []];
const kept: number[] = [];
for (const p of pages) {
  const near = pages.filter((o) => o !== p).map((o) => ({ path: o.path, score: dot(p.v, o.v) })).sort((a, b) => b.score - a.score).slice(0, 5);
  near.forEach((n, i) => byRank[i].push(n.score));
  kept.push(keep(near, prof.related).length);
}
byRank.forEach((xs, i) => console.log(`nearest page, rank ${i + 1}          `, pct(xs)));
console.log(`related kept (rule ${JSON.stringify(prof.related)}): per page ${pct(kept)}`);
console.log(`page/page pairs at or over dups.warn ${prof.dups.warn}: ${pairs.filter((x) => x >= prof.dups.warn).length}; over dups.cosine ${prof.dups.cosine}: ${pairs.filter((x) => x >= prof.dups.cosine).length}  (of ${pairs.length}; not what \`cortex new\` compares, see below)\n`);

// The duplicate guard of `cortex new` compares the title and description of the NEW page (short) with the stored vectors of the whole pages of the same type.
// Each Concept/Entity page is offered again as if it were new (itself left out): its best same-type neighbour is what `dups.warn` and `dups.cosine` see for a page that is NOT a duplicate.
const fresh = pages.filter((p) => p.path.split("/")[1] !== "sources").slice(0, 200);
const texts = await Promise.all(fresh.map(async (p) => { const d = parseDoc(p.path, await Bun.file(join(root, p.path)).text()).fm.description; return `${prof.prefix.passage}${p.title}\n${typeof d === "string" ? d : ""}`; }));
const nv = await embed(texts, cfg, 120_000, false);
const bestSame = fresh.map((p, i) => { const q = Float32Array.from(nv[i]); return Math.max(-1, ...pages.filter((o) => o !== p && o.path.split("/")[1] === p.path.split("/")[1]).map((o) => dot(q, o.v))); });
console.log("new-page check: best same-type neighbour of a distinct page", pct(bestSame));
console.log(`distinct pages \`cortex new\` would warn about (>= ${prof.dups.warn}): ${(bestSame.filter((x) => x >= prof.dups.warn).length / bestSame.length * 100).toFixed(1)} %; refuse without judge (>= ${prof.dups.cosine}): ${(bestSame.filter((x) => x >= prof.dups.cosine).length / bestSame.length * 100).toFixed(1)} %\n`);

// the title of a page as a query: its own sections (should win), then the best section of another page (the floor the rule has to clear)
const titles = pages.slice(0, 200);
const qv = await embed(titles.map((p) => `${prof.prefix.query}${p.title}`), cfg, 120_000, false);
const own: number[] = [], other: number[] = [], kept2: number[] = [];
titles.forEach((p, i) => {
  const q = Float32Array.from(qv[i]);
  const scored = units.map((u) => ({ path: u.path, score: dot(q, u.v) })).sort((a, b) => b.score - a.score);
  const mine = scored.find((s) => s.path === p.path), elsewhere = scored.find((s) => s.path !== p.path);
  if (mine) own.push(mine.score);
  if (elsewhere) other.push(elsewhere.score);
  kept2.push(keep(scored.slice(0, EMBED.pool * EMBED.vectorOversample), prof.query).length);
});
console.log("title as query: own best     ", pct(own));
console.log("title as query: best other   ", pct(other));
console.log(`units kept by the query rule (${JSON.stringify(prof.query)}): ${pct(kept2)}`);
