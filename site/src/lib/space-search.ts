import { api } from "./api";

/**
 * The search across spaces (`GET /api/search?q=…&spaces=a,b|all`, at the root of a multi-space `cortex serve`): the site's own search run
 * in each space the visitor may see and fused by the server. A hit carries its space; a space they may not see is simply not there.
 */
/** Where the search page looks: the space of the page, all the visitor's spaces, or the ones they picked. */
export type Scope = "current" | "all" | "set";
export type SpaceHit = { space: string; id: string; title: string; type: string; extract: string };
export type Across = { hits: SpaceHit[]; spaces: string[] };

const text = (v: unknown) => (typeof v === "string" ? v : "");
export async function searchAcross(q: string, spaces: string[] | "all", signal?: AbortSignal): Promise<Across> {
	const scope = spaces === "all" ? "all" : spaces.map(encodeURIComponent).join(",");
	const r = await api<{ hits?: unknown; spaces?: unknown }>(`/api/search?q=${encodeURIComponent(q)}&spaces=${scope}&limit=50`, { signal });
	const hits = (Array.isArray(r.hits) ? r.hits : []).flatMap((h): SpaceHit[] => {
		const o = h as Record<string, unknown>;
		return o && text(o.space) && text(o.id) ? [{ space: text(o.space), id: text(o.id), title: text(o.title) || text(o.id), type: text(o.type), extract: text(o.extract) }] : [];
	});
	return { hits, spaces: Array.isArray(r.spaces) ? r.spaces.filter((s): s is string => typeof s === "string") : [] };
}

/** The hits by space, in the order of `spaces` (the server's own order inside each group). */
export const bySpace = (hits: SpaceHit[], spaces: string[]): { space: string; hits: SpaceHit[] }[] =>
	spaces.map((space) => ({ space, hits: hits.filter((h) => h.space === space) })).filter((g) => g.hits.length);

/** Link to a page of another space: its own site, outside the base of this one (a full page load). */
export const hitHref = (h: SpaceHit) => `/s/${h.space}/wiki/${h.id}/`;
