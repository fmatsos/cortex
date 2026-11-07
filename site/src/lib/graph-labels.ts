/** Pure graph logic (tested by bun test): bounded node size and collision-free label selection. */

/** Radius of a node in screen pixels: proportional to the zoom, but bounded to stay readable, whatever the zoom. */
export const screenRadius = (degree: number, k: number) =>
	Math.min(14, Math.max((2.5 + Math.sqrt(degree) * 1.7) * k, 2.5 + Math.sqrt(degree) * 0.5));

/** Maximum number of labels: proportional to the visible area, and growing with the zoom (never more than 150). */
export const labelBudget = (w: number, h: number, k: number) => Math.min(150, Math.ceil(((w * h) / 14000) * Math.max(1, k)));

/**
 * Shortens `text` so that it fits in `maxWidth` pixels (UI18): cuts at the last length that fits, followed by "…".
 * `measure` gives the width of a string (canvas); binary search: few measurements even for a very long title.
 */
export function truncateToWidth(text: string, maxWidth: number, measure: (s: string) => number): string {
	if (measure(text) <= maxWidth) return text;
	let lo = 0, hi = text.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (measure(`${text.slice(0, mid).trimEnd()}…`) <= maxWidth) lo = mid; else hi = mid - 1;
	}
	return lo > 0 ? `${text.slice(0, lo).trimEnd()}…` : "…";
}

export type Rect ={ x: number; y: number; w: number; h: number; force?: boolean };

const CELL = 96;

/**
 * Keeps, among `items` sorted by decreasing priority, those whose rectangle (in screen pixels) overlaps no rectangle
 * already kept, within the limit of `max`. A `force` rectangle is always kept. `rect` returns `null` to discard an item
 * (off screen). Spatial grid: the cost stays proportional to the number of items, even for thousands of nodes.
 */
export function placeLabels<T>(items: Iterable<T>, rect: (t: T) => Rect | null, max: number, gap = 3): T[] {
	const grid = new Map<number, Rect[]>();
	const kept: T[] = [];
	const cells = (r: Rect) => {
		const out: number[] = [];
		for (let cx = Math.floor((r.x - gap) / CELL); cx <= Math.floor((r.x + r.w + gap) / CELL); cx++)
			for (let cy = Math.floor((r.y - gap) / CELL); cy <= Math.floor((r.y + r.h + gap) / CELL); cy++) out.push(cx * 100003 + cy);
		return out;
	};
	const hits = (a: Rect, b: Rect) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
	for (const t of items) {
		const r = rect(t);
		if (!r) continue;
		const cs = cells(r);
		if (!r.force && (kept.length >= max || cs.some((c) => grid.get(c)?.some((o) => hits(r, o))))) continue;
		for (const c of cs) (grid.get(c) ?? grid.set(c, []).get(c)!).push(r);
		kept.push(t);
	}
	return kept;
}
