import { fold } from "./fold";

/** /tags/ page: text filter and sort, synchronized in the URL (`q`, `tri=alpha`). Pure functions (tested by `src/log-view.test.ts`). */
export type Tag = { tag: string; slug: string; count: number };
export type TagSort = "freq" | "alpha";
export const TAG_SORTS = [
	{ sort: "freq", label: "Fréquence", sentence: "par fréquence" },
	{ sort: "alpha", label: "Alphabétique", sentence: "par ordre alphabétique" },
] as const satisfies readonly { sort: TagSort; label: string; sentence: string }[];

const byName = (a: Tag, b: Tag) => a.tag.localeCompare(b.tag, "fr", { sensitivity: "base" });

/** Decreasing frequency then name, or name only. Does not modify the received list. */
export const sortTags = (tags: Tag[], sort: TagSort): Tag[] => [...tags].sort(sort === "alpha" ? byName : (a, b) => b.count - a.count || byName(a, b));

/** Case- and accent-insensitive filter; the leading `#` is ignored. With no input, all tags. */
export const filterTags = (tags: Tag[], q: string): Tag[] => {
	const needle = fold(q.trim().replace(/^#/, ""));
	return needle ? tags.filter((t) => fold(t.tag).includes(needle)) : tags;
};

export function readTagsParams(sp: URLSearchParams): { q: string; sort: TagSort } {
	return { q: (sp.get("q") ?? "").trim(), sort: sp.get("tri") === "alpha" ? "alpha" : "freq" };
}

/** Canonical query string (`""` for the default: no filter, sorted by frequency). */
export function tagsQuery(q: string, sort: TagSort): string {
	const sp = new URLSearchParams();
	if (q.trim()) sp.set("q", q.trim());
	if (sort === "alpha") sp.set("tri", "alpha");
	const s = sp.toString();
	return s && `?${s}`;
}
