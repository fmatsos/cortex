/**
 * Deterministic daily pick: the same `day` (days since the epoch) always gives the same `count` distinct items of a pool,
 * in the prerendered page and in the browser alike. A seeded partial Fisher-Yates shuffle (mulberry32), no dependency.
 */
export function pickDaily<T>(pool: readonly T[], day: number, count: number): T[] {
	const items = [...pool];
	let s = (day ^ 0x9e3779b9) >>> 0;
	const next = () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let z = s;
		z = Math.imul(z ^ (z >>> 15), z | 1);
		z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
		return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
	};
	const n = Math.min(count, items.length);
	for (let i = 0; i < n; i++) {
		const j = i + Math.floor(next() * (items.length - i));
		[items[i], items[j]] = [items[j]!, items[i]!];
	}
	return items.slice(0, n);
}
