import { openWiki } from "./context";
import { pageId, pageState, type Page } from "./doc";
import { clip, judgeConfig, type JudgeConfig } from "./judge";
import { scorePages } from "./judge-scores";
import { isReservedPage } from "./lib";
import { LIMITS } from "./limits";
import { search } from "./search";
import { hasText, isEmpty, matches, parseQuery, type Doc, type Parsed } from "../site/src/lib/query";
import { fold } from "../site/src/lib/fold";

/**
 * `GET /api/search` (cortex serve): the hybrid search of `wiki/` (words, title typos and meaning: search.ts) with the operators of
 * the site's search bar, and, on request, a ranking by the judge.
 *
 * Operators: the site's own parser and matcher (site/src/lib/query.ts, imported, not copied) applied to the same metadata the export
 * puts in the site's search index (`status` and the review notion follow `drafts` and `review` of cortex.json). Free words go to the
 * hybrid search, which finds more than the site's word index (meaning, typos); the operators, exact phrases and exclusions then
 * filter what it found, so the same query keeps the same pages. Two differences, both reported: `is:fav` is the browser's own list
 * and is ignored here (`ignored: ["is:fav"]`), and the phrases and exclusions are checked against the page's Markdown made plain,
 * not the rendered HTML (a `⚠️` callout title is part of it, and `is:partial` only knows partial raw sources, not the warning
 * callouts of a body). A query with operators only lists the pages that pass them by title, as the site does (`match: "filter"`).
 *
 * The judge (`judge=1`, judge-scores.ts): see `rankByJudge`.
 */
export type SearchMatch = "lexical" | "semantic" | "both" | "filter";
export type Group = "retained" | "related" | "other" | "unjudged";
export type SearchHit = {
  /** The page as the site knows it (`concepts/x`). */
  id: string; path: string; title: string; type: string;
  /** Plain text: the start of the page's best section, or its description for a query with operators only. */
  extract: string;
  match: SearchMatch;
  /** The hybrid score, higher is better; informative: the order of the list is the one to follow. */
  score: number;
  /** With the judge: the probability, 0 to 1, that the page answers what the query looks for; absent when it was not judged. */
  relevance?: number;
  group?: Group;
};
export type SearchResult = { status: number; body: Record<string, unknown> };
/** Why a judged search came back without ranking. */
export type NotJudged = "not-configured" | "no-text" | "no-hits" | "unavailable";

/** The question of the judge: « answers what is searched » against « same topic », as for the site's questions (ask-site.ts). */
const RELEVANT = [
  "Decide whether `page` answers what `request.query` searches for.",
  "`request.query` is typed in a search box: a few keywords or a short phrase, not always a full question.",
  "Judge what the query looks for, not only its words: a page on the same subject that says nothing about what is searched is not relevant.",
  "Yes: the page contains at least one statement that answers or directly informs what the query searches for.",
  "No: the page shares the topic or words of the query, but none of its statements concerns what is searched.",
].join(" ");

const collator = new Intl.Collator(undefined);

/** Markdown as plain text, as the site's index holds a page's text (rendered, tags removed). */
export function plainText(md: string): string {
  const html = Bun.markdown.html(md, { tagFilter: true });
  return html.replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

/**
 * The same query without the `is:fav` operators, groups included, and whether there were any. An alternative of an OR group that
 * was only `is:fav` is dropped (the group then asks for the others), a group left with none is dropped.
 */
export function withoutFav(p: Parsed): { parsed: Parsed; removed: boolean } {
  let removed = false;
  const strip = (x: Parsed): Parsed => ({
    ...x,
    ops: x.ops.filter((o) => (o.key === "is" && o.value === "fav" ? ((removed = true), false) : true)),
    groups: x.groups.flatMap((g) => {
      const alts = g.alts.map((a) => ({ before: isEmpty(a), a: strip(a) })).filter((x) => x.before || !isEmpty(x.a)).map((x) => x.a);
      return alts.length ? [{ ...g, alts }] : [];
    }),
  });
  return { parsed: strip(p), removed };
}

const uses = (p: Parsed, key: string, value: string): boolean => p.ops.some((o) => o.key === key && o.value === value) || p.groups.some((g) => g.alts.some((a) => uses(a, key, value)));

/** `q` without its `-( … )` groups (nested parentheses respected). */
function dropNegatedGroups(q: string): string {
  let out = "", quote = false;
  for (let i = 0; i < q.length; i++) {
    const c = q[i]!;
    if (c === '"') quote = !quote;
    if (!quote && c === "-" && q[i + 1] === "(" && (i === 0 || /\s/.test(q[i - 1]!))) {
      let depth = 0, j = i + 1;
      for (; j < q.length; j++) { if (q[j] === "(") depth++; else if (q[j] === ")" && --depth === 0) break; }
      i = j; continue; // an unbalanced one runs to the end
    }
    out += c;
  }
  return out;
}

/** What the query looks for, without its operators, exclusions and group syntax: the text sent to the search and to the judge (accents and case kept). */
export function freeText(q: string): string {
  q = dropNegatedGroups(q);
  const keep = (t: string) => { const p = parseQuery(t); return !p.ops.length && !p.exclude.length && !p.groups.length; };
  return (q.replace(/[()|]/g, " ").match(/"[^"]*"|\S+/g) ?? []).filter(keep).map((t) => t.replace(/"/g, "")).join(" ").replace(/\s+/g, " ").trim();
}

/** The page as the site's search index holds it (`SearchDoc`); the text is made when a phrase, an exclusion or a group asks for it. */
function docOf(page: Page, features: { review: boolean; drafts: boolean }, partials: Set<string> | undefined): Doc {
  const fm = page.fm;
  let text: string | undefined;
  return {
    id: pageId(page.path), title: String(fm.title ?? pageId(page.path)), description: String(fm.description ?? ""), type: String(fm.type ?? ""), tags: (fm.tags ?? []).map(String),
    status: features.drafts || (fm.status ?? "draft") !== "draft" ? String(fm.status ?? "draft") : "stable",
    verified: features.review && !!fm.verified?.at,
    needsReview: features.review && pageState(fm).needsReview,
    partial: fm.type === "Source" && (fm.sources ?? []).some((s) => s.resource && partials?.has(String(s.resource).replace(/^\/+/, ""))),
    get text() { return (text ??= plainText(page.body)); },
  };
}

const truthy = (p: unknown) => p != null && p !== false && String(p).trim() !== "" && !/^(false|no|non|0)$/i.test(String(p).trim());

export type SearchOpts = {
  limit?: number;
  /** The caller asked for the judge's ranking. */
  judge?: boolean;
  /** Takes the one judged-search slot of the server: gives the function that frees it, or undefined when it is taken. */
  lock?: () => (() => void) | undefined;
};

/** Answer of `GET /api/search`. A failing search (broken cortex.json…) is a 500 with a message; the caller adds the headers. */
export async function searchSite(root: string, q: string, opts: SearchOpts = {}): Promise<SearchResult> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? LIMITS.searchLimit) || LIMITS.searchLimit, 1), LIMITS.searchMaxLimit);
  if (!q.trim() || q.length > LIMITS.searchQueryChars) return { status: 400, body: { error: `expected q (1 to ${LIMITS.searchQueryChars} characters)` } };
  const { parsed, removed } = withoutFav(parseQuery(q));
  const ignored = removed ? ["is:fav"] : undefined;
  const w = openWiki(root);
  const cfg = await w.config();
  const features = { review: !!cfg.review, drafts: !!cfg.drafts };
  const pages = (await w.pages()).filter((p) => !isReservedPage(p.path));
  const byPath = new Map(pages.map((p) => [p.path, p]));
  let partials: Set<string> | undefined;
  if (uses(parsed, "is", "partial")) partials = new Set((await w.raws()).filter((r) => truthy(r.fm.partial)).map((r) => r.path));
  const docs = new Map<string, Doc>();
  const doc = (p: Page) => docs.get(p.path) ?? docs.set(p.path, docOf(p, features, partials)).get(p.path)!;
  // the folded text of a page is only made when a phrase, an exclusion or a group needs it (a filter on tags lists a large wiki without reading its pages)
  const needsText = parsed.phrases.length > 0 || parsed.exclude.length > 0 || parsed.groups.length > 0;
  const ok = (p: Page) => matches(doc(p), parsed, () => false, needsText ? undefined : "");

  type Found = { page: Page; match: SearchMatch; score: number; extract: string };
  let found: Found[];
  const text = freeText(q);
  if (isEmpty(parsed)) found = [];
  else if (!hasText(parsed) || !text) {
    found = pages.filter(ok).sort((a, b) => collator.compare(doc(a).title, doc(b).title) || a.path.localeCompare(b.path))
      .map((page) => ({ page, match: "filter", score: 0, extract: clip(doc(page).description, LIMITS.snippetChars) }));
  } else {
    // all the words, else any of them (a question rarely has every word in one page); an OR group asks for any from the start
    const find = (any: boolean) => search(root, text, { in: "wiki", limit: LIMITS.searchPool, any }).catch(() => []);
    const first = parsed.groups.length ? await find(true) : await find(false);
    const hits = first.length || parsed.groups.length ? first : await find(true);
    found = hits.flatMap((h) => {
      const page = byPath.get(h.path);
      return page && ok(page) ? [{ page, match: h.match, score: Math.round(-h.score * 1e6) / 1e6, extract: h.snippet.replace(/[«»]/g, "").replace(/\s+/g, " ").trim() }] : [];
    });
  }

  const view = (f: Found): SearchHit => ({ id: pageId(f.page.path), path: f.page.path, title: doc(f.page).title, type: doc(f.page).type, extract: f.extract, match: f.match, score: f.score });
  if (!opts.judge) return { status: 200, body: { hits: found.slice(0, limit).map(view), judged: false, ...(ignored && { ignored }) } };
  return rankByJudge(root, text, hasText(parsed) && !!text, found, limit, view, doc, opts.lock, ignored);
}

/**
 * The judge's ranking of the hits that passed the operators (never judged before: a candidate the operators drop is not paid for).
 * The best `search_candidates` hybrid hits, whatever `limit` is, each judged alone against the free text of the query (judge-scores.ts:
 * at most `concurrency` calls at once, scores cached on disk, a failed call leaves that hit unjudged). Order: retained (at
 * `search_retained` or more) then related (from `search_related`), each by decreasing relevance, then the others, judged below
 * the bars or not judged, in the hybrid order; then `limit`. A query with no free text is not judged (`no-text`). The caller
 * gets `judged: false` and a `reason` when nothing was judged, and a 429 when another judged search is running.
 */
async function rankByJudge<F extends { page: Page }>(
  root: string, text: string, hasFree: boolean, found: F[], limit: number, view: (f: F) => SearchHit, doc: (p: Page) => Doc,
  lock: SearchOpts["lock"], ignored: string[] | undefined,
): Promise<SearchResult> {
  const plain = (reason: NotJudged): SearchResult => ({ status: 200, body: { hits: found.slice(0, limit).map(view), judged: false, reason, ...(ignored && { ignored }) } });
  if (!hasFree) return plain("no-text");
  const jc: JudgeConfig | undefined = await judgeConfig(root);
  if (!jc) return plain("not-configured");
  const candidates = found.slice(0, jc.searchCandidates);
  if (!candidates.length) return plain("no-hits");
  const release = lock?.();
  if (lock && !release) return { status: 429, body: { error: "a judged search is already running" } };
  try {
    const scores = await scorePages(root, jc, {
      purpose: "search", question: { type: "noul", instructions: RELEVANT }, request: { query: text }, key: [text],
      pages: candidates.map((c) => ({ path: c.page.path, page: { title: doc(c.page).title, description: doc(c.page).description, text: clip(c.page.body, LIMITS.searchJudgeChars) } })),
      what: (p) => `search « ${text} », « ${p.page.title} »`,
    });
    if (scores.every((s) => s === undefined)) return plain("unavailable");
    const rated = found.map((f, i) => ({ f, i, relevance: i < candidates.length ? scores[i] : undefined }));
    const group = (r: number | undefined): Group => (r === undefined ? "unjudged" : r >= jc.searchRetained ? "retained" : r >= jc.searchRelated ? "related" : "other");
    const rank = { retained: 0, related: 1, other: 2, unjudged: 2 };
    const hits = rated.map((x) => ({ ...x, group: group(x.relevance) }))
      .sort((a, b) => rank[a.group] - rank[b.group] || (rank[a.group] < 2 ? b.relevance! - a.relevance! : 0) || a.i - b.i)
      .slice(0, limit)
      .map((x): SearchHit => ({ ...view(x.f), ...(x.relevance !== undefined && { relevance: Math.round(x.relevance * 100) / 100 }), group: x.group }));
    return { status: 200, body: { hits, judged: true, model: jc.model, unjudged: hits.filter((h) => h.relevance === undefined).length, ...(ignored && { ignored }) } };
  } finally { release?.(); }
}
