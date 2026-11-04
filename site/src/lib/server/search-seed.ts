import { TYPES } from "#lib/type-meta.js";
import { site } from "./data.js";

export type Example = { q: string; hint: string };
export type Seed = {
	total: number;
	nbTags: number;
	types: { type: string; plural: string; count: number }[];
	tags: { tag: string; count: number }[]; // most frequent
	examples: Example[];
};

/**
 * Search seeds computed at export: example queries that really give results on THIS wiki, frequent tags
 * and counts per type. They serve the home page and the empty search page (no query when the page opens).
 */
export function searchSeed(): Seed {
	const { pages, tags } = site();
	const top = [...tags].sort((a, b) => b.ids.length - a.ids.length || a.tag.localeCompare(b.tag, "fr")).slice(0, 12).map((t) => ({ tag: t.tag, count: t.ids.length }));
	const n = (f: (p: (typeof pages)[number]) => boolean) => pages.filter(f).length;
	const examples: Example[] = [];
	if (top[0]) examples.push({ q: `#${top[0].tag}`, hint: "les pages d'un tag" });
	if (n((p) => p.type === "Synthesis")) examples.push({ q: "type:synthesis", hint: "uniquement les synthèses" });
	if (n((p) => p.status === "draft")) examples.push({ q: "status:draft", hint: "les brouillons" });
	if (n((p) => !p.verified)) examples.push({ q: "is:unverified", hint: "pages jamais relues" });
	if (n((p) => p.partial)) examples.push({ q: "is:partial", hint: "sources à contenu partiel" });
	return {
		total: pages.length,
		nbTags: tags.length,
		types: TYPES.map((t) => ({ type: t.type, plural: t.plural, count: n((p) => p.type === t.type) })),
		tags: top,
		examples,
	};
}
