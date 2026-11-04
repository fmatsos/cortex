import type Fuse from "fuse.js";
import { fold } from "./fold";
import { matches, parseQuery, type Parsed } from "./query";
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
	const terms: Record<string, number[]> = {};
	docs.forEach((d, i) => {
		for (const w of new Set(tokens(`${d.title} ${d.description} ${d.tags.join(" ")} ${d.text}`))) (terms[w] ??= []).push(i);
	});
	return terms;
}

export type Engine = {
	docs: SearchDoc[];
	vocab: string[];
	titles: string[][]; // mots des titres, pour l'autocomplétion
	terms: Record<string, number[]>;
	sorted: string[]; // mots de l'index triés : recherche par préfixe en O(log n)
	fields: { t: Set<string>; d: Set<string>; g: Set<string> }[]; // mots du titre, de la description, des tags
	hay: string[]; // texte replié complet, pour les phrases exactes et les exclusions
	fuzzy: () => Fuse<string>; // construit au premier besoin
};

export function createEngine(idx: SearchIndex, FuseCtor: typeof Fuse): Engine {
	const sorted = Object.keys(idx.terms).sort();
	let fz: Fuse<string> | undefined;
	return {
		docs: idx.docs,
		vocab: idx.vocab,
		terms: idx.terms,
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
	if (e.terms[w]) out.set(w, EXACT);
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
		narrow([...m.keys()].flatMap((t) => e.terms[t]));
		return m;
	});
	for (const ph of p.phrases) for (const w of tokens(ph.text)) narrow(e.terms[w] ?? []);
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
				if (!has(e.terms[t], i)) continue;
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
