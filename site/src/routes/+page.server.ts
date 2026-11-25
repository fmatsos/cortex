import { dataFile, site } from "#lib/server/data.js";
import { searchSeed } from "#lib/server/search-seed.js";
import { withIds } from "#lib/log-view.js";
import { briefs } from "#lib/news.js";
import type { GraphData } from "#lib/types.js";

const POOL = 30; // candidates for the featured pages and « did you know »: the browser picks among them by day
const NEWS = 3; // briefs on the home page
const CANDIDATES = 12; // recent entries a brief is built from: a merged pair takes two, NEWS briefs need at most 2 * NEWS
const HUBS = 6;

/**
 * Home page in the manner of an encyclopedia's front page, bounded whatever the size of the wiki: search first, then
 * featured pages, « did you know », the latest log briefs, the most linked pages and the tags. The daily picks are done in
 * the browser (the prerendered page stays the same from one export to the next, the picks change every day without a rebuild).
 */
export const load = () => {
	const { pages, log } = site();
	const degree = new Map((JSON.parse(dataFile("graph.json")) as GraphData).nodes.map((n) => [n.id, n.degree]));
	const deg = (id: string) => degree.get(id) ?? 0;
	const byDegree = [...pages].sort((a, b) => deg(b.id) - deg(a.id) || a.title.localeCompare(b.title, "fr"));
	const card = (p: (typeof pages)[number]) => ({ id: p.id, type: p.type, title: p.title, description: p.description, tags: p.tags.slice(0, 4), links: deg(p.id) });
	return {
		seed: searchSeed(),
		// featured pool: well-linked syntheses and concepts with a description
		featured: byDegree.filter((p) => (p.type === "Synthesis" || p.type === "Concept") && p.description).slice(0, POOL).map(card),
		// did you know: concepts and entities described in one sentence
		facts: byDegree.filter((p) => (p.type === "Concept" || p.type === "Entity") && p.description).slice(0, POOL * 2).map(({ id, title, description }) => ({ id, title, description })),
		// the latest briefs: identifiers before any grouping (same anchors as /log), then a source added and compiled the same day is one brief
		news: briefs(withIds(log).slice(0, CANDIDATES), NEWS),
		hubs: byDegree.filter((p) => p.type !== "Source").slice(0, HUBS).map(card),
	};
};
