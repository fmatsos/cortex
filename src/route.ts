import type { Page } from "./doc";
import { type Wiki } from "./context";
import { EMBED, nearest } from "./embed";
import { clip, judge, JUDGE } from "./judge";
import { isReservedPage, slugify } from "./lib";
import { LIMITS } from "./limits";
import { nearDuplicate, nearTitle } from "./naming";
import { search } from "./search";
import { collator } from "./text";

// --- Pipeline routing (docs/PIPELINE.md §4.7 and §2.4): which wiki pages a source may touch (wide, deterministic, then
// sorted by the judge), and, for each subject the extraction found, the page it updates or a new page. No 4B call here.

export type Candidate = { path: string; title: string; type: string; description: string; /** Probability the judge gave (undefined: not judged). */ judged?: number };

/** `extract`: the numbered candidates of the extraction (10 max); `pool`: the 20-30 near pages the connections step reads, best first. */
export type Candidates = { extract: Candidate[]; pool: Candidate[] };

const isEligible = (p: Page) => (p.fm.type === "Concept" || p.fm.type === "Entity") && p.fm.status !== "deprecated" && !isReservedPage(p.path);
const toCandidate = (p: Page): Candidate => ({ path: p.path, title: String(p.fm.title ?? p.path), type: String(p.fm.type), description: String(p.fm.description ?? "") });

/**
 * The Concept and Entity pages a source may touch: core by meaning, one-link neighbours, shared tags, at most `pipelineCandidatesPool`,
 * sorted by the judge. Source and Synthesis pages (a Source is 1:1 with its raw source, a synthesis is reread, not enriched) and
 * deprecated pages never come back.
 */
export async function routeCandidates(w: Wiki, source: { title?: string; body: string }): Promise<Candidates> {
  const text = clip(`${source.title ?? ""}\n${source.body}`.trim(), LIMITS.routeChars);
  const byPath = new Map((await w.pages()).filter(isEligible).map((p) => [p.path, p]));
  const k = LIMITS.routeCandidates;

  // 1. core: the closest pages by embeddings; without them, BM25 on the title (and on its longer words, an AND of all of it is strict)
  const hits = await nearest(w.root, text, EMBED.topK, false);
  const score = new Map((hits ?? []).map((h) => [h.path, h.score]));
  let core = (hits ?? []).map((h) => h.path).filter((p) => byPath.has(p)).slice(0, k);
  if (!hits && source.title) {
    const words = [...new Set(source.title.split(/[^\p{L}\p{N}]+/u).filter((x) => x.length >= 4))].slice(0, 5);
    for (const q of [source.title, ...words]) {
      if (core.length >= k) break;
      for (const h of await search(w.root, q, { in: "wiki", limit: k })) if (byPath.has(h.path) && !core.includes(h.path)) core.push(h.path);
    }
    core = core.slice(0, k);
  }
  const taken = new Set(core);

  // 2. one-link neighbours: by the number of core pages they are linked to or from, then by embedding score
  const { links, backlinks } = await w.linkGraph();
  const around = new Map<string, number>();
  for (const c of core) for (const n of new Set([...(links.get(c) ?? []), ...(backlinks.get(c) ?? [])])) if (!taken.has(n) && byPath.has(n)) around.set(n, (around.get(n) ?? 0) + 1);
  const byScore = (a: string, b: string) => (score.get(b) ?? -2) - (score.get(a) ?? -2) || a.localeCompare(b);
  const neighbours = [...around.keys()].sort((a, b) => around.get(b)! - around.get(a)! || byScore(a, b));
  neighbours.forEach((n) => taken.add(n));

  // 3. pages with a tag that at least two core pages carry (a tag shared with one page only is too loose), by number of such tags
  const tagged = new Map<string, number>();
  for (const c of core) for (const t of new Set<string>(byPath.get(c)!.fm.tags ?? [])) tagged.set(t, (tagged.get(t) ?? 0) + 1);
  const shared = new Set([...tagged].filter(([, n]) => n >= 2).map(([t]) => t));
  const common = new Map<string, number>();
  for (const [path, p] of byPath) if (!taken.has(path)) { const n = new Set((p.fm.tags ?? []).filter((t) => shared.has(t))).size; if (n) common.set(path, n); }
  const byTags = [...common.keys()].sort((a, b) => common.get(b)! - common.get(a)! || byScore(a, b));

  // 4. bounds, in this priority order
  const pool = [...core, ...neighbours, ...byTags].slice(0, LIMITS.pipelineCandidatesPool).map((p) => toCandidate(byPath.get(p)!));
  if (pool.length < k) return { extract: pool, pool }; // small wiki: nothing to sort

  // 5. the judge sorts them by « does the source bring something to this page? » (one call, one question per page)
  const noul = (i: number) => ({ type: "noul" as const, instructions: `Does \`source\` bring information that belongs on the page \`pages[${i}]\` (a new fact, figure, example or nuance for it)?` });
  const a = await judge(w.root, { source: text, pages: pool.map((p) => ({ title: p.title, description: clip(p.description, 200) })) }, Object.fromEntries(pool.map((_, i) => [`p${i}`, noul(i)])), JUDGE.longTimeoutMs);
  if (!a) return { extract: pool.slice(0, k), pool }; // no judge: the order of the bounds
  const sorted = pool.map((p, i) => { const x = a[`p${i}`]; return { ...p, judged: x?.type === "noul" ? x.noul : 0 }; }).sort((x, y) => y.judged - x.judged); // stable
  return { extract: sorted.filter((p) => p.judged >= LIMITS.routeYes).slice(0, k), pool: sorted };
}

// --- One decision per subject (§2.4)

/** What routing needs of an extracted subject; the extraction may carry more (quotes…), it comes back untouched. */
export type RouteSubject = { kind: string; title: string; description: string; /** Number of the candidate page in the extraction's list, -1 for a new page. */ candidate: number; facts: { claim: string }[] };

/** `target`: the wiki page to update, none for a new page. `via`: what decided (the extraction's candidate, the duplicate guard by meaning, a title). */
export type Routed<S extends RouteSubject> = { subject: S; target?: string; via: "candidate" | "duplicate" | "title" | "new" };

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Decides for each subject, in the collator's order of titles (the same diff on every run): the page it updates or a new
 * page. A candidate of the right type wins; otherwise the same checks as `cortex new` (meaning, then title), run before
 * anything is written. Subjects landing on the same page, or on the same new title, are merged (facts of the later added,
 * a repeated claim kept once). A subject without a fact goes to `skipped`. `candidates` is the list the extraction saw.
 */
export async function routeSubjects<S extends RouteSubject>(w: Wiki, subjects: S[], candidates: { path: string }[]): Promise<{ routes: Routed<S>[]; skipped: S[] }> {
  const pages = (await w.pages()).filter((p) => !isReservedPage(p.path) && p.fm.status !== "deprecated");
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const routes: Routed<S>[] = [], skipped: S[] = [];
  for (const s of [...subjects].sort((a, b) => collator.compare(a.title, b.title))) {
    if (!s.facts.length) { skipped.push(s); continue; }
    let target: string | undefined, via: Routed<S>["via"] = "new";
    const cand = byPath.get(candidates[s.candidate]?.path ?? "");
    if (cand?.fm.type === s.kind) { target = cand.path; via = "candidate"; }
    else {
      const dup = await nearDuplicate(w.root, pages, s.kind, s.title, s.description);
      if (dup?.refuse) { target = dup.near[0].path; via = "duplicate"; }
      else {
        // the slug of a title is taken whatever the type (`cortex new` refuses it); a near title only within the type
        const slug = slugify(s.title, Infinity);
        const same = pages.find((p) => p.fm.title && (slugify(p.fm.title, Infinity) === slug || (p.fm.type === s.kind && nearTitle(String(p.fm.title), s.title))));
        if (same) { target = same.path; via = "title"; }
      }
    }
    const twin = routes.find((r) => target ? r.target === target : !r.target && (slugify(r.subject.title, Infinity) === slugify(s.title, Infinity) || (r.subject.kind === s.kind && nearTitle(r.subject.title, s.title))));
    if (!twin) { routes.push({ subject: s, target, via }); continue; }
    const seen = new Set(twin.subject.facts.map((f) => fold(f.claim)));
    twin.subject = { ...twin.subject, facts: [...twin.subject.facts, ...s.facts.filter((f) => !seen.has(fold(f.claim)) && seen.add(fold(f.claim)))] };
  }
  return { routes, skipped };
}
