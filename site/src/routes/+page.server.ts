import { dataFile, site } from "#lib/server/data.js";
import { searchSeed } from "#lib/server/search-seed.js";
import { withIds } from "#lib/log-view.js";
import { briefs } from "#lib/news.js";
import type { GraphData } from "#lib/types.js";

const POOL = 30; // candidates for the featured pages and « did you know »: the browser picks among them by day
const NEWS = 3; // briefs on the home page
const CANDIDATES = 12; // recent entries a brief is built from: a merged pair takes two, NEWS briefs need at most 2 * NEWS
const HUBS = 6;
const RECENT = 6; // recent pages and people/projects of a space that holds notes

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
		// day of the prerendered picks: the newest log entry's (not the export's, which would change the page at every rebuild)
		day: log.length ? Math.floor(Date.parse(log[0]!.at) / 864e5) || 0 : 0,
		seed: searchSeed(),
		// featured pool: well-linked syntheses and concepts with a description
		featured: byDegree.filter((p) => (p.type === "Synthesis" || p.type === "Concept") && p.description).slice(0, POOL).map(card),
		// did you know: concepts and entities described in one sentence
		facts: byDegree.filter((p) => (p.type === "Concept" || p.type === "Entity") && p.description).slice(0, POOL * 2).map(({ id, title, description }) => ({ id, title, description })),
		// the latest briefs: identifiers before any grouping (same anchors as /log), then a source added and compiled the same day is one brief
		news: briefs(withIds(log).slice(0, CANDIDATES), NEWS),
		// a space that holds notes: its latest pages (by the date they were written, else verified; no date, no place) and the entities (people, projects, clients) it knows best.
		// The export does not say which raw source is a note (the source's own kind is not in the pages' data): these are pages, not "notes".
		recent: [...pages].map((p) => ({ p, at: p.generated?.at ?? p.verified?.at ?? "" })).filter((x) => x.at).sort((a, b) => b.at.localeCompare(a.at) || a.p.title.localeCompare(b.p.title, "fr")).slice(0, RECENT).map(({ p, at }) => ({ ...card(p), at })),
		people: byDegree.filter((p) => p.type === "Entity").slice(0, RECENT * 2).map(card),
		hubs: byDegree.filter((p) => p.type !== "Source").slice(0, HUBS).map(card),
	};
};
