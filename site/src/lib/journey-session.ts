import { preloadData } from "$app/navigation";
import { resolve } from "$app/paths";
import { account } from "./account.svelte";
import { ApiError } from "./api";
import { download, siteUrl } from "./export-file";
import { relationIndex } from "./graph-model";
import { t } from "./i18n/index";
import { journeyFilename, journeyMarkdown, pathDraftMarkdown, type JourneyPage } from "./journey-markdown";
import { serializeRoute } from "./journey";
import { createJourney, getJourney, updateJourney, type Journey } from "./journeys";
import { toPage } from "./links";
import { typeLabel } from "./type-meta";
import type { GraphData, PageData } from "./types";

// A journey of the graph and the account: save it, export it as Markdown. The state on screen is the graph page's
// (components/journey/journey-flow.svelte.ts); this module talks to the API, to the pages' data and to the browser's download.

/** A saved copy as the graph page tracks it: `key` is its route as the URL writes it, to tell at once whether the route on screen is the saved one. */
export type SavedLink = { id: string; title: string; key: string; created_at: string };
export const toLink = (j: Journey): SavedLink => ({ id: j.id, title: j.title, key: serializeRoute(j.route), created_at: j.created_at });

export type SaveResult = "created" | "updated" | "same";

/**
 * Saves `route`: creates the copy the first time (`title` is the owner's), updates its route afterwards (its title is kept),
 * and does nothing when the copy already holds that route. Throws on failure.
 */
export async function saveJourney(route: readonly string[], link: SavedLink | null, title?: string): Promise<{ result: SaveResult; link: SavedLink }> {
	if (link && link.key === serializeRoute(route)) return { result: "same", link };
	try {
		if (link) return { result: "updated", link: toLink(await updateJourney(link.id, route)) };
		return { result: "created", link: toLink(await createJourney(title?.trim() || undefined, route)) };
	} catch (e) {
		if (e instanceof ApiError && e.status === 401) account.expire();
		// the copy was deleted elsewhere (the account page of another tab): the journey is saved again, under its name
		if (!(e instanceof ApiError && e.status === 404 && link)) throw e;
		return { result: "created", link: toLink(await createJourney(link.title || undefined, route)) };
	}
}

// ---- export -----------------------------------------------------------------------------------------------------------

export const fetchGraph = async (): Promise<GraphData> => {
	const res = await fetch(resolve("/graph.json"));
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return (await res.json()) as GraphData;
};

/**
 * The pages of a route with their whole content. The site already ships it: every page is prerendered with its data
 * (`wiki/<id>/__data.json`: title, type, summary and the Markdown), and SvelteKit's `preloadData` reads it. One page at a
 * time, because the router keeps a single preload at a time. A page the wiki does not have is left out (the export says so);
 * one whose data could not be read stays without its content (`partial`): the export is written anyway.
 */
async function loadPages(ids: readonly string[], graph: GraphData): Promise<{ pages: Map<string, JourneyPage>; partial: boolean }> {
	const nodes = new Map(graph.nodes.map((n) => [n.id, n])), pages = new Map<string, JourneyPage>();
	let partial = false;
	for (const id of new Set(ids)) {
		const node = nodes.get(id);
		const known: JourneyPage | undefined = node && { id, title: node.title, type: node.type, description: node.description };
		let result: Awaited<ReturnType<typeof preloadData>> | undefined;
		try { result = await preloadData(toPage(id)); } catch { /* the network: the page keeps no content */ }
		const page = result?.type === "loaded" ? (result.data as { page?: PageData }).page : undefined;
		if (page && page.id === id && typeof page.md === "string") pages.set(id, { id, title: page.title, type: page.type, description: page.description, md: page.md });
		else if (result?.type === "error" && result.status === 404 && !known) continue; // not in the wiki (any more)
		else if (known) { pages.set(id, known); partial = true; }
		else partial = true;
	}
	return { pages, partial };
}

/**
 * Writes the journey `route` as Markdown and downloads it. `graph`: the graph the page already holds, to spare a request.
 * `format: "path"`: a draft of a reading path (what goes in `<wiki>/paths/`) instead of the whole journey. Throws when the graph cannot be read.
 */
export async function exportRoute(o: { route: readonly string[]; title: string; created?: string; graph?: GraphData; format?: "journey" | "path" }): Promise<{ partial: boolean }> {
	const graph = o.graph ?? await fetchGraph();
	const { pages, partial } = await loadPages(o.route, graph);
	// the links of the whole graph, not of the filters on screen: the export says how each step is linked to the one before it
	const relations = relationIndex(graph);
	const draft = o.format === "path";
	const text = draft ? pathDraftMarkdown({ title: o.title, route: o.route, pages, relations, t }) : journeyMarkdown({ title: o.title, route: o.route, pages, relations, site: siteUrl(), t, typeLabel, created: o.created });
	download(journeyFilename(o.title, t(draft ? "paths.draft.fileName" : "journey.export.fileName")), text);
	return { partial };
}

/** Downloads a saved journey as Markdown (from the account page). Throws when it cannot be read. */
export async function exportSaved(id: string) {
	const j = await getJourney(id);
	return exportRoute({ route: j.route, title: j.title, created: j.created_at });
}
