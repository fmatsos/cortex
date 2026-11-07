import { fold } from "./fold";

/** Local history of validated searches (Enter, opened result): pure functions, storage is in search-state.svelte.ts. */
export const MAX_RECENT = 8;

/** Adds `q` at the head (spaces normalized), without duplicate (accent- and case-insensitive), bounded to `max`; an empty input changes nothing. */
export function pushRecent(list: string[], q: string, max = MAX_RECENT): string[] {
	const t = q.trim().replace(/\s+/g, " ");
	if (!t) return list;
	return [t, ...list.filter((x) => fold(x) !== fold(t))].slice(0, max);
}

/** Reads the stored history back: anything that is not a list of non-empty strings is ignored. */
export function parseRecent(json: string | null, max = MAX_RECENT): string[] {
	try {
		const v: unknown = JSON.parse(json ?? "[]");
		return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, max) : [];
	} catch {
		return [];
	}
}
