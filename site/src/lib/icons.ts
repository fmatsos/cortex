/**
 * The site's icon pack: a single set, drawn for this project (no dependency), in the square language.
 *
 * `viewBox="0 0 24 24"` grid, stroke 1.75, butt ends, mitered joins (`stroke-miterlimit="2"`: a join sharper than
 * about 60 degrees is bevelled instead of spiking), optical margin 2. `stroke="currentColor"`, `fill="none"`; only the
 * active star is filled (`filled` prop). Each value is the inner content of the SVG: only `path`, `circle`, `rect`
 * and `g`. Corners are right angles: no `rx`, no arc used only to round a corner. Curves survive only where they
 * define the symbol (lens, moon, globe, sun, clock, refresh arcs, bulb, wifi). A dot is a real 2x2 filled square
 * (`DOT`, `fill="currentColor" stroke="none"`), never a zero-length segment. A status container is a square frame.
 * The sprite of all the bodies is `icon-sprite.svelte` (one `<symbol>` per name, mounted once by the layout); `icon.svelte`
 * draws an instance (`<use>`); `iconSvg()` renders a standalone SVG string (tests).
 */

const STAR = `<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>`;
const CLOSE = `<path d="m7 7 10 10M17 7 7 17"/>`;
/** Square frame: the container of the status and outcome icons (the circle was only a container). */
const FRAME = `<rect x="3" y="3" width="18" height="18"/>`;
/** Shield with straight edges: verified / unverified / needs-review. */
const SHIELD = `<path d="M12 3 4.5 6v6.5L12 21l7.5-8.5V6z"/>`;
const LOUPE = `<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5.5 5.5"/>`;
const TRAY = `<path d="M4 14v6h16v-6M12 4v10M8 10.5l4 4 4-4"/>`;
/** A dot: a real 2x2 filled square centred on (x, y); a zero-length segment vanishes with butt ends. */
const DOT = (x: number, y: number) => `<rect x="${x - 1}" y="${y - 1}" width="2" height="2" fill="currentColor" stroke="none"/>`;

export const ICONS = {
	// navigation
	home: `<path d="M3 11 12 3.5 21 11"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/>`,
	search: LOUPE,
	graph: `<circle cx="12" cy="6.5" r="2.5"/><circle cx="6" cy="17.5" r="2.5"/><circle cx="18" cy="17.5" r="2.5"/><path d="m10.8 8.7-3.6 6.6M13.2 8.7l3.6 6.6"/>`,
	tags: `<path d="M3.5 3.5h8.2l8.8 8.8-8.2 8.2-8.8-8.8z"/>${DOT(7.5, 7.5)}`,
	journal: `<rect x="5" y="3" width="14" height="18"/><path d="M9 3v18M12.5 8h3.5M12.5 12h3.5M12.5 16h3.5"/>`,
	favorites: STAR,

	// page types
	concept: `<path d="M12 3a6 6 0 0 0-3.5 10.9L9.5 16h5l1-2.1A6 6 0 0 0 12 3z"/><path d="M9.5 18.5h5M10.5 21h3"/>`,
	entity: `<path d="M12 3 20 7.5v9L12 21 4 16.5v-9z"/><path d="m12 12-7.7-4.3M12 12l7.7-4.3M12 12v9"/>`,
	synthesis: `<circle cx="6" cy="5.5" r="2"/><circle cx="18" cy="5.5" r="2"/><path d="M6 7.5V11h12V7.5M12 11v5"/><rect x="8.75" y="16" width="6.5" height="4.5"/>`,
	source: `<path d="M14 3H5v18h14V8z"/><path d="M14 3v5h5M9 13h6M9 16.5h6"/>`,

	// status and trust
	draft: `<rect x="3" y="3" width="18" height="18" stroke-dasharray="6 3" stroke-dashoffset="3"/>`,
	stable: `${FRAME}<path d="m8 12.3 2.8 2.8 5.4-5.7"/>`,
	deprecated: `${FRAME}<path d="m7 7 10 10"/>`,
	verified: `${SHIELD}<path d="m9 12 2.2 2.2 3.8-4"/>`,
	unverified: `${SHIELD}<path d="M9.8 9.9a2.3 2.3 0 0 1 4.4.8c0 1.5-2.2 1.8-2.2 3.1"/>${DOT(12, 16.6)}`,
	"needs-review": `${SHIELD}<path d="M12 8v4.5"/>${DOT(12, 16)}`,
	stale: `<circle cx="10.5" cy="13.5" r="7.5"/><path d="M10.5 9.5v4l2.7 1.7M20 3.5v4"/>${DOT(20, 10.5)}`,

	// actions
	star: STAR,
	"copy-link": `<g transform="rotate(-45 12 12)"><path d="M10.5 8H5v8h5.5M13.5 8H19v8h-5.5M9 12h6"/></g>`,
	"copy-markdown": `<rect x="4" y="6" width="13" height="15"/><path d="M9 3h11v13M9.5 11.25 7.5 13.5l2 2.25M12.5 11.25l2 2.25-2 2.25"/>`,
	success: `<path d="m5 12.5 4.8 4.8L19 7.5"/>`,
	error: `${FRAME}<path d="M12 7v6.5"/>${DOT(12, 16.5)}`,

	// theme
	sun: `<circle cx="12" cy="12" r="3.8"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M16.95 7.05l1.77-1.77M16.95 16.95l1.77 1.77M7.05 16.95l-1.77 1.77M7.05 7.05 5.28 5.28"/>`,
	moon: `<path d="M20.5 13.5A8.75 8.75 0 1 1 10.5 3.5 7 7 0 0 0 20.5 13.5z"/>`,
	system: `<rect x="3" y="4" width="18" height="12.5"/><path d="M12 16.5V20M8.5 20h7"/>`,

	// search
	filter: `<path d="M4 5.5h16L14 12.8V19l-4-2v-4.2z"/>`,
	"operator-tag": `<path d="M10 3.5 8.5 20.5M16.5 3.5 15 20.5M4.5 9h15.5M4 15h15.5"/>`,
	"operator-type": `<circle cx="7.5" cy="7.5" r="3.75"/><rect x="13" y="3.75" width="7.5" height="7.5"/><path d="M12 14 16.25 20.5h-8.5z"/>`,
	"operator-status": `<rect x="3" y="3" width="4" height="4"/><rect x="3" y="10" width="4" height="4"/><rect x="3" y="17" width="4" height="4"/><path d="M10.5 5H21M10.5 12H21M10.5 19H21"/>`,
	"operator-phrase": `<path d="M4 6.5h6V13H4z"/><path d="M10 13 6 18"/><path d="M14 6.5h6V13h-6z"/><path d="M20 13l-4 5"/>`,
	"operator-exclude": `${FRAME}<path d="M7.5 12h9"/>`,
	recent: `<path d="M3.8 12a8.2 8.2 0 1 0 2.4-5.8L3.5 8.5M3.5 3.8v4.7h4.7M12 7.5V12l3 1.8"/>`,
	clear: CLOSE,

	// reading
	toc: `<path d="M4 6h16M9 12h8M9 18h11"/>`,
	"chevron-down": `<path d="m6 9 6 6 6-6"/>`,
	back: `<path d="M20 12H4M10 6l-6 6 6 6"/>`,
	backlink: `<path d="M4.5 4.5V12H10M7.5 9.5 10 12l-2.5 2.5"/><rect x="12.5" y="3.5" width="8" height="17"/><path d="M15.5 9h2M15.5 12.5h2"/>`,
	related: `<rect x="3" y="3" width="8" height="10"/><rect x="13" y="11" width="8" height="10"/><path d="M11 8h6v3"/>`,
	"external-link": `<path d="M14 4h6v6M20 4l-9 9M18 13.5V20H4V6h6.5"/>`,
	note: `<path d="M5 3h14v11l-5 5H5z"/><path d="M14 19v-5h5"/>`,
	warning: `<path d="M12 4 3 20h18z"/><path d="M12 9.5v4"/>${DOT(12, 17)}`,
	citation: `<rect x="3.5" y="5" width="17" height="14"/><path d="M7 9h3.5v3.5H7zM10.5 12.5 9 15.5M13.5 9H17v3.5h-3.5zM17 12.5l-1.5 3"/>`,
	"citation-return": `<path d="M20 5v10H5M9 11l-4 4 4 4"/>`,

	// log entry types
	"kind-add": `${FRAME}<path d="M12 8v8M8 12h8"/>`,
	"kind-ingest": TRAY,
	generated: `<path d="M11 3.5l1.9 4.6 4.6 1.9-4.6 1.9L11 16.5l-1.9-4.6L4.5 10l4.6-1.9z"/><path d="M18 14.5v5M15.5 17h5"/>`,
	download: TRAY,
	"kind-query": `<path d="M3.5 4.5H20.5M3.5 8.5H11"/><circle cx="13" cy="15" r="4.5"/><path d="m16.3 18.3 3.2 3.2"/>`,
	"kind-lint": `<path d="m3.5 6.2 1.6 1.6 3-3.2M3.5 12.2l1.6 1.6 3-3.2M3.5 18.2l1.6 1.6 3-3.2M12 6h9M12 12h9M12 18h9"/>`,
	"kind-update": `<path d="M4.12 10.61A8 8 0 0 1 19.88 10.61M19.9 5.5v5.1h-5.1M19.88 13.39A8 8 0 0 1 4.12 13.39M4.1 18.5v-5.1h5.1"/>`,

	// graph
	"zoom-in": `${LOUPE}<path d="M10.5 7.75v5.5M7.75 10.5h5.5"/>`,
	"zoom-out": `${LOUPE}<path d="M7.75 10.5h5.5"/>`,
	"fit-view": `<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>${DOT(12, 12)}`,
	pause: `<path d="M8.5 5v14M15.5 5v14"/>`,
	play: `<path d="M7 5v14l12.5-7z"/>`,
	"close-selection": CLOSE,
	"list-view": `${DOT(4, 6)}${DOT(4, 12)}${DOT(4, 18)}<path d="M9 6h11M9 12h11M9 18h11"/>`,

	// network
	offline: `<path d="M3 9.2a13.5 13.5 0 0 1 18 0M6.2 12.8a8.8 8.8 0 0 1 11.6 0M9.4 16.2a4.2 4.2 0 0 1 5.2 0M4 4l16 16"/>${DOT(12, 19.7)}`,
	"offline-ready": `<path d="m8.5 7.8 2.6 2.6 4.5-5"/><rect x="3.5" y="13.5" width="17" height="7"/>${DOT(7.5, 17)}`,
	retry: `<path d="M20 12a8 8 0 1 1-2.3-5.6L20 8.6M20 3.5v5.1h-5.1"/>`,
	language: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.75 5.6 3.75 9S14.5 18.4 12 21c-2.5-2.6-3.75-5.6-3.75-9S9.5 5.6 12 3z"/>`,
	"new-tab": `<path d="M7 6.5V3.5h7"/><rect x="3.5" y="9" width="11.5" height="11.5"/><path d="m12 12.5 8.5-8.5M15.5 3.5h5v5"/>`,
} as const;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export const STROKE_WIDTH = 1.75;
/** Optical variant: below 18 px, the stroke thickens a little to keep the same visual weight. */
export const strokeFor = (size: number) => (size < 18 ? 2 : STROKE_WIDTH);

export type IconSvgOptions = { size?: number; filled?: boolean; label?: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The complete SVG of an icon, as a string (same attributes as `icon.svelte`). */
export function iconSvg(name: IconName, { size = 20, filled = false, label }: IconSvgOptions = {}): string {
	const a11y = label ? `role="img" aria-label="${esc(label)}"` : `aria-hidden="true"`;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="${strokeFor(size)}" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="2" focusable="false" ${a11y}>${ICONS[name]}</svg>`;
}

/** Id of an icon's `<symbol>` in the embedded sprite (`icon-sprite.svelte`). */
export const symbolId = (name: IconName) => `cx-${name}`;

/**
 * The icon as a sprite reference: a small `<svg>` whose `<use>` points at the symbol of the embedded sprite. The stroke
 * contract sits here, on the instance (symbols inherit it through `<use>`), so size, `currentColor` and `filled` stay
 * per instance. For markup generated outside Svelte (the exported callouts); `class` is a fixed token, never user input.
 */
export function iconUse(name: IconName, { size, filled = false, class: cls }: { size?: number; filled?: boolean; class?: string } = {}): string {
	const dim = size ? ` width="${size}" height="${size}"` : "";
	return `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24"${dim} fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="${strokeFor(size ?? 20)}" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="2" focusable="false" aria-hidden="true"><use href="#${symbolId(name)}"/></svg>`;
}
