/** Logique pure du graphe (testée par bun test) : taille bornée des nœuds et choix des libellés sans collision. */

/** Rayon d'un nœud en pixels écran : proportionnel au zoom, mais borné pour rester lisible, quel que soit le zoom. */
export const screenRadius = (degree: number, k: number) =>
	Math.min(14, Math.max((2.5 + Math.sqrt(degree) * 1.7) * k, 2.5 + Math.sqrt(degree) * 0.5));

/** Nombre maximal de libellés : proportionnel à la surface visible, et qui croît avec le zoom (jamais plus de 150). */
export const labelBudget = (w: number, h: number, k: number) => Math.min(150, Math.ceil(((w * h) / 14000) * Math.max(1, k)));

/**
 * Raccourcit `text` pour qu'il tienne en `maxWidth` pixels (UI18) : coupe à la dernière longueur qui rentre, suivie de « … ».
 * `measure` donne la largeur d'une chaîne (canvas) ; recherche dichotomique : peu de mesures même pour un titre très long.
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
 * Retient, parmi `items` triés par priorité décroissante, ceux dont le rectangle (en pixels écran) ne chevauche aucun rectangle
 * déjà retenu, dans la limite de `max`. Un rectangle `force` est toujours retenu. `rect` renvoie `null` pour écarter un élément
 * (hors écran). Grille spatiale : le coût reste proportionnel au nombre d'éléments, même pour des milliers de nœuds.
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
