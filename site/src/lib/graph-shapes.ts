/** Formes des nœuds du graphe : le type se lit par la forme autant que par la couleur (jamais la couleur seule). Pur, testé par bun test. */

export type Shape = "circle" | "square" | "diamond" | "triangle";
export type Pt = readonly [number, number];

const SHAPE_OF: Record<string, Shape> = { Concept: "circle", Entity: "square", Synthesis: "diamond", Source: "triangle" };
/** Forme d'un type de page ; un type inconnu retombe sur le cercle. */
export const shapeOf = (type: string): Shape => SHAPE_OF[type] ?? "circle";

export const SHAPE_LABEL: Record<Shape, string> = { circle: "rond", square: "carré", diamond: "losange", triangle: "triangle" };

/** Facteur de rayon : à surface comparable, un carré ou un triangle inscrits dans le même rayon paraîtraient plus petits qu'un rond. */
const SCALE: Record<Shape, number> = { circle: 1, square: 0.9, diamond: 1.2, triangle: 1.25 };

/** Sommets du polygone d'une forme centrée en (cx, cy) pour un rayon r ; `null` pour le cercle (tracé par un arc). */
export function shapePoints(shape: Shape, cx: number, cy: number, r: number): Pt[] | null {
	const k = r * SCALE[shape];
	switch (shape) {
		case "circle": return null;
		case "square": return [[cx - k, cy - k], [cx + k, cy - k], [cx + k, cy + k], [cx - k, cy + k]];
		case "diamond": return [[cx, cy - k], [cx + k, cy], [cx, cy + k], [cx - k, cy]];
		case "triangle": return [[cx, cy - k], [cx + k * 0.95, cy + k * 0.7], [cx - k * 0.95, cy + k * 0.7]];
	}
}

/** Étoile à cinq branches (marque de favori) : 10 sommets alternant rayon externe et interne. */
export function starPoints(cx: number, cy: number, r: number, inner = 0.45): Pt[] {
	const out: Pt[] = [];
	for (let i = 0; i < 10; i++) {
		const a = -Math.PI / 2 + (i * Math.PI) / 5, d = i % 2 ? r * inner : r;
		out.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d]);
	}
	return out;
}

const num = (n: number) => String(Math.round(n * 100) / 100);

/** Attribut `points` d'un `<polygon>` SVG ; `null` pour le cercle (utiliser `<circle>`). Sert à la légende dessinée dans les filtres. */
export function svgPoints(shape: Shape, size: number): string | null {
	const c = size / 2, pts = shapePoints(shape, c, c, size * 0.4);
	return pts ? pts.map(([x, y]) => `${num(x)},${num(y)}`).join(" ") : null;
}
