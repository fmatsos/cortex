import type Fuse from "fuse.js";
import { fold } from "./fold";
import { isEmpty, matches, parseQuery, type Parsed } from "./query";
import type { SearchDoc, SearchIndex } from "./types";

/**
 * Moteur de recherche, sans dépendance à SvelteKit (testable par bun test).
 * Index inversé construit à l'export (mot replié → pages) : le coût d'une recherche dépend des mots tapés, pas de la taille
 * du wiki. Fuse ne sert qu'à la tolérance aux fautes, sur la liste des mots (courts), jamais sur le contenu.
 */

/** Mots d'un texte, repliés (sans accents, minuscules). Même découpage à l'export et dans le navigateur. */
export const tokens = (s: string): string[] => fold(s).match(/[\p{L}\p{N}]+/gu) ?? [];

/** Index inversé : chaque mot (titre, description, tags, contenu complet) → numéros des pages qui le contiennent. */
export function buildTerms(docs: SearchDoc[]): Record<string, number[]> {
	// Map, pas un objet : « constructor », « toString »… sont des mots comme les autres, pas des propriétés héritées
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
	titles: string[][]; // mots des titres, pour l'autocomplétion
	terms: Map<string, number[]>;
	sorted: string[]; // mots de l'index triés : recherche par préfixe en O(log n)
	fields: { t: Set<string>; d: Set<string>; g: Set<string> }[]; // mots du titre, de la description, des tags
	hay: string[]; // texte replié complet, pour les phrases exactes et les exclusions
	fuzzy: () => Fuse<string>; // construit au premier besoin
};

export function createEngine(idx: SearchIndex, FuseCtor: typeof Fuse): Engine {
	const terms = new Map(Object.entries(idx.terms)); // Object.entries ne lit que les propriétés propres
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

/** Premier indice de `xs` (trié) ≥ `x`. */
function lower<T>(xs: T[], x: T): number {
	let lo = 0, hi = xs.length;
	while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < x) lo = m + 1; else hi = m; }
	return lo;
}

const EXACT = 1, PREFIX = 0.7, FUZZY = 0.4;
const MAX_PREFIX = 200, MAX_FUZZY = 5;

/** Mots de l'index qui répondent à un mot saisi, avec leur qualité : exact, préfixe (frappe en cours), proche (faute). */
export function expand(e: Engine, w: string): Map<string, number> {
	const out = new Map<string, number>();
	if (e.terms.has(w)) out.set(w, EXACT);
	if (w.length >= 2)
		for (let i = lower(e.sorted, w), n = 0; i < e.sorted.length && e.sorted[i].startsWith(w) && n < MAX_PREFIX; i++, n++)
			if (!out.has(e.sorted[i])) out.set(e.sorted[i], PREFIX);
	if (w.length >= 4)
		for (const r of e.fuzzy().search(w, { limit: MAX_FUZZY }))
			if (!out.has(r.item)) out.set(r.item, FUZZY * (1 - (r.score ?? 0)));
	return out;
}

/** Les listes de pages d'un mot sont triées (construites dans l'ordre des pages) : appartenance en O(log n). */
const has = (ids: number[], i: number) => ids[lower(ids, i)] === i;

export type Ranked = { doc: SearchDoc; i: number; score: number; hits: Set<string> };

/**
 * Pages qui répondent à la requête, classées. Chaque mot libre doit être trouvé (ET), par mot exact, préfixe ou proche ;
 * le score pondère l'endroit (titre 3 > description 1,5 > tags 1 > contenu 0,4) et la qualité de la correspondance.
 * Les mots des phrases exactes resserrent les candidats par l'index avant la vérification sur le texte.
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

/** Plages [début, fin[ des mots de `text` qui font partie de `hits` (le repli garde les longueurs). */
export function ranges(text: string, hits: Set<string>): [number, number][] {
	const f = fold(text);
	if (f.length !== text.length || !hits.size) return [];
	const out: [number, number][] = [];
	for (const m of f.matchAll(/[\p{L}\p{N}]+/gu)) if (hits.has(m[0])) out.push([m.index!, m.index! + m[0].length]);
	return out;
}

export const parse = parseQuery;

export type Hit = { doc: SearchDoc; title: string; description: string; snippet: string };
export type FilterSuggestion = { label: string; insert: string; count?: number; hint?: string };

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const words = (q: string) => fold(q).match(/[\p{L}\p{N}]+/gu) ?? [];

/** Texte échappé avec <mark> sur les plages [début, fin[ comprises entre `from` et `to`. */
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
 * Résultats : les filtres, phrases et exclusions se résolvent sur les métadonnées et le texte ; le texte libre passe par
 * l'index inversé (mot exact, préfixe pendant la frappe, mot proche pour une faute), titre > description > tags > contenu.
 * Sans texte libre, les pages qui passent les filtres sont listées par titre. `total` : nombre exact de pages, au-delà de `limit`.
 */
export function search(e: Engine, q: string, isFav: (id: string) => boolean, limit = 30): { hits: Hit[]; total: number } {
	const p = parseQuery(q);
	if (isEmpty(p)) return { hits: [], total: 0 };
	const all = rank(e, p, isFav);
	return { total: all.length, hits: all.slice(0, limit).map(({ doc, hits }) => {
		const text = doc.text, xs = ranges(text, hits);
		let snippet: string;
		if (xs.length) {
			const from = Math.max(0, xs[0][0] - 60), to = Math.min(text.length, from + 200);
			snippet = (from > 0 ? "… " : "") + mark(text, xs, from, to) + (to < text.length ? " …" : "");
		} else snippet = esc(text.slice(0, 160)) + (text.length > 160 ? " …" : "");
		return { doc, title: mark(doc.title, ranges(doc.title, hits)), description: mark(doc.description, ranges(doc.description, hits)), snippet };
	}) };
}

/**
 * Titres proposés pendant la frappe : mots libres de la requête en préfixe des mots du titre, et les mêmes conditions que
 * les résultats (filtres, phrases, exclusions). Sans mot libre, aucun titre : la liste des résultats couvre ce cas.
 */
export function suggestTitles(e: Engine, p: Parsed, isFav: (id: string) => boolean, limit = 4): SearchDoc[] {
	if (!p.words.length) return [];
	const out: SearchDoc[] = [];
	for (let i = 0; i < e.docs.length && out.length < limit; i++)
		if (p.words.every((x) => e.titles[i].some((w) => w.startsWith(x))) && matches(e.docs[i], p, isFav, e.hay[i])) out.push(e.docs[i]);
	return out;
}

const count = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;
const KEY_HINTS: FilterSuggestion[] = [
	{ label: "#tag", insert: "#", hint: "filtrer par tag" },
	{ label: "type:", insert: "type:", hint: "concept, entity, synthesis, source" },
	{ label: "status:", insert: "status:", hint: "draft, stable, deprecated" },
	{ label: "is:fav", insert: "is:fav ", hint: "mes favoris" },
	{ label: "is:unverified", insert: "is:unverified ", hint: "jamais relues" },
];

/**
 * Autocomplétion : valeurs des filtres (`#`, `type:`, `status:`, `is:` avec leur nombre de pages), termes du vocabulaire
 * (préfixe du dernier mot) et titres dont les mots commencent par la saisie.
 */
export function suggest(e: Engine, q: string, isFav: (id: string) => boolean): { filters: FilterSuggestion[]; terms: string[]; titles: SearchDoc[] } {
	const none = { filters: [], terms: [], titles: [] };
	if (!q.trim()) return { ...none, filters: KEY_HINTS };
	const m = q.match(/(^|\s)(-?)(\S*)$/);
	if (!m) return none; // la requête se termine par une espace : rien à compléter
	const head = q.slice(0, m.index! + m[1].length) + m[2], tok = m[3], t = fold(tok);

	const values = (all: [string, string, number][], prefix: string): FilterSuggestion[] =>
		all.filter(([v]) => v.startsWith(prefix)).sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0])).slice(0, 8)
			.map(([, ins, n]) => ({ label: ins.trim(), insert: head + ins, count: n }));
	const tagCounts = () => {
		const c = new Map<string, [string, number]>();
		for (const d of e.docs) for (const tag of d.tags) c.set(fold(tag), [tag, (c.get(fold(tag))?.[1] ?? 0) + 1]);
		return [...c].map(([k, [tag, n]]) => [k, tag, n] as [string, string, number]);
	};
	if (t.startsWith("#") || t.startsWith("tag:")) {
		const pre = t.replace(/^#|^tag:/, "");
		return { ...none, filters: values(tagCounts(), pre).map((f) => ({ ...f, label: `#${f.label}`, insert: `${head}#${f.label} ` })) };
	}
	const op = t.match(/^(type|status|is):(.*)$/);
	if (op) {
		const [, key, pre] = op;
		const all: [string, string, number][] =
			key === "type" ? ["Concept", "Entity", "Synthesis", "Source"].map((ty) => [ty.toLowerCase(), `type:${ty.toLowerCase()} `, count(e.docs, (d) => d.type === ty)])
			: key === "status" ? ["draft", "stable", "deprecated"].map((s) => [s, `status:${s} `, count(e.docs, (d) => fold(d.status) === s)])
			: [["fav", "is:fav ", count(e.docs, (d) => isFav(d.id))], ["unverified", "is:unverified ", count(e.docs, (d) => !d.verified)]];
		return { ...none, filters: values(all, pre).filter((f) => f.count !== 0 || key !== "is") };
	}
	if (/^[a-z]+:/.test(t) || t.startsWith('"')) return none;

	const filters = t ? KEY_HINTS.filter((k) => fold(k.label).startsWith(t) && fold(k.label) !== t).map((k) => ({ ...k, insert: head + k.insert })) : [];
	const mm = fold(q).match(/^(.*?)([\p{L}\p{N}]+)$/u);
	if (!mm) return { ...none, filters };
	const [, pre, last] = mm;
	// pas de complétion derrière un mot qui n'est pas dans le vocabulaire (faute de frappe) : la recherche floue s'en charge
	const known = words(pre).every((h) => e.vocab.some((w) => w.startsWith(h)));
	const terms = known ? e.vocab.filter((w) => w.startsWith(last) && w !== last).slice(0, 4).map((w) => pre + w) : [];
	return { filters, terms, titles: suggestTitles(e, parseQuery(q), isFav) };
}
