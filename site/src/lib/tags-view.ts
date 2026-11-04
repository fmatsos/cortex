import { fold } from "./fold";

/** Page /tags/ : filtre texte et tri, synchronisés dans l'URL (`q`, `tri=alpha`). Fonctions pures (testées par `cli/src/log-view.test.ts`). */
export type Tag = { tag: string; slug: string; count: number };
export type TagSort = "freq" | "alpha";
export const TAG_SORTS = [
	{ sort: "freq", label: "Fréquence", sentence: "par fréquence" },
	{ sort: "alpha", label: "Alphabétique", sentence: "par ordre alphabétique" },
] as const satisfies readonly { sort: TagSort; label: string; sentence: string }[];

const byName = (a: Tag, b: Tag) => a.tag.localeCompare(b.tag, "fr", { sensitivity: "base" });

/** Fréquence décroissante puis nom, ou nom seul. Ne modifie pas la liste reçue. */
export const sortTags = (tags: Tag[], sort: TagSort): Tag[] => [...tags].sort(sort === "alpha" ? byName : (a, b) => b.count - a.count || byName(a, b));

/** Filtre insensible à la casse et aux accents ; le `#` initial est ignoré. Sans saisie, tous les tags. */
export const filterTags = (tags: Tag[], q: string): Tag[] => {
	const needle = fold(q.trim().replace(/^#/, ""));
	return needle ? tags.filter((t) => fold(t.tag).includes(needle)) : tags;
};

export function readTagsParams(sp: URLSearchParams): { q: string; sort: TagSort } {
	return { q: (sp.get("q") ?? "").trim(), sort: sp.get("tri") === "alpha" ? "alpha" : "freq" };
}

/** Chaîne de requête canonique (`""` pour le défaut : pas de filtre, tri par fréquence). */
export function tagsQuery(q: string, sort: TagSort): string {
	const sp = new URLSearchParams();
	if (q.trim()) sp.set("q", q.trim());
	if (sort === "alpha") sp.set("tri", "alpha");
	const s = sp.toString();
	return s && `?${s}`;
}
