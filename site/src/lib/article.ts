import type { IconName } from "#lib/icons.js";
import { fold } from "./fold";
import type { Parsed } from "./query";
import type { Link, PageData, SourceRef, TocItem } from "./types";
import { TYPES } from "./type-meta";

/**
 * Pure logic of the article page (tested by src/article.test.ts): table of contents, current section, related pages,
 * original source, links to the graph and to the collections, terms to highlight when reading.
 * No dependency on SvelteKit: components only have to display.
 */

// --- Table of contents ------------------------------------------------------------------------------------------

/** Anchors of the sections that the component adds after the body (see +page.svelte). */
export const NOTES_ID = "h-notes";
export const SOURCES_ID = "h-sources";

/** The body headings, followed by Notes and Sources when they exist (UX20): a single list, a single section tracking. */
export function tocItems(toc: TocItem[], notes: number, sources: number): TocItem[] {
	return [
		...toc,
		...(notes ? [{ level: 2 as const, id: NOTES_ID, text: `Notes (${notes})` }] : []),
		...(sources ? [{ level: 2 as const, id: SOURCES_ID, text: `Sources (${sources})` }] : []),
	];
}

/** Length (in characters of HTML) from which a two-section page already deserves a table of contents. */
export const LONG_PAGE = 2500;

/**
 * The table of contents is shown from two sections (Notes and Sources included) if the page is long, from three otherwise (UX21):
 * the number of body headings is not a good threshold, a heavily cited page stays navigable.
 */
export const showToc = (items: TocItem[], htmlLength: number) => items.length >= 3 || (items.length === 2 && htmlLength >= LONG_PAGE);

/**
 * Current section: the last heading that passed below the `limit` line (distance from the top of the window). At the very bottom
 * of the page, it is the last section (a short final section would never reach the line).
 */
export function currentSection(tops: { id: string; top: number }[], limit: number, atEnd = false): string {
	if (!tops.length) return "";
	if (atEnd) return tops[tops.length - 1].id;
	return tops.findLast((t) => t.top <= limit)?.id ?? "";
}

// --- Related pages ----------------------------------------------------------------------------------------------

export type RelatedIn = Link & { reasons: string[] };
/** A related-page reason: icon, short label, and detail (source titles) read on hover and by screen readers. */
export type Reason = { icon: IconName; label: string; detail?: string };
export type RelatedEntry = Link & { why: Reason[] };

/**
 * The reasons of a related page as the export writes them ("lien sortant", "source partagée" repeated once per
 * source, "tag partagé : x"…), reduced to short, deduplicated reasons. `shared`: titles of the shared sources.
 */
export function relatedReasons(reasons: string[], shared: string[] = []): Reason[] {
	const has = (r: string) => reasons.includes(r);
	const tags = [...new Set(reasons.filter((r) => r.startsWith("tag partagé")).map((r) => r.replace(/^tag partagé\s*:\s*/, "")).filter(Boolean))];
	const n = shared.length;
	return [
		...(has("lien sortant") ? [{ icon: "copy-link" as const, label: "citée ici" }] : []),
		...(has("lien entrant") ? [{ icon: "backlink" as const, label: "cite cette page" }] : []),
		...(has("source partagée") || n
			? [{ icon: "source" as const, label: n > 1 ? `${n} sources communes` : "source commune", ...(n ? { detail: shared.join(" · ") } : {}) }]
			: []),
		...(tags.length ? [{ icon: "tags" as const, label: tags.join(", ") }] : []),
	];
}

/** Auteur lisible : `human:franck` → `franck`, `claude-code/opus-5.5` → `claude-code · opus-5.5`. */
export const actor = (by: string) => by.replace(/^human:/, "").replace("/", " · ");

/**
 * Pages to explore: the related pages that are not already backlinks (UX22: a destination appears only once),
 * each with its deduplicated reasons (UX23).
 */
export function relatedEntries(backlinks: Link[], related: RelatedIn[], shared: Record<string, string[]> = {}): RelatedEntry[] {
	const back = new Set(backlinks.map((b) => b.id));
	return related.filter((r) => !back.has(r.id)).map(({ reasons, ...link }) => ({ ...link, why: relatedReasons(reasons, shared[link.id]) }));
}

/** Titles of the sources that each related page shares with the current page (server side: the site knows all the pages). */
export function sharedSources(page: Pick<PageData, "sources" | "related">, pages: Pick<PageData, "id" | "sources">[]): Record<string, string[]> {
	const mine = new Set(page.sources.map((s) => s.id)), out: Record<string, string[]> = {};
	const wanted = new Set(page.related.map((r) => r.id)), byId = new Map(pages.filter((p) => wanted.has(p.id)).map((p) => [p.id, p]));
	for (const r of page.related) {
		const titles = byId.get(r.id)?.sources.filter((s) => mine.has(s.id)).map((s) => s.title) ?? [];
		if (titles.length) out[r.id] = [...new Set(titles)];
	}
	return out;
}

// --- Links ------------------------------------------------------------------------------------------------------

/** Displayed domain of an external link (without `www.`), or `""` if the URL is unreadable. */
export function domainOf(url: string): string {
	try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

/** The original source of a page: the first source that carries a URL (UX18). */
export function originalSource(sources: SourceRef[]): (SourceRef & { url: string; domain: string }) | undefined {
	const s = sources.find((x) => x.url);
	return s && { ...s, url: s.url!, domain: domainOf(s.url!) };
}

/** Graph query: `?focus=<id>`, the id being the node's (`concepts/context-rot`, slashes kept to stay readable). */
export const graphFocus = (id: string) => `?focus=${encodeURIComponent(id).replace(/%2F/gi, "/")}`;

/** Query for the collection of a page type (`type:concept`), or `undefined` for an unknown type. */
export const collectionQuery = (type: string) => (TYPES.some((t) => t.type === type) ? `?q=${encodeURIComponent(`type:${type.toLowerCase()}`)}` : undefined);
export const collectionLabel = (type: string) => TYPES.find((t) => t.type === type)?.plural ?? type;

/** Link to copy: the page address without the search context (`?q=`) which is not part of the page. */
export function shareUrl(href: string): string {
	try { const u = new URL(href); u.searchParams.delete("q"); return u.toString(); } catch { return href; }
}

// --- Reading a search result (UX26) ------------------------------------------------------------------------------

export type HitTerms = { words: string[]; phrases: string[] };

/** Query terms that are searched in the text: free words and exact phrases (filters and exclusions are not). */
export const hitTerms = (p: Parsed): HitTerms => ({ words: [...new Set(p.words)], phrases: p.phrases.map((x) => x.text) });
export const hasTerms = (t: HitTerms) => t.words.length > 0 || t.phrases.length > 0;

/**
 * Ranges [start, end[ of a text that match the terms: a word of the text that starts with a typed word (the typing in
 * progress counts, as in the search; a single letter must be the whole word), or an exact phrase. Insensitive to
 * accents and case. Overlapping ranges are merged. A text whose folding changes length is ignored
 * (the highlighting would not just be shifted, it would be wrong).
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
