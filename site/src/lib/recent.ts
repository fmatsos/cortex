import { fold } from "./fold";

/** Historique local des recherches validées (Entrée, résultat ouvert) : fonctions pures, le stockage est dans search-state.svelte.ts. */
export const MAX_RECENT = 8;

/** Ajoute `q` en tête (espaces normalisés), sans doublon (insensible aux accents et à la casse), borné à `max` ; une saisie vide ne change rien. */
export function pushRecent(list: string[], q: string, max = MAX_RECENT): string[] {
	const t = q.trim().replace(/\s+/g, " ");
	if (!t) return list;
	return [t, ...list.filter((x) => fold(x) !== fold(t))].slice(0, max);
}

/** Relit l'historique stocké : tout ce qui n'est pas une liste de textes non vides est ignoré. */
export function parseRecent(json: string | null, max = MAX_RECENT): string[] {
	try {
		const v: unknown = JSON.parse(json ?? "[]");
		return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, max) : [];
	} catch {
		return [];
	}
}
