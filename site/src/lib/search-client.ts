import { resolve } from "$app/paths";
import type Fuse from "fuse.js";
import { fold } from "./fold";
import { isEmpty, matches, parseQuery } from "./query";
import { FUSE_OPTIONS } from "./search-config";
import type { SearchDoc, SearchIndex } from "./types";

export type Engine = { fuse: Fuse<SearchDoc>; docs: SearchDoc[]; vocab: string[]; titles: string[][] };
export type Hit = { doc: SearchDoc; title: string; description: string; snippet: string };
export type FilterSuggestion = { label: string; insert: string; count?: number; hint?: string };

let engine: Promise<Engine> | undefined;

/** Charge l'index précalculé à l'export (une seule fois, gardé en mémoire) : Fuse n'a rien à reconstruire. */
export const loadEngine = () =>
	(engine ??= (async () => {
		const [{ default: Fuse }, idx] = await Promise.all([
			import("fuse.js"),
			fetch(resolve("/search-index.json")).then((r) => r.json() as Promise<SearchIndex>),
		]);
		const fuse = new Fuse(idx.docs, { ...FUSE_OPTIONS, useExtendedSearch: true }, Fuse.parseIndex(idx.index as any));
		return { fuse, docs: idx.docs, vocab: idx.vocab, titles: idx.docs.map((d) => fold(d.title).match(/[\p{L}\p{N}]+/gu) ?? []) };
	})());

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const words = (q: string) => fold(q).match(/[\p{L}\p{N}]+/gu) ?? [];

/** Texte échappé avec <mark> sur les plages [début, fin] (fin incluse) de Fuse, fusionnées. */
function mark(text: string, ranges: readonly (readonly [number, number])[] = [], from = 0, to = text.length): string {
	const rs = ranges.map(([a, b]) => [Math.max(a, from), Math.min(b + 1, to)] as const).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
	let out = "", at = from;
	for (const [a, b] of rs) {
		if (b <= at) continue;
		const s = Math.max(a, at);
		out += esc(text.slice(at, s)) + `<mark>${esc(text.slice(s, b))}</mark>`;
		at = b;
	}
	return out + esc(text.slice(at, to));
}

/**
 * Résultats : les filtres, phrases et exclusions de la requête se résolvent sur les métadonnées ; le texte libre passe par
 * Fuse (titre > description > tags > contenu, sans accents ni casse, tolérant aux fautes). Sans texte libre, les pages
 * qui passent les filtres sont listées par titre.
 */
export function search(e: Engine, q: string, isFav: (id: string) => boolean, limit = 30): Hit[] {
	const p = parseQuery(q);
	if (isEmpty(p)) return [];
	const ok = (d: SearchDoc) => matches(d, p, isFav);
	if (!p.words.length)
		return e.docs.filter(ok).sort((a, b) => a.title.localeCompare(b.title)).slice(0, limit)
			.map((doc) => ({ doc, title: esc(doc.title), description: esc(doc.description), snippet: "" }));
	// recherche étendue de Fuse : les mots séparés par une espace se combinent en ET, chacun en correspondance floue
	return e.fuse.search(p.words.join(" ")).filter((r) => ok(r.item)).slice(0, limit).map((r) => {
		const range = (key: string) => r.matches?.find((m) => m.key === key)?.indices ?? [];
		const doc = r.item, text = doc.text, xs = range("x");
		let snippet = "";
		if (xs.length && fold(text).length === text.length) {
			const from = Math.max(0, xs[0][0] - 60);
			snippet = (from > 0 ? "… " : "") + mark(text, xs, from, Math.min(text.length, from + 200)) + (from + 200 < text.length ? " …" : "");
		} else snippet = esc(text.slice(0, 160)) + (text.length > 160 ? " …" : "");
		return { doc, title: mark(doc.title, range("t")), description: mark(doc.description, range("d")), snippet };
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
