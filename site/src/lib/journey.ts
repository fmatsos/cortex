/**
 * Pure logic of the "Voyage" view (tested by bun test): the route is a list of page ids, each one linked (in either
 * direction) to the one before it. It lives in the URL as `route=<id>,<id>…`. No dependency on the DOM or Svelte.
 */
import type { GNode, Relations } from "./graph-model";

export type RelationIndex = ReadonlyMap<string, Relations>;

/** Ids joined by commas; a comma or a percent sign inside an id is percent-encoded, so `parseRoute` can split safely. */
export const serializeRoute = (ids: readonly string[]) => ids.map((id) => id.replace(/[%,]/g, encodeURIComponent)).join(",");

export const linked = (index: RelationIndex, a: string, b: string) => { const r = index.get(a); return !!r && (r.cites.includes(b) || r.citedBy.includes(b)); };

/** The `route` parameter back to a route: an id that is unknown (or malformed), or not linked to the last kept step, is ignored. */
export function parseRoute(value: string | null, index: RelationIndex): string[] {
	const route: string[] = [];
	for (const part of (value ?? "").split(",")) {
		let id: string;
		try { id = decodeURIComponent(part.trim()); } catch { continue; }
		if (index.has(id) && (!route.length || linked(index, route.at(-1)!, id))) route.push(id);
	}
	return route;
}

/** Going back to step `i`: the route is cut right after it. */
export const truncateRoute = (route: readonly string[], i: number) => route.slice(0, i + 1);

export type Destinations = { cites: GNode[]; citedBy: GNode[] };

/** Where a page leads: the pages it cites, then the ones that cite it (a mutual link counts once, as "cites"), each by title. */
export function destinations(id: string, index: RelationIndex, nodes: ReadonlyMap<string, GNode>): Destinations {
	const r = index.get(id), cites = new Set(r?.cites), citedBy = new Set(r?.citedBy);
	const list = (ids: Iterable<string>) => [...ids].flatMap((x) => (x !== id && nodes.get(x) ? [nodes.get(x)!] : [])).sort((a, b) => a.title.localeCompare(b.title, "fr") || a.id.localeCompare(b.id));
	return { cites: list(cites), citedBy: list([...citedBy].filter((x) => !cites.has(x))) };
}
