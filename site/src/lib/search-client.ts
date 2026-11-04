import { resolve } from "$app/paths";
import { fold } from "./fold";
import { isEmpty, parseQuery } from "./query";
import { createEngine, rank, ranges, type Engine } from "./search-engine";
import type { SearchDoc, SearchIndex } from "./types";

export type { Engine };
export type Hit = { doc: SearchDoc; title: string; description: string; snippet: string };
export type FilterSuggestion = { label: string; insert: string; count?: number; hint?: string };

let engine: Promise<Engine> | undefined;

/** Charge l'index précalculé à l'export (une seule fois, gardé en mémoire). */
export const loadEngine = () =>
	(engine ??= (async () => {
		const [{ default: Fuse }, idx] = await Promise.all([
			import("fuse.js"),
			fetch(resolve("/search-index.json")).then((r) => r.json() as Promise<SearchIndex>),
		]);
		return createEngine(idx, Fuse);
	})());

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
 * Sans texte libre, les pages qui passent les filtres sont listées par titre.
 */
export function search(e: Engine, q: string, isFav: (id: string) => boolean, limit = 30): Hit[] {
	const p = parseQuery(q);
	if (isEmpty(p)) return [];
	return rank(e, p, isFav).slice(0, limit).map(({ doc, hits }) => {
		const text = doc.text, xs = ranges(text, hits);
		let snippet: string;
		if (xs.length) {
			const from = Math.max(0, xs[0][0] - 60), to = Math.min(text.length, from + 200);
			snippet = (from > 0 ? "… " : "") + mark(text, xs, from, to) + (to < text.length ? " …" : "");
		} else snippet = esc(text.slice(0, 160)) + (text.length > 160 ? " …" : "");
		return { doc, title: mark(doc.title, ranges(doc.title, hits)), description: mark(doc.description, ranges(doc.description, hits)), snippet };
	});
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
	const [, pre, last] = mm, toks = words(q);
	// pas de complétion derrière un mot qui n'est pas dans le vocabulaire (faute de frappe) : la recherche floue s'en charge
	const known = words(pre).every((h) => e.vocab.some((w) => w.startsWith(h)));
	const terms = known ? e.vocab.filter((w) => w.startsWith(last) && w !== last).slice(0, 4).map((w) => pre + w) : [];
	const titles = e.docs.filter((_, i) => toks.every((x) => e.titles[i].some((w) => w.startsWith(x)))).slice(0, 4);
	return { filters, terms, titles };
}
