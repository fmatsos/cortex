import { t } from "./i18n/index";

/** Graph node shapes: the type is read by shape as much as by color (never color alone). Pure, tested by bun test. */

export type Shape = "circle" | "square" | "diamond" | "triangle";
export type Pt = readonly [number, number];

const SHAPE_OF: Record<string, Shape> = { Concept: "circle", Entity: "square", Synthesis: "diamond", Source: "triangle" };
/** Shape of a page type; an unknown type falls back to the circle. */
export const shapeOf = (type: string): Shape => SHAPE_OF[type] ?? "circle";

export const SHAPE_LABEL: Record<Shape, string> = { get circle() { return t("shape.circle"); }, get square() { return t("shape.square"); }, get diamond() { return t("shape.diamond"); }, get triangle() { return t("shape.triangle"); } };

/** Radius factor: at comparable area, a square or triangle inscribed in the same radius would look smaller than a circle. */
const SCALE: Record<Shape, number> = { circle: 1, square: 0.9, diamond: 1.2, triangle: 1.25 };

/** Vertices of the polygon of a shape centered at (cx, cy) for a radius r; `null` for the circle (drawn by an arc). */
export function shapePoints(shape: Shape, cx: number, cy: number, r: number): Pt[] | null {
	const k = r * SCALE[shape];
	switch (shape) {
		case "circle": return null;
		case "square": return [[cx - k, cy - k], [cx + k, cy - k], [cx + k, cy + k], [cx - k, cy + k]];
		case "diamond": return [[cx, cy - k], [cx + k, cy], [cx, cy + k], [cx - k, cy]];
		case "triangle": return [[cx, cy - k], [cx + k * 0.95, cy + k * 0.7], [cx - k * 0.95, cy + k * 0.7]];
	}
}

/** Five-pointed star (favorite mark): 10 vertices alternating outer and inner radius. */
export function starPoints(cx: number, cy: number, r: number, inner = 0.45): Pt[] {
	const out: Pt[] = [];
	for (let i = 0; i < 10; i++) {
		const a = -Math.PI / 2 + (i * Math.PI) / 5, d = i % 2 ? r * inner : r;
		out.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d]);
	}
	return out;
}

const num = (n: number) => String(Math.round(n * 100) / 100);

/** `points` attribute of an SVG `<polygon>`; `null` for the circle (use `<circle>`). Used for the legend drawn in the filters. */
export function svgPoints(shape: Shape, size: number): string | null {
	const c = size / 2, pts = shapePoints(shape, c, c, size * 0.4);
	return pts ? pts.map(([x, y]) => `${num(x)},${num(y)}`).join(" ") : null;
}
