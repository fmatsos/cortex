import type Fuse from "fuse.js";
import { fold } from "./fold";
import { t as tr } from "./i18n/index";
import { activeValues, allText, hasText, IS_VALUES, isEmpty, keyWord, matches, parseQuery, STATUS_VALUES, token, TYPE_VALUES, valueWord, valueWords, type Parsed } from "./query";
import type { SearchDoc, SearchIndex } from "./types";

/**
 * Search engine, with no dependency on SvelteKit (testable by bun test).
 * Inverted index built at export (folded word → pages): the cost of a search depends on the typed words, not on the size
 * of the wiki. Fuse is only used for typo tolerance, on the (short) list of words, never on the content.
 */

/** Words of a text, folded (no accents, lowercase). Same splitting at export and in the browser. */
export const tokens = (s: string): string[] => fold(s).match(/[\p{L}\p{N}]+/gu) ?? [];

/** Inverted index: each word (title, description, tags, full content) → numbers of the pages that contain it. */
export function buildTerms(docs: SearchDoc[]): Record<string, number[]> {
	// Map, not an object: "constructor", "toString"… are words like any other, not inherited properties
	const terms = new Map<string, number[]>();
	docs.forEach((d, i) => {
		for (const w of new Set(tokens(`${d.title} ${d.description} ${d.tags.join(" ")} ${d.text}`))) {
			const ids = terms.get(w);
			if (ids) ids.push(i); else terms.set(w, [i]);
		}
	});
	return Object.fromEntries(terms);
}

export type Engine = {
	docs: SearchDoc[];
	vocab: string[];
	titles: string[][]; // title words, for autocompletion
	terms: Map<string, number[]>;
	sorted: string[]; // sorted index words: prefix search in O(log n)
	fields: { t: Set<string>; d: Set<string>; g: Set<string> }[]; // words of the title, description, tags
	hay: string[]; // complete folded text, for exact phrases and exclusions
	fuzzy: () => Fuse<string>; // built on first need
};

export function createEngine(idx: SearchIndex, FuseCtor: typeof Fuse): Engine {
	const terms = new Map(Object.entries(idx.terms)); // Object.entries only reads own properties
	const sorted = [...terms.keys()].sort();
	let fz: Fuse<string> | undefined;
	return {
		docs: idx.docs,
		vocab: idx.vocab,
		terms,
		sorted,
		titles: idx.docs.map((d) => tokens(d.title)),
		fields: idx.docs.map((d) => ({ t: new Set(tokens(d.title)), d: new Set(tokens(d.description)), g: new Set(tokens(d.tags.join(" "))) })),
		hay: idx.docs.map((d) => fold(`${d.title} ${d.description} ${d.tags.join(" ")} ${d.text}`)),
		fuzzy: () => (fz ??= new FuseCtor(sorted, { threshold: 0.3, includeScore: true })),
	};
}

/** First index of `xs` (sorted) ≥ `x`. */
function lower<T>(xs: T[], x: T): number {
	let lo = 0, hi = xs.length;
	while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < x) lo = m + 1; else hi = m; }
	return lo;
}

const EXACT = 1, PREFIX = 0.7, FUZZY = 0.4;
const MAX_PREFIX = 200, MAX_FUZZY = 5;

/** Index words that match a typed word, with their quality: exact, prefix (typing in progress), close (typo). */
export function expand(e: Engine, w: string): Map<string, number> {
	const out = new Map<string, number>();
	if (e.terms.has(w)) out.set(w, EXACT);
	if (w.length >= 2)
		for (let i = lower(e.sorted, w), n = 0; i < e.sorted.length && e.sorted[i].startsWith(w) && n < MAX_PREFIX; i++, n++)
			if (!out.has(e.sorted[i])) out.set(e.sorted[i], PREFIX);
	// fuzzy matching is only for words not found: "fenetre" must not bring back "entre"
	if (w.length >= 4 && !out.size)
		for (const r of e.fuzzy().search(w, { limit: MAX_FUZZY }))
			if (!out.has(r.item)) out.set(r.item, FUZZY * (1 - (r.score ?? 0)));
	return out;
}

/** The page lists of a word are sorted (built in page order): membership in O(log n). */
const has = (ids: number[], i: number) => ids[lower(ids, i)] === i;

export type Ranked = { doc: SearchDoc; i: number; score: number; hits: Set<string> };

/**
 * Pages that match the query, ranked. Each free word must be found (AND), by exact word, prefix or close word;
 * the score weights the location (title 3 > description 1.5 > tags 1 > content 0.4) and the quality of the match.
 * The words of exact phrases narrow the candidates through the index before the check on the text.
 */
export function rank(e: Engine, p: Parsed, isFav: (id: string) => boolean): Ranked[] {
	let cand: Set<number> | undefined;
	const narrow = (ids: Iterable<number>) => {
		const s = new Set(ids);
		cand = cand ? new Set([...cand].filter((i) => s.has(i))) : s;
	};
	const perWord = p.words.map((w) => {
		const m = expand(e, w);
		narrow([...m.keys()].flatMap((t) => e.terms.get(t)!));
		return m;
	});
	for (const ph of p.phrases) for (const w of tokens(ph.text)) narrow(e.terms.get(w) ?? []);
	const ids = cand ?? new Set(e.docs.keys());
	// words of OR groups: they score and highlight, but do not narrow (only one alternative has to match)
	const top = new Set(p.words);
	perWord.push(...allText(p).words.filter((w) => !top.has(w)).map((w) => expand(e, w)));

	const out: Ranked[] = [];
	for (const i of ids) {
		const doc = e.docs[i];
		if (!matches(doc, p, isFav, e.hay[i])) continue;
		const f = e.fields[i], hits = new Set<string>();
		let score = 0;
		for (const m of perWord) {
			let best = 0;
			for (const [t, q] of m) {
				if (!has(e.terms.get(t)!, i)) continue;
				hits.add(t);
				best = Math.max(best, q * (f.t.has(t) ? 3 : f.d.has(t) ? 1.5 : f.g.has(t) ? 1 : 0.4));
			}
			score += best;
		}
		out.push({ doc, i, score, hits });
	}
	return out.sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title));
}

/**
 * Ranges [start, end[ of `text` to highlight, sorted and non-overlapping: the words that are part of `hits` and each
 * occurrence of the exact phrases `phrases` (folded). Folding must keep lengths, otherwise no range.
 */
export function ranges(text: string, hits: Set<string>, phrases: string[] = []): [number, number][] {
	const f = fold(text);
	if (f.length !== text.length || (!hits.size && !phrases.length)) return [];
	const found: [number, number][] = [];
	if (hits.size) for (const m of f.matchAll(/[\p{L}\p{N}]+/gu)) if (hits.has(m[0])) found.push([m.index!, m.index! + m[0].length]);
	for (const ph of phrases) if (ph) for (let at = f.indexOf(ph); at >= 0; at = f.indexOf(ph, at + ph.length)) found.push([at, at + ph.length]);
	found.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
	const out: [number, number][] = [];
	for (const r of found) {
		const last = out[out.length - 1];
		if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else out.push([r[0], r[1]]);
	}
	return out;
}

export const parse = parseQuery;

export type Hit = { doc: SearchDoc; title: string; description: string; snippet: string };
export type FilterSuggestion = { label: string; insert: string; count?: number; hint?: string };

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const words = (q: string) => fold(q).match(/[\p{L}\p{N}]+/gu) ?? [];

/** Escaped text with <mark> on the ranges [start, end[ between `from` and `to`. */
function mark(text: string, rs: [number, number][] = [], from = 0, to = text.length): string {
	let out = "", at = from;
	for (const [a, b] of rs) {
		if (b <= at || a >= to) continue;
		const s = Math.max(a, at), t = Math.min(b, to);
		out += esc(text.slice(at, s)) + `<mark>${esc(text.slice(s, t))}</mark>`;
		at = t;
	}
	return out + esc(text.slice(at, to));
}

/**
 * Results: filters, phrases and exclusions are resolved on the metadata and the text; free text goes through
 * the inverted index (exact word, prefix while typing, close word for a typo), title > description > tags > content.
 * Without free text, the pages that pass the filters are listed by title. `total`: exact number of pages, beyond `limit`.
 */
export function search(e: Engine, q: string, isFav: (id: string) => boolean, limit = 30): { hits: Hit[]; total: number } {
	const p = parseQuery(q);
	if (isEmpty(p)) return { hits: [], total: 0 };
	const all = rank(e, p, isFav);
	const phrases = allText(p).phrases, text_ = hasText(p);
	return { total: all.length, hits: all.slice(0, limit).map(({ doc, hits }) => {
		const text = doc.text, xs = ranges(text, hits, phrases);
		let snippet: string;
		if (xs.length) {
			// excerpt centered on the first occurrence: free word or exact phrase
			const from = Math.max(0, xs[0][0] - 60), to = Math.min(text.length, from + 200);
			snippet = (from > 0 ? "… " : "") + mark(text, xs, from, to) + (to < text.length ? " …" : "");
		} else if (!text_) snippet = ""; // filters only: no passage to show
		else snippet = esc(text.slice(0, 160)) + (text.length > 160 ? " …" : "");
		return { doc, title: mark(doc.title, ranges(doc.title, hits, phrases)), description: mark(doc.description, ranges(doc.description, hits, phrases)), snippet };
	}) };
}

/**
 * Titles suggested while typing: free words of the query as a prefix of the title's words, and the same conditions as
 * the results (filters, phrases, exclusions). Without a free word, no title: the results list covers this case.
 */
export function suggestTitles(e: Engine, p: Parsed, isFav: (id: string) => boolean, limit = 4): SearchDoc[] {
	if (!p.words.length) return [];
	const out: SearchDoc[] = [];
	for (let i = 0; i < e.docs.length && out.length < limit; i++)
		if (p.words.every((x) => e.titles[i].some((w) => w.startsWith(x))) && matches(e.docs[i], p, isFav, e.hay[i])) out.push(e.docs[i]);
	return out;
}

const count = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;
/** Operators offered on an empty input, in the site language (computed at call time: the visitor may switch language). */
export const keyHints = (): FilterSuggestion[] => [
	{ label: "#tag", insert: "#", hint: tr("search.hint.tag") },
	{ label: `${keyWord("type")}:`, insert: `${keyWord("type")}:`, hint: valueWords("type") },
	{ label: `${keyWord("status")}:`, insert: `${keyWord("status")}:`, hint: valueWords("status") },
	...IS_VALUES.map((v) => ({ label: token("is", v), insert: `${token("is", v)} `, hint: tr(`search.hint.${v}`) })),
];

/** Pages that pass the filters, phrases and exclusions of `p` (and its free words): the context of the counters. */
const contextDocs = (e: Engine, p: Parsed, isFav: (id: string) => boolean): SearchDoc[] => (isEmpty(p) ? e.docs : rank(e, p, isFav).map((r) => r.doc));
/** The same Parsed without the positive operators `keys`: what the facet being modified must not constrain. */
const without = (p: Parsed, ...keys: string[]): Parsed => ({ ...p, ops: p.ops.filter((o) => o.neg || !keys.includes(o.key)) });

export type Facets = {
	total: number;
	type: Record<string, number>;
	status: Record<string, number>;
	flags: { fav: number; unverified: number; review: number; partial: number };
	tags: { tag: string; count: number }[]; // most frequent first
};

/**
 * Facet counters in the context of the current query: the number of pages that choosing each value would give.
 * For `type` and `status` (single choice), only the facet being modified is removed; for tags and
 * indicators (which add up), we start from the current results. At most three rankings, never one per value.
 */
export function facetCounts(e: Engine, q: string, isFav: (id: string) => boolean): Facets {
	const p = parseQuery(q);
	const cur = contextDocs(e, p, isFav);
	const tally = (docs: SearchDoc[], by: (d: SearchDoc) => string) => {
		const out: Record<string, number> = {};
		for (const d of docs) out[by(d)] = (out[by(d)] ?? 0) + 1;
		return out;
	};
	const tags = new Map<string, { tag: string; count: number }>();
	for (const d of cur) for (const t of d.tags) {
		const k = fold(t), c = tags.get(k);
		if (c) c.count++; else tags.set(k, { tag: t, count: 1 });
	}
	return {
		total: cur.length,
		type: tally(contextDocs(e, without(p, "type"), isFav), (d) => d.type),
		status: tally(contextDocs(e, without(p, "status"), isFav), (d) => fold(d.status)),
		flags: {
			fav: count(cur, (d) => isFav(d.id)),
			unverified: count(cur, (d) => !d.verified),
			review: count(cur, (d) => !!d.needsReview),
			partial: count(cur, (d) => !!d.partial),
		},
		tags: [...tags.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
	};
}

/**
 * Autocompletion: filter values (`#`, `type:`, `status:`, `is:` with their page count), vocabulary terms
 * (prefix of the last word) and titles whose words start with the input.
 */
export function suggest(e: Engine, q: string, isFav: (id: string) => boolean): { filters: FilterSuggestion[]; terms: string[]; titles: SearchDoc[] } {
	const none = { filters: [], terms: [], titles: [] };
	if (!q.trim()) return { ...none, filters: keyHints() };
	const m = q.match(/(^|\s)(-?\(*)(\S*)$/);
	if (!m) return none; // the query ends with a space: nothing to complete
	const head = q.slice(0, m.index! + m[1].length) + m[2], tok = m[3], t = fold(tok);

	const values = (all: [string, string, number][], prefix: string): FilterSuggestion[] =>
		all.filter(([v]) => v.startsWith(prefix)).sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0])).slice(0, 8)
			.map(([, ins, n]) => ({ label: ins.trim(), insert: head + ins, count: n }));
	// counters in the context of the rest of the input: "#llm type:" counts the types among the #llm pages, not across the whole wiki
	const rest = parseQuery(q.slice(0, m.index! + m[1].length));
	const tagCounts = () => {
		const have = activeValues(rest, "tag"), c = new Map<string, [string, number]>();
		for (const d of contextDocs(e, rest, isFav)) for (const tag of d.tags) if (!have.has(fold(tag))) c.set(fold(tag), [tag, (c.get(fold(tag))?.[1] ?? 0) + 1]);
		return [...c].map(([k, [tag, n]]) => [k, tag, n] as [string, string, number]);
	};
	if (t.startsWith("#") || t.startsWith("tag:")) {
		const pre = t.replace(/^#|^tag:/, "");
		return { ...none, filters: values(tagCounts(), pre).map((f) => ({ ...f, label: `#${f.label}`, insert: `${head}#${f.label} ` })) };
	}
	const op = t.match(/^([a-z]+):(.*)$/);
	const key = op ? parseQuery(`${op[1]}:x`).ops[0]?.key : undefined;
	if (op && key && key !== "tag") {
		const pre = op[2];
		// a value matches by its English or French spelling, whatever the language the input started in
		const starts = (canon: string) => [valueWord(key, canon, "en"), valueWord(key, canon, "fr")].some((w) => w.startsWith(pre));
		const docs = contextDocs(e, key === "is" ? rest : without(rest, key), isFav);
		const all: [string, string, number][] =
			key === "type" ? TYPE_VALUES.filter(starts).map((ty) => [ty, `${token("type", ty)} `, count(docs, (d) => d.type === ty)])
			: key === "status" ? STATUS_VALUES.filter(starts).map((s) => [s, `${token("status", s)} `, count(docs, (d) => fold(d.status) === s)])
			: ([["fav", (d: SearchDoc) => isFav(d.id)], ["verified", (d: SearchDoc) => !!d.verified], ["unverified", (d: SearchDoc) => !d.verified],
				["review", (d: SearchDoc) => !!d.needsReview], ["partial", (d: SearchDoc) => !!d.partial]] as const)
				.filter(([v]) => starts(v)).map(([v, f]) => [v, `${token("is", v)} `, count(docs, f)]);
		// counters are contextual: a value with zero pages would lead to a dead end, so it is not offered
		return { ...none, filters: values(all, "").filter((f) => f.count !== 0) };
	}
	if (/^[a-z]+:/.test(t) || t.startsWith('"')) return none;

	const filters = t ? keyHints().filter((k) => fold(k.label).startsWith(t) && fold(k.label) !== t).map((k) => ({ ...k, insert: head + k.insert })) : [];
	const mm = fold(q).match(/^(.*?)([\p{L}\p{N}]+)$/u);
	if (!mm) return { ...none, filters };
	const [, pre, last] = mm;
	// no completion after a word that is not in the vocabulary (typo): fuzzy search takes care of it
	const known = words(pre).every((h) => e.vocab.some((w) => w.startsWith(h)));
	const terms = known ? e.vocab.filter((w) => w.startsWith(last) && w !== last).slice(0, 4).map((w) => pre + w) : [];
	return { filters, terms, titles: suggestTitles(e, parseQuery(q), isFav) };
}
