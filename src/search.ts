import { EMBED, queryUnits } from "./embed";
import { buildIndex, fold, type Index, type Kind } from "./search-index";
import { LIMITS } from "./limits";

/** `match`: how the page was found, by its words (or a typo of its title), by its meaning, or both. */
export type Hit = { path: string; title: string; area: "wiki" | "raw"; snippet: string; score: number; match: "lexical" | "semantic" | "both" };

export { buildIndex };

/**
 * Each term is quoted: the apostrophe or hyphen of free input does not break the FTS5 syntax. All terms, or `any` of them.
 * With `prefix`, the last term also matches the words it starts (a word being typed), when it is a plain word of 3 characters or more.
 */
export const ftsQuery = (q: string, any = false, prefix = false) => {
  const terms = q.split(/\s+/).filter(Boolean).map((t) => `"${t.replaceAll('"', '""')}"`);
  const last = q.split(/\s+/).filter(Boolean).at(-1);
  if (prefix && last && /^[\p{L}\p{N}]{3,}$/u.test(last)) terms[terms.length - 1] += "*";
  return terms.join(any ? " OR " : " ");
};

type Row = { id: number; path: string; kind: Kind; area: "wiki" | "raw"; title: string; page: string; snippet?: string };
const COLS = "d.id, d.path, d.kind, d.area, d.title, p.title AS page";
const JOIN = "JOIN docs p ON p.id = COALESCE(d.parent, d.id)";

/** Damerau-Levenshtein distance (a swapped pair of letters costs 1: the usual typo). */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** A query word that has this many letters is looked for with a tolerance for typos in the titles; a shorter one must be there exactly. */
const FUZZY_MIN = 5;
const close = (q: string, t: string) => q === t || (q.length >= FUZZY_MIN && (t.includes(q) || (t.length >= FUZZY_MIN && q.includes(t)) || distance(q, t) <= (q.length >= 9 ? 2 : 1)));

/** The pages whose title holds every word of the query, give or take a typo (trigrams find the candidates, a distance confirms). */
function fuzzyTitles(ix: Index, q: string, area?: string): Row[] {
  const ws = words(q);
  const grams = [...new Set(ws.filter((w) => w.length >= FUZZY_MIN).flatMap((w) => Array.from({ length: w.length - 2 }, (_, i) => w.slice(i, i + 3))))].slice(0, 60);
  if (!grams.length) return []; // words under 5 letters are the words ranking's business
  const rows = ix.db.query(`SELECT ${COLS} FROM fts_title t JOIN docs d ON d.id = t.rowid ${JOIN} WHERE fts_title MATCH $q ${area ? "AND d.area = $area" : ""} ORDER BY bm25(fts_title), d.path LIMIT 30`)
    .all({ $q: grams.map((g) => `"${g}"`).join(" OR "), ...(area && { $area: area }) }) as Row[];
  return rows.filter((r) => { const tw = words(r.title); return ws.every((w) => tw.some((t) => close(w, t))); }).slice(0, EMBED.pool);
}

const clip = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= LIMITS.snippetChars ? t : `${t.slice(0, t.lastIndexOf(" ", LIMITS.snippetChars) > 40 ? t.lastIndexOf(" ", LIMITS.snippetChars) : LIMITS.snippetChars)}…`;
};

type Cand = { path: string; area: "wiki" | "raw"; title: string; rrf: number; lexical: boolean; semantic: boolean; units: Map<number, { kind: Kind; weight: number; snippet?: string }> };

/**
 * Hybrid search of wiki/ and raw/ (search-index.ts): three rankings of the pages and sections, fused by reciprocal rank (RRF) and
 * folded to one result per page, at its best rank, wiki before raw. The rankings: BM25 over the words (title ×4; all of them, or
 * `any`; the last one also as a prefix), the titles that hold the words give or take a typo (trigrams), and, with `embed` configured and indexed, the nearest
 * vectors. The extract is the one of the page's best section (the page itself when none matched), also for a page found only by its
 * meaning. With `titles`, the match is on the title only (duplicate check). Vectors never fail the search: unavailable, the
 * answer is the words'. `score`: lower is better.
 */
export async function search(root: string, q: string, opts: { in?: "wiki" | "raw"; limit?: number; titles?: boolean; any?: boolean } = {}): Promise<Hit[]> {
  const limit = opts.limit ?? 20;
  if (limit <= 0) return [];
  const ix = await buildIndex(root);
  try {
    const area = opts.in, where = `${area ? "AND d.area = $area" : ""} ${opts.titles ? "AND d.kind = 'page'" : ""}`;
    // One row per page (its best unit): the pool counts pages, not units, so a page with many matching sections cannot hide the others.
    const lexical = ix.db.query(`
      SELECT * FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY pid ORDER BY score, path) AS rn FROM (
          SELECT ${COLS}, p.id AS pid, snippet(fts, 1, '«', '»', '…', ${LIMITS.snippetTokens}) AS snippet, bm25(fts, 4, 1) AS score
          FROM fts JOIN docs d ON d.id = fts.rowid ${JOIN} WHERE fts MATCH $q ${where}
        )
      ) WHERE rn = 1 ORDER BY area = 'raw', score, path LIMIT $pool`)
      .all({ $q: opts.titles ? `title : (${ftsQuery(q, opts.any)})` : ftsQuery(q, opts.any, true), $pool: EMBED.pool, ...(area && { $area: area }) }) as Row[];
    const fuzzy = opts.titles ? [] : fuzzyTitles(ix, q, area);
    const near = !opts.titles && area !== "raw" && q.trim() ? await queryUnits(root, ix, q) : undefined;
    let sem: Row[] = [];
    if (near?.length) {
      const score = new Map(near.map((n) => [n.id, n.score]));
      sem = (ix.db.query(`SELECT ${COLS} FROM docs d ${JOIN} WHERE d.id IN (${near.map(() => "?").join(",")})`).all(...near.map((n) => n.id)) as Row[])
        .sort((a, b) => score.get(b.id)! - score.get(a.id)! || a.id - b.id);
    }

    const cands = new Map<string, Cand>();
    const fuse = (rows: Row[], by: "lexical" | "semantic") => {
      const seen = new Set<string>();
      rows.forEach((r, i) => {
        const c = cands.get(r.path) ?? cands.set(r.path, { path: r.path, area: r.area, title: r.page, rrf: 0, lexical: false, semantic: false, units: new Map() }).get(r.path)!;
        const u = c.units.get(r.id) ?? c.units.set(r.id, { kind: r.kind, weight: 0 }).get(r.id)!;
        u.weight += 1 / (EMBED.rrfK + i + 1); // which section is the page's best one
        if (by === "lexical" && r.snippet !== undefined) u.snippet ??= r.snippet;
        if (!seen.has(r.path)) { seen.add(r.path); c.rrf += 1 / (EMBED.rrfK + seen.size); c[by] = true; } // the page, at its best unit's place among the pages
      });
    };
    fuse(lexical, "lexical"); fuse(fuzzy, "lexical"); fuse(sem, "semantic");

    const ranked = [...cands.values()].sort((a, b) => Number(a.area === "raw") - Number(b.area === "raw") || b.rrf - a.rrf || a.path.localeCompare(b.path)).slice(0, limit);
    return ranked.map((c) => {
      const units = [...c.units.entries()].map(([id, u]) => ({ id, ...u }));
      const best = units.filter((u) => u.kind === "passage").sort((a, b) => b.weight - a.weight || a.id - b.id)[0] ?? units.sort((a, b) => b.weight - a.weight || a.id - b.id)[0];
      const snippet = best.snippet ?? clip((ix.db.query("SELECT body FROM docs WHERE id = ?").get(best.id) as { body: string }).body);
      return { path: c.path, title: c.title, area: c.area, snippet, score: -c.rrf, match: c.lexical && c.semantic ? "both" : c.semantic ? "semantic" : "lexical" } satisfies Hit;
    });
  } finally { ix.close(); }
}

/** A hit of a search over several spaces: the space it comes from. */
export type SpaceHit = Hit & { space: string };

/**
 * `search` in each space, then one list: each space's ranking fused by reciprocal rank (the same `EMBED.rrfK`), a tie going to the
 * first space listed. Wiki before raw, as in a single space; `score`: lower is better.
 */
export async function searchSpaces(spaces: { space: string; root: string }[], q: string, opts: Parameters<typeof search>[2] = {}): Promise<SpaceHit[]> {
  const lists = await Promise.all(spaces.map(async ({ space, root }) => (await search(root, q, opts)).map((h, i): SpaceHit => ({ ...h, space, score: -1 / (EMBED.rrfK + i + 1) }))));
  return lists.flat().sort((a, b) => Number(a.area === "raw") - Number(b.area === "raw") || a.score - b.score).slice(0, opts.limit ?? 20);
}
