import { matches, parseQuery, type Parsed } from "./query";
import type { Engine } from "./search-engine";
import type { SearchDoc } from "./types";

/**
 * Client of `GET /api/search` (`cortex serve`): the hybrid search (words, typos, meaning) and, on a validated search, the judge's
 * ranking. No SvelteKit here (testable by bun test). A static host has no /api/: the probe says so once and everything else
 * stays the site's own, in-browser search.
 */
export type ServerMatch = "lexical" | "semantic" | "both" | "filter";
export type ServerGroup = "retained" | "related" | "other" | "unjudged";
export type ServerHit = { id: string; title: string; type: string; extract: string; match: ServerMatch; relevance?: number; group?: ServerGroup };
export type NotJudged = "not-configured" | "no-text" | "no-hits" | "unavailable";
export type Hybrid = { hits: ServerHit[]; /** operators the server could not apply (`is:fav`: the browser's own list). */ ignored: string[] };
export type Judged = Hybrid & { judged: boolean; model?: string; reason?: NotJudged };

/** Most hits the server returns (`searchMaxLimit`): one request size, so that the palette and the results page share the cache. */
export const SERVER_LIMIT = 50;
/** Wait before the single new attempt of a judged search that found the server busy (429). */
export const RETRY_MS = 1500;
const API = "/api/search";

/** The search text of a query: only a query with free words or a phrase has something for the meaning to work on. */
export const worthAsking = (q: string): boolean => /[\p{L}\p{N}]/u.test(q) && hasFreeText(parseQuery(q));
function hasFreeText(p: Parsed): boolean {
	return p.words.length > 0 || p.phrases.length > 0 || p.groups.some((g) => !g.neg && g.alts.some(hasFreeText));
}

let probing: Promise<boolean> | undefined;
let failedAt = 0;
/**
 * Does this server have the search API? One HEAD, memoized: a definite answer (204 or 404) is kept for the page's life; a network
 * failure is not (the visitor may come back online), but is not retried for 30 s.
 */
export function probe(fetcher: typeof fetch = fetch): Promise<boolean> {
	if (probing) return probing;
	if (Date.now() - failedAt < 30_000 && failedAt) return Promise.resolve(false);
	const p = fetcher(API, { method: "HEAD" }).then((r) => r.status === 204, () => { failedAt = Date.now(); probing = undefined; return false; });
	return (probing = p);
}
/** For tests. */
export function resetServerSearch() { probing = undefined; failedAt = 0; hybridCache.clear(); judgedCache.clear(); }

const hybridCache = new Map<string, Hybrid>();
const judgedCache = new Map<string, Judged>();
const remember = <T>(m: Map<string, T>, k: string, v: T) => { m.delete(k); m.set(k, v); if (m.size > 40) m.delete(m.keys().next().value!); };
const key = (q: string) => q.trim();

export const cachedHybrid = (q: string) => hybridCache.get(key(q));
export const cachedJudged = (q: string) => judgedCache.get(key(q));

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((ok, no) => {
	if (signal.aborted) return no(new DOMException("aborted", "AbortError"));
	const id = setTimeout(() => { signal.removeEventListener("abort", stop); ok(); }, ms);
	const stop = () => { clearTimeout(id); no(new DOMException("aborted", "AbortError")); };
	signal.addEventListener("abort", stop, { once: true });
});

export class Busy extends Error {}

async function call(q: string, judge: boolean, signal: AbortSignal, fetcher: typeof fetch): Promise<Judged> {
	const url = `${API}?q=${encodeURIComponent(q)}&limit=${SERVER_LIMIT}${judge ? "&judge=1" : ""}`;
	const r = await fetcher(url, { signal, headers: { accept: "application/json" } });
	if (r.status === 429) throw new Busy();
	if (!r.ok) throw new Error(`HTTP ${r.status}`);
	const b = (await r.json()) as Partial<Judged>;
	return {
		hits: Array.isArray(b.hits) ? b.hits : [], ignored: Array.isArray(b.ignored) ? b.ignored : [],
		judged: b.judged === true, model: typeof b.model === "string" ? b.model : undefined, reason: b.reason,
	};
}

/** The hybrid results (no judge). Cached for the session; rejects on a network or server failure (the caller stays silent). */
export async function hybrid(q: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Hybrid> {
	const hit = cachedHybrid(q);
	if (hit) return hit;
	const { hits, ignored } = await call(q.trim(), false, signal, fetcher);
	const out = { hits, ignored };
	remember(hybridCache, key(q), out);
	return out;
}

/**
 * The judged results. A busy server (429: another judged search is running) gets one new attempt after `RETRY_MS`, then `Busy`
 * is thrown and the caller keeps the plain hybrid display. `unavailable` is a passing state: it is not cached.
 */
export async function judged(q: string, signal: AbortSignal, fetcher: typeof fetch = fetch, retryMs = RETRY_MS): Promise<Judged> {
	const hit = cachedJudged(q);
	if (hit) return hit;
	let out: Judged;
	try { out = await call(q.trim(), true, signal, fetcher); }
	catch (e) {
		if (!(e instanceof Busy)) throw e;
		await sleep(retryMs, signal);
		out = await call(q.trim(), true, signal, fetcher);
	}
	if (out.reason !== "unavailable") remember(judgedCache, key(q), out);
	return out;
}

const byId = new WeakMap<Engine, Map<string, number>>();
const indexOf = (e: Engine) => { let m = byId.get(e); if (!m) byId.set(e, (m = new Map(e.docs.map((d, i) => [d.id, i])))); return m; };

export type Row = { doc: SearchDoc; hit: ServerHit };

/**
 * The server's hits as the site's pages, in the server's order. A hit the site's index does not know (the wiki changed since the
 * export) is left out. `is:fav` is the browser's own list, which the server ignores: it is applied here, on that operator only
 * (the phrases and exclusions were already checked by the server, on its own text).
 */
export function rows(e: Engine, p: Parsed, res: Hybrid, isFav: (id: string) => boolean): Row[] {
	const idx = indexOf(e);
	const fav = res.ignored.includes("is:fav") ? { ...p, words: [], phrases: [], exclude: [], groups: [], ops: p.ops.filter((o) => o.key === "is" && o.value === "fav") } : undefined;
	const out: Row[] = [];
	for (const hit of res.hits) {
		const i = idx.get(hit.id);
		if (i === undefined) continue;
		const doc = e.docs[i];
		if (fav && !matches(doc, fav, isFav, "")) continue;
		out.push({ doc, hit });
	}
	return out;
}

/** The judge's three sections of the rows: retained, related, and the rest (judged below the bars, or not judged) in the hybrid order. */
export function sections(rs: Row[]): { retained: Row[]; related: Row[]; other: Row[] } {
	return {
		retained: rs.filter((r) => r.hit.group === "retained"),
		related: rs.filter((r) => r.hit.group === "related"),
		other: rs.filter((r) => r.hit.group !== "retained" && r.hit.group !== "related"),
	};
}

/** Only for the palette: the pages the meaning found that the words did not (never the ones already shown). */
export const semanticOnly = (rs: Row[], shown: Set<string>, max = 3): Row[] => rs.filter((r) => r.hit.match === "semantic" && !shown.has(r.doc.id)).slice(0, max);

