import { fold } from "./fold";
import type { Parsed } from "./query";
import type { Link, PageData, SourceRef, TocItem } from "./types";
import { TYPES } from "./type-meta";

/**
 * Logique pure de la page article (testée par cli/src/article.test.ts) : sommaire, section courante, pages liées,
 * source originale, liens vers le graphe et les collections, termes à surligner à la lecture.
 * Aucune dépendance à SvelteKit : les composants n'ont plus qu'à afficher.
 */

// --- Sommaire ---------------------------------------------------------------------------------------------------

/** Ancres des sections que le composant ajoute après le corps (voir +page.svelte). */
export const NOTES_ID = "h-notes";
export const SOURCES_ID = "h-sources";

/** Les titres du corps, suivis de Notes et Sources lorsqu'elles existent (UX20) : une seule liste, un seul suivi de section. */
export function tocItems(toc: TocItem[], notes: number, sources: number): TocItem[] {
	return [
		...toc,
		...(notes ? [{ level: 2 as const, id: NOTES_ID, text: `Notes (${notes})` }] : []),
		...(sources ? [{ level: 2 as const, id: SOURCES_ID, text: `Sources (${sources})` }] : []),
	];
}

/** Longueur (en caractères de HTML) à partir de laquelle une page à deux sections mérite déjà un sommaire. */
export const LONG_PAGE = 2500;

/**
 * Le sommaire s'affiche dès deux sections (Notes et Sources comprises) si la page est longue, dès trois sinon (UX21) :
 * le nombre de titres du corps n'est pas un bon seuil, une page très citée reste navigable.
 */
export const showToc = (items: TocItem[], htmlLength: number) => items.length >= 3 || (items.length === 2 && htmlLength >= LONG_PAGE);

/**
 * Section courante : le dernier titre passé sous la ligne `limit` (distance depuis le haut de la fenêtre). Tout en bas
 * de la page, c'est la dernière section (une section finale courte n'atteindrait jamais la ligne).
 */
export function currentSection(tops: { id: string; top: number }[], limit: number, atEnd = false): string {
	if (!tops.length) return "";
	if (atEnd) return tops[tops.length - 1].id;
	return tops.findLast((t) => t.top <= limit)?.id ?? "";
}

// --- Pages liées ------------------------------------------------------------------------------------------------

export type RelatedIn = Link & { reasons: string[] };
export type RelatedEntry = Link & { why: string[] };

/**
 * Les raisons d'une page liée telles que l'export les écrit (« lien sortant », « source partagée » répété une fois par
 * source, « tag partagé : x »…), ramenées à des motifs courts et dédupliqués. `shared` : titres des sources partagées.
 */
export function relatedReasons(reasons: string[], shared: string[] = []): string[] {
	const has = (r: string) => reasons.includes(r);
	const tags = [...new Set(reasons.filter((r) => r.startsWith("tag partagé")).map((r) => r.replace(/^tag partagé\s*:\s*/, "")).filter(Boolean))];
	return [
		...(has("lien sortant") ? ["citée dans cette page"] : []),
		...(has("lien entrant") ? ["cite cette page"] : []),
		...(has("source partagée") || shared.length ? [shared.length ? `source commune : ${shared.join(", ")}` : "source commune"] : []),
		...(tags.length ? [`thème commun : ${tags.join(", ")}`] : []),
	];
}

/**
 * Pages à explorer : les pages liées qui ne sont pas déjà des rétroliens (UX22 : une destination n'apparaît qu'une fois),
 * chacune avec ses motifs dédupliqués (UX23).
 */
export function relatedEntries(backlinks: Link[], related: RelatedIn[], shared: Record<string, string[]> = {}): RelatedEntry[] {
	const back = new Set(backlinks.map((b) => b.id));
	return related.filter((r) => !back.has(r.id)).map(({ reasons, ...link }) => ({ ...link, why: relatedReasons(reasons, shared[link.id]) }));
}

/** Titres des sources que chaque page liée partage avec la page courante (côté serveur : le site connaît toutes les pages). */
export function sharedSources(page: Pick<PageData, "sources" | "related">, pages: Pick<PageData, "id" | "sources">[]): Record<string, string[]> {
	const mine = new Set(page.sources.map((s) => s.id)), out: Record<string, string[]> = {};
	const wanted = new Set(page.related.map((r) => r.id)), byId = new Map(pages.filter((p) => wanted.has(p.id)).map((p) => [p.id, p]));
	for (const r of page.related) {
		const titles = byId.get(r.id)?.sources.filter((s) => mine.has(s.id)).map((s) => s.title) ?? [];
		if (titles.length) out[r.id] = [...new Set(titles)];
	}
	return out;
}

// --- Liens ------------------------------------------------------------------------------------------------------

/** Domaine affiché d'un lien externe (sans `www.`), ou `""` si l'URL est illisible. */
export function domainOf(url: string): string {
	try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

/** La source originale d'une page : la première source qui porte une URL (UX18). */
export function originalSource(sources: SourceRef[]): (SourceRef & { url: string; domain: string }) | undefined {
	const s = sources.find((x) => x.url);
	return s && { ...s, url: s.url!, domain: domainOf(s.url!) };
}

/** Requête du graphe : `?focus=<id>`, l'id étant celui du nœud (`concepts/context-rot`, barres conservées pour rester lisible). */
export const graphFocus = (id: string) => `?focus=${encodeURIComponent(id).replace(/%2F/gi, "/")}`;

/** Requête de la collection d'un type de page (`type:concept`), ou `undefined` pour un type inconnu. */
export const collectionQuery = (type: string) => (TYPES.some((t) => t.type === type) ? `?q=${encodeURIComponent(`type:${type.toLowerCase()}`)}` : undefined);
export const collectionLabel = (type: string) => TYPES.find((t) => t.type === type)?.plural ?? type;

/** Lien à copier : l'adresse de la page sans le contexte de recherche (`?q=`) qui ne fait pas partie de la page. */
export function shareUrl(href: string): string {
	try { const u = new URL(href); u.searchParams.delete("q"); return u.toString(); } catch { return href; }
}

// --- Lecture d'un résultat de recherche (UX26) -------------------------------------------------------------------

export type HitTerms = { words: string[]; phrases: string[] };

/** Termes de la requête qui se cherchent dans le texte : mots libres et phrases exactes (les filtres et exclusions n'en sont pas). */
export const hitTerms = (p: Parsed): HitTerms => ({ words: [...new Set(p.words)], phrases: p.phrases.map((x) => x.text) });
export const hasTerms = (t: HitTerms) => t.words.length > 0 || t.phrases.length > 0;

/**
 * Plages [début, fin[ d'un texte qui répondent aux termes : un mot du texte qui commence par un mot saisi (la frappe en
 * cours compte, comme dans la recherche ; une lettre seule doit être le mot entier), ou une phrase exacte. Insensible aux
 * accents et à la casse. Les plages qui se chevauchent sont fusionnées. Un texte dont le repli change de longueur est ignoré
 * (le surlignage ne se décalerait pas, il serait faux).
 */
export function hitRanges(text: string, t: HitTerms): [number, number][] {
	const f = fold(text);
	if (f.length !== text.length) return [];
	const rs: [number, number][] = [];
	if (t.words.length)
		for (const m of f.matchAll(/[\p{L}\p{N}]+/gu))
			if (t.words.some((w) => m[0] === w || (w.length >= 2 && m[0].startsWith(w)))) rs.push([m.index!, m.index! + m[0].length]);
	for (const ph of t.phrases)
		for (let i = f.indexOf(ph); ph && i >= 0; i = f.indexOf(ph, i + ph.length)) rs.push([i, i + ph.length]);
	rs.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
	const out: [number, number][] = [];
	for (const r of rs) {
		const last = out[out.length - 1];
		if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
		else out.push([r[0], r[1]]);
	}
	return out;
}
