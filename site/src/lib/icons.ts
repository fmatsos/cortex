/**
 * The site's icon pack: a single set, drawn for this project (no dependency), in the square language.
 *
 * `viewBox="0 0 24 24"` grid, stroke 1.75, butt ends, mitered joins (`stroke-miterlimit="2"`: a join sharper than
 * about 60 degrees is bevelled instead of spiking), live area 3..21 with optical adjustments. `stroke="currentColor"`,
 * `fill="none"`; only the active star is filled (`filled` prop). Each value is the inner SVG content: only `path`, `circle`, `rect`
 * and `g`. Corners are right angles: no `rx`, no arc used only to round a corner. Curves survive only where they
 * define the symbol (lens, moon, globe, sun, clock, refresh arcs, wifi). Nodes and the bulb are angular; straight
 * segments use whole or half units. A dot is a real 2x2 filled square
 * (`DOT`, `fill="currentColor" stroke="none"`), never a zero-length segment. A status container is a square frame.
 * The sprite is per page: `hooks.server.ts` scans each prerendered document for the `<use href="#cx-NAME">` it holds and
 * writes only those `<symbol>`s (`spriteMarkup()`); in the browser `ensureSymbols()` adds the missing ones (icons that
 * appear later, exported callouts) from the same `symbolMarkup()`. `icon.svelte` draws an instance (`<use>`);
 * `iconSvg()` renders a standalone SVG string (tests).
 */

const STAR = `<path d="m12 3 3 6 6 .5-4.5 4.5 1 6.5-5.5-3-5.5 3 1-6.5L3 9.5 9 9z"/>`;
const CLOSE = `<path d="m6 6 12 12M18 6 6 18"/>`;
const QUOTES = `<path d="M4 5h6v8H4zM10 13l-4 6M14 5h6v8h-6zM20 13l-4 6"/>`;
/** Square frame: the container of the status and outcome icons (the circle was only a container). */
const FRAME = `<rect x="3" y="3" width="18" height="18"/>`;
/** Shield with straight edges: verified / unverified / needs-review. */
const SHIELD = `<path d="M4 3h16v10l-8 8-8-8z"/>`;
const LOUPE = `<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5.5 5.5"/>`;
const TRAY = `<path d="M4 14v6h16v-6M12 3v12M7.5 10.5 12 15l4.5-4.5"/>`;
/** A dot: a real 2x2 filled square centred on (x, y); a zero-length segment vanishes with butt ends. */
const DOT = (x: number, y: number) => `<rect x="${x - 1}" y="${y - 1}" width="2" height="2" fill="currentColor" stroke="none"/>`;

export const ICONS = {
	// navigation
	home: `<path d="M4 10.5 12 3.5 20 10.5V20H4zM10 20v-6h4v6"/>`,
	search: LOUPE,
	graph: `<rect x="3" y="6" width="4" height="4"/><rect x="13" y="3" width="4" height="4"/><rect x="17" y="16" width="4" height="4"/><rect x="5" y="17" width="4" height="4"/><path d="M7 7.5l6-2M15.5 7l3 9M17 18.5 9 19M6.5 17l-1-7M7 9.5l10 7"/>`,
	tags: `<path d="M4 4h8l8.5 8.5-8 8L4 12z"/>${DOT(7.5, 7.5)}`,
	journal: `<rect x="4" y="3" width="16" height="18"/><path d="M9 3v18M13 8h4M13 12h4M13 16h4"/>`,
	favorites: STAR,

	// page types
	concept: `<path d="M8 3h8l3 3v5l-4 4v2H9v-2l-4-4V6zM9 21h6"/>`,
	entity: `<path d="M12 3 20 7.5v9L12 21 4 16.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/>`,
	synthesis: `<path d="M11 8V3h10v18H11v-5M3 5h3l5 7-5 7H3M11 12h7M14 7h4M14 17h4"/>`,
	source: `<path d="M14 3H4v18h16V9zM14 3v6h6M8 13h8M8 17h8"/>`,

	// status and trust
	draft: `<path d="M10 4H4v16h16v-6M9 11l8-8 4 4-8 8-5 1z"/>`,
	stable: `${FRAME}<path d="m7.5 12 3 3 6-6"/>`,
	deprecated: `${FRAME}<path d="m7 7 10 10"/>`,
	verified: `${SHIELD}<path d="m8 10 3 3 5-5"/>`,
	unverified: `${SHIELD}<path d="M8 8V6.5h7v3l-3 2"/>${DOT(12, 15)}`,
	"needs-review": `${SHIELD}<path d="M12 6.5v5"/>${DOT(12, 15)}`,
	stale: `<circle cx="10.5" cy="13.5" r="7.5"/><path d="M10.5 9v4.5l3 2M20 3v4"/>${DOT(20, 10.5)}`,

	// actions
	star: STAR,
	"copy-link": `<path d="m10 7 4-4h4l3 3v4l-4 4M14 17l-4 4H6l-3-3v-4l4-4M8 16l8-8"/>`,
	"copy-markdown": `<rect x="3" y="7" width="14" height="14"/><path d="M8 3h13v14M8.5 11 6 14l2.5 3M11.5 11l2.5 3-2.5 3"/>`,
	success: `<path d="m5 12 5 5L20 7"/>`,
	error: `${FRAME}<path d="M12 7v6"/>${DOT(12, 17)}`,

	// theme
	sun: `<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M17 7l2-2M17 17l2 2M7 17l-2 2M7 7 5 5"/>`,
	moon: `<path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5 7 7 0 0 0 20.5 13.5z"/>`,
	system: `<rect x="3" y="4" width="18" height="12.5"/><path d="M12 16.5V20M8.5 20h7"/>`,

	// search
	filter: `<path d="M3 4h18l-7 8v8l-4-2v-6z"/>`,
	"operator-tag": `<path d="M10 3.5 8.5 20.5M16.5 3.5 15 20.5M4.5 9h15.5M4 15h15.5"/>`,
	"operator-type": `<path d="m7 3 4 4-4 4-4-4zM12 14l5 7H7z"/><rect x="14" y="3" width="7" height="7"/>`,
	"operator-status": `<rect x="3" y="3" width="4" height="4"/><rect x="3" y="10" width="4" height="4"/><rect x="3" y="17" width="4" height="4"/><path d="M10.5 5H21M10.5 12H21M10.5 19H21"/>`,
	"operator-phrase": QUOTES,
	"operator-exclude": `${FRAME}<path d="M7.5 12h9"/>`,
	recent: `<path d="M4 10a8 8 0 1 1 0 4M4 4v6h6M12 7v5l3 2"/>`,
	clear: CLOSE,

	// reading
	toc: `<path d="M4 6h16M9 12h8M9 18h11"/>`,
	"chevron-down": `<path d="m6 9 6 6 6-6"/>`,
	back: `<path d="M20 12H4M10 6l-6 6 6 6"/>`,
	backlink: `<path d="M12 4H4v16h16v-6M21 3v8H11M15 7l-4 4 4 4"/>`,
	related: `<rect x="3" y="3" width="7" height="10"/><rect x="14" y="11" width="7" height="10"/><path d="M10 8h7v3"/>`,
	"external-link": `<path d="M14 4h6v6M20 4l-9 9M18 13.5V20H4V6h6.5"/>`,
	note: `<path d="M4 3h16v12l-6 6H4zM14 21v-6h6"/>`,
	warning: `<path d="M12 4 3 20h18zM12 9v4"/>${DOT(12, 17)}`,
	citation: QUOTES,
	"citation-return": `<path d="M20 5v10H5M9 11l-4 4 4 4"/>`,

	// log entry types
	"kind-add": `${FRAME}<path d="M12 8v8M8 12h8"/>`,
	"kind-ingest": TRAY,
	generated: `<path d="m10.5 3 2 5 5 2-5 2-2 5-2-5-5-2 5-2zM18 15v6M15 18h6"/>`,
	download: TRAY,
	"kind-query": `<path d="M3 4h18M3 8h5"/><circle cx="13" cy="14" r="5"/><path d="m16.5 17.5 3.5 3.5"/>`,
	"kind-lint": `<path d="m3 5.5 2 2 3-3M3 11.5l2 2 3-3M3 17.5l2 2 3-3M12 6h9M12 12h9M12 18h9"/>`,
	"kind-update": `<path d="M4 10a8.5 8.5 0 0 1 16 0M20 4v6h-6M20 14a8.5 8.5 0 0 1-16 0M4 20v-6h6"/>`,

	// graph
	"zoom-in": `${LOUPE}<path d="M10.5 7.5v6M7.5 10.5h6"/>`,
	"zoom-out": `${LOUPE}<path d="M7.5 10.5h6"/>`,
	"fit-view": `<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>${DOT(12, 12)}`,
	pause: `<path d="M8.5 5v14M15.5 5v14"/>`,
	play: `<path d="M6.5 4v16l14-8z"/>`,
	"close-selection": CLOSE,
	"list-view": `${DOT(4, 6)}${DOT(4, 12)}${DOT(4, 18)}<path d="M9 6h11M9 12h11M9 18h11"/>`,

	// network
	offline: `<path d="M3 8.5q9-7 18 0M6 13q6-5 12 0M17 16l4 4M21 16l-4 4"/>${DOT(12, 19.5)}`,
	"offline-ready": `<path d="m7 6 3 3 6-6"/><rect x="3" y="12" width="18" height="9"/>${DOT(7, 16.5)}`,
	retry: `<path d="M20 14a8 8 0 1 1 0-4M20 4v6h-6"/>`,
	language: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 4 6 4 9s-1 6-4 9c-3-3-4-6-4-9s1-6 4-9z"/>`,
	"new-tab": `<path d="M11 5H3v16h16v-8M3 9h8M15 3h6v6M21 3l-9 9"/>`,
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

/** Id of an icon's `<symbol>` in the embedded sprite. */
export const symbolId = (name: IconName) => `cx-${name}`;

/** Id of the embedded sprite element (the zero-size `<svg>` that holds the `<symbol>`s). */
export const SPRITE_ID = "cx-sprite";
const isIconName = (name: string): name is IconName => Object.hasOwn(ICONS, name);

/** One `<symbol>`: the single place its markup is written, for the build-time sprite and the client alike. */
export const symbolMarkup = (name: IconName) => `<symbol id="${symbolId(name)}" viewBox="0 0 24 24">${ICONS[name]}</symbol>`;

/**
 * The icon names a piece of HTML references through `<use href="#cx-NAME">`, in pack order, each once. Unknown names are
 * ignored. Matches a literal attribute only: an escaped one inside a serialized data payload (`href=\"#cx-...`) is not.
 */
export function referencedIcons(html: string): IconName[] {
	const seen = new Set<string>();
	for (const m of html.matchAll(/\bhref=(["'])#cx-([\w-]+)\1/g)) seen.add(m[2]);
	return ICON_NAMES.filter((n) => seen.has(n));
}

/**
 * The zero-size, out-of-flow sprite holding exactly the given symbols (`""` for none). Never `display: none`: some
 * browsers then fail to resolve `<use href="#...">`. The stroke contract is on each instance (`icon.svelte`), not here.
 * Unknown names are ignored.
 */
export function spriteMarkup(names: Iterable<string>): string {
	const wanted = new Set(names);
	const known = ICON_NAMES.filter((n) => wanted.has(n));
	if (!known.length) return "";
	return `<svg xmlns="http://www.w3.org/2000/svg" id="${SPRITE_ID}" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden">${known.map(symbolMarkup).join("")}</svg>`;
}

/** Adds the `<symbol>` of `name` to the document's sprite (created when absent) unless it is already there. */
export function ensureSymbol(name: string, doc: Document = document): void {
	if (!isIconName(name) || doc.getElementById(symbolId(name))) return;
	const sprite = doc.getElementById(SPRITE_ID);
	if (sprite) sprite.insertAdjacentHTML("beforeend", symbolMarkup(name));
	else doc.body.insertAdjacentHTML("afterbegin", spriteMarkup([name]));
}

/**
 * Makes every `<use href="#cx-NAME">` under `root` resolvable: adds the missing symbols to the sprite. Covers what the
 * build-time scan cannot see (HTML injected with `{@html}` after a client navigation, icons rendered later).
 */
export function ensureSymbols(root: ParentNode = document): void {
	const doc = (root as Node).nodeType === 9 ? (root as Document) : (root as Node).ownerDocument!;
	for (const u of root.querySelectorAll('use[href^="#cx-"]')) ensureSymbol(u.getAttribute("href")!.slice(4), doc);
}

/**
 * The icon as a sprite reference: a small `<svg>` whose `<use>` points at the symbol of the embedded sprite. The stroke
 * contract sits here, on the instance (symbols inherit it through `<use>`), so size, `currentColor` and `filled` stay
 * per instance. For markup generated outside Svelte (the exported callouts); `class` is a fixed token, never user input.
 */
export function iconUse(name: IconName, { size, filled = false, class: cls }: { size?: number; filled?: boolean; class?: string } = {}): string {
	const dim = size ? ` width="${size}" height="${size}"` : "";
	return `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24"${dim} fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="${strokeFor(size ?? 20)}" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="2" focusable="false" aria-hidden="true"><use href="#${symbolId(name)}"/></svg>`;
}
