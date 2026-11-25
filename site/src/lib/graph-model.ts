/**
 * Pure graph logic (tested by bun test): filtered view, directed relations, selection, node search,
 * `?focus=` parameter and neighbourhood framing. No dependency on the DOM or Svelte.
 */
import { fold } from "./fold";
import type { GraphData } from "./types";

export type GNode = GraphData["nodes"][number];
export type GLink = GraphData["links"][number];

export type GraphFilters = { off: ReadonlySet<string>; tag: string };

/** Filtered view of the graph: visible pages (with their degree in this view) and links whose two ends are visible. */
export type GraphView = { nodes: GNode[]; links: GLink[]; ids: Set<string> };

/**
 * Applies the filters (hidden types, tag). The `degree` of each node is recomputed in the view: a node's size
 * never suggests relations that are no longer displayed (UX46). Linked pages are counted once, even for a reciprocal link.
 */
export function buildView(data: Pick<GraphData, "nodes" | "links">, { off, tag }: GraphFilters): GraphView {
	const kept = data.nodes.filter((n) => !off.has(n.type) && (!tag || n.tags.includes(tag)));
	const ids = new Set(kept.map((n) => n.id));
	const links = data.links.filter((l) => l.source !== l.target && ids.has(l.source) && ids.has(l.target));
	const peers = new Map<string, Set<string>>();
	const add = (a: string, b: string) => (peers.get(a) ?? peers.set(a, new Set()).get(a)!).add(b);
	for (const l of links) { add(l.source, l.target); add(l.target, l.source); }
	return { nodes: kept.map((n) => ({ ...n, degree: peers.get(n.id)?.size ?? 0 })), links, ids };
}

/** The selection survives a filter change as long as its node stays visible; otherwise it is cleared. */
export const reconcileSelection = (selId: string | null | undefined, ids: ReadonlySet<string>): string | null => (selId && ids.has(selId) ? selId : null);

export const idOf = (x: string | { id: string }) => (typeof x === "string" ? x : x.id);

export type Relations = { cites: string[]; citedBy: string[] };

/**
 * Directed relations of a page: `cites` = pages it links to, `citedBy` = pages that link to it.
 * A reciprocal link (`mutual`) appears in both lists. The ends can be ids or node objects.
 */
export function relationsOf(id: string, links: Iterable<{ source: string | { id: string }; target: string | { id: string }; mutual?: boolean }>): Relations {
	const cites = new Set<string>(), citedBy = new Set<string>();
	for (const l of links) {
		const a = idOf(l.source), b = idOf(l.target);
		if (a === id && b !== id) { cites.add(b); if (l.mutual) citedBy.add(b); }
		else if (b === id && a !== id) { citedBy.add(a); if (l.mutual) cites.add(a); }
	}
	return { cites: [...cites], citedBy: [...citedBy] };
}

/** Relations of all the pages of the view, in one pass (accessible list). */
export function relationIndex(view: Pick<GraphView, "nodes" | "links">): Map<string, Relations> {
	const m = new Map<string, Relations>(view.nodes.map((n) => [n.id, { cites: [], citedBy: [] }]));
	for (const l of view.links) {
		m.get(l.source)?.cites.push(l.target);
		m.get(l.target)?.citedBy.push(l.source);
		if (l.mutual) { m.get(l.source)?.citedBy.push(l.target); m.get(l.target)?.cites.push(l.source); }
	}
	return m;
}

/** Normalizes `?focus=`: decoded, without leading or trailing slash, without `.md` extension. Returns the id of a known node or `null`. */
export function resolveFocus(search: string, nodes: readonly Pick<GNode, "id">[]): { id: string | null; asked: string | null } {
	const raw = new URLSearchParams(search).get("focus");
	if (raw === null) return { id: null, asked: null };
	const asked = raw.trim().replace(/^\/?(wiki\/)?/, "").replace(/\/+$/, "").replace(/\.md$/, "");
	return { id: asked && nodes.some((n) => n.id === asked) ? asked : null, asked: asked || null };
}

/**
 * Search for a page by its title (case- and accent-insensitive). Order: title that starts with the query,
 * then a word of the title, then substring, then all words present; on a tie, the most linked first then alphabetical order.
 */
export function searchNodes<T extends Pick<GNode, "title" | "degree">>(nodes: readonly T[], query: string, limit = 8): T[] {
	const q = fold(query).trim();
	if (!q) return [];
	const words = q.split(/\s+/);
	const scored: { n: T; s: number; t: string }[] = [];
	for (const n of nodes) {
		const t = fold(n.title);
		let s = -1;
		if (t.startsWith(q)) s = 0;
		else if (t.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q))) s = 1;
		else if (t.includes(q)) s = 2;
		else if (words.length > 1 && words.every((w) => t.includes(w))) s = 3;
		if (s >= 0) scored.push({ n, s, t });
	}
	scored.sort((a, b) => a.s - b.s || b.n.degree - a.n.degree || a.t.localeCompare(b.t));
	return scored.slice(0, limit).map((x) => x.n);
}

/** Closest neighbours bound the camera frame of a hub; no relations are removed from the view. */
export function focusNodes(id: string, view: GraphView, limit = 30): GNode[] {
	const center = view.nodes.find((n) => n.id === id);
	if (!center) return [];
	const r = relationsOf(id, view.links), peers = new Set([...r.cites, ...r.citedBy]);
	return [center, ...view.nodes.filter((n) => peers.has(n.id)).sort((a, b) =>
		Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y) || a.id.localeCompare(b.id)
	).slice(0, limit)];
}

/** During gestures keep the focus, a landmark per community, then hubs. The visible scope stays intact. */
export function gestureNodes(view: GraphView, focus: ReadonlySet<string>, limit = 120): Set<string> {
	const kept = new Set([...focus].filter((id) => view.ids.has(id)).slice(0, limit));
	const ranked = [...view.nodes].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
	const communities = new Set<string>();
	for (const n of ranked) if (!communities.has(n.community)) {
		communities.add(n.community); if (kept.size < limit) kept.add(n.id);
	}
	for (const n of ranked) { if (kept.size >= limit) break; kept.add(n.id); }
	return kept;
}
