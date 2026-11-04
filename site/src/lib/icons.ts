/**
 * Pack d'icônes du site : un seul jeu, dessiné pour ce projet (aucune dépendance).
 *
 * Grille `viewBox="0 0 24 24"`, trait 1,75, extrémités et jonctions arrondies, rayon usuel 2,
 * marge optique 2. `stroke="currentColor"`, `fill="none"` ; seule l'étoile active est remplie (prop `filled`).
 * Chaque valeur est le contenu interne du SVG : uniquement `path`, `circle`, `rect` et `g`
 * (un point = `h.01` avec extrémités rondes). L'enveloppe est dans `icon.svelte` ; `iconSvg()` la rend en chaîne
 * pour les usages hors Svelte (tests, motifs CSS en `mask`).
 */

const STAR = `<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>`;
const CLOSE = `<path d="m7 7 10 10M17 7 7 17"/>`;
const CIRCLE = `<circle cx="12" cy="12" r="9"/>`;
const SHIELD = `<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6z"/>`;
const LOUPE = `<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5.5 5.5"/>`;

export const ICONS = {
	// navigation
	home: `<path d="M3 11 12 3.5 21 11"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/>`,
	search: LOUPE,
	graph: `<circle cx="12" cy="6.5" r="2.5"/><circle cx="6" cy="17.5" r="2.5"/><circle cx="18" cy="17.5" r="2.5"/><path d="m10.8 8.7-3.6 6.6M13.2 8.7l3.6 6.6"/>`,
	tags: `<path d="M3.5 4.5a1 1 0 0 1 1-1h6.2a1 1 0 0 1 .7.3l8.8 8.8a1.4 1.4 0 0 1 0 2l-6 6a1.4 1.4 0 0 1-2 0L3.8 12.2a1 1 0 0 1-.3-.7z"/><circle cx="8" cy="8" r="1.25"/>`,
	journal: `<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v18M12.5 8h3.5M12.5 12h3.5M12.5 16h3.5"/>`,
	favorites: STAR,

	// types de pages
	concept: `<path d="M12 3a6 6 0 0 0-3.5 10.9L9.5 16h5l1-2.1A6 6 0 0 0 12 3z"/><path d="M9.5 18.5h5M10.5 21h3"/>`,
	entity: `<path d="M12 3 20 7.5v9L12 21 4 16.5v-9z"/><path d="m12 12-7.7-4.3M12 12l7.7-4.3M12 12v9"/>`,
	synthesis: `<circle cx="6" cy="5.5" r="2"/><circle cx="18" cy="5.5" r="2"/><path d="M6 7.5v1a3 3 0 0 0 3 3h3M18 7.5v1a3 3 0 0 1-3 3h-3M12 11.5V16"/><rect x="8.75" y="16" width="6.5" height="4.5" rx="1.5"/>`,
	source: `<path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3v3.5A1.5 1.5 0 0 0 15.5 8H19M9 13h6M9 16.5h6"/>`,

	// statut et confiance
	draft: `<circle cx="12" cy="12" r="9" stroke-dasharray="2.2 4.87"/>`,
	stable: `${CIRCLE}<path d="m8 12.3 2.8 2.8 5.4-5.7"/>`,
	deprecated: `${CIRCLE}<path d="m5.6 5.6 12.8 12.8"/>`,
	verified: `${SHIELD}<path d="m9 12 2.2 2.2 3.8-4"/>`,
	unverified: `${SHIELD}<path d="M9.8 9.9a2.3 2.3 0 0 1 4.4.8c0 1.5-2.2 1.8-2.2 3.1M12 16.4h.01"/>`,
	"needs-review": `${SHIELD}<path d="M12 8.5v4.2M12 16.2h.01"/>`,
	stale: `<circle cx="10.5" cy="13.5" r="7.5"/><path d="M10.5 9.5v4l2.7 1.7M20 3.5v4M20 10.5h.01"/>`,

	// actions
	star: STAR,
	"copy-link": `<g transform="rotate(-45 12 12)"><path d="M10.5 8H6a4 4 0 0 0 0 8h4.5M13.5 8H18a4 4 0 0 1 0 8h-4.5M9 12h6"/></g>`,
	"copy-markdown": `<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h8.5A2.5 2.5 0 0 1 17.5 8.5V19a2.5 2.5 0 0 1-2.5 2.5H6.5A2.5 2.5 0 0 1 4 19z"/><path d="M9 3.5h8.5A2.5 2.5 0 0 1 20.5 6v10M9.5 12 7.5 14.25l2 2.25M12.5 12l2 2.25-2 2.25"/>`,
	success: `<path d="m5 12.5 4.8 4.8L19 7.5"/>`,
	error: `${CIRCLE}<path d="M12 7.5v5.5M12 16.5h.01"/>`,

	// thème
	sun: `<circle cx="12" cy="12" r="3.8"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M16.95 7.05l1.77-1.77M16.95 16.95l1.77 1.77M7.05 16.95l-1.77 1.77M7.05 7.05 5.28 5.28"/>`,
	moon: `<path d="M20.5 13.5A8.75 8.75 0 1 1 10.5 3.5 7 7 0 0 0 20.5 13.5z"/>`,
	system: `<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M12 16.5V20M8.5 20h7"/>`,

	// recherche
	filter: `<path d="M4 5.5h16L14 12.8V19l-4-2v-4.2z"/>`,
	"operator-tag": `<path d="M10 3.5 8.5 20.5M16.5 3.5 15 20.5M4.5 9h15.5M4 15h15.5"/>`,
	"operator-type": `<circle cx="7.5" cy="7.5" r="3.75"/><rect x="13" y="3.75" width="7.5" height="7.5" rx="1"/><path d="M12 14 16.25 20.5h-8.5z"/>`,
	"operator-status": `<circle cx="5" cy="5" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="5" cy="19" r="2"/><path d="M10.5 5H21M10.5 12H21M10.5 19H21"/>`,
	"operator-phrase": `<path d="M10 6.5H6.25A2.25 2.25 0 0 0 4 8.75V13h6zM10 13c0 2.5-1.8 4.3-4.5 4.8"/><path d="M20 6.5h-3.75A2.25 2.25 0 0 0 14 8.75V13h6zM20 13c0 2.5-1.8 4.3-4.5 4.8"/>`,
	"operator-exclude": `${CIRCLE}<path d="M7.5 12h9"/>`,
	recent: `<path d="M3.8 12a8.2 8.2 0 1 0 2.4-5.8L3.5 8.5M3.5 3.8v4.7h4.7M12 7.5V12l3 1.8"/>`,
	clear: CLOSE,

	// lecture
	toc: `<path d="M4 6h16M9 12h8M9 18h11"/>`,
	"chevron-down": `<path d="m6 9 6 6 6-6"/>`,
	back: `<path d="M20 12H4M10 6l-6 6 6 6"/>`,
	backlink: `<path d="M4.5 4.5V9a3 3 0 0 0 3 3H10M7.5 9.5 10 12l-2.5 2.5"/><rect x="12.5" y="3.5" width="8" height="17" rx="2"/><path d="M15.5 9h2M15.5 12.5h2"/>`,
	related: `<rect x="3" y="3" width="8" height="10" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/><path d="M11 8h6v3"/>`,
	"external-link": `<path d="M14 4h6v6M20 4l-9 9M18 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5"/>`,
	note: `<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5V14l-5 5H7.5A2.5 2.5 0 0 1 5 16.5z"/><path d="M14 19v-3.5a1.5 1.5 0 0 1 1.5-1.5H19"/>`,
	warning: `<path d="M10.3 4.5 3.2 17a2 2 0 0 0 1.7 3h14.2a2 2 0 0 0 1.7-3L13.7 4.5a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>`,
	citation: `<rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M9.5 10.5v3.2a1.8 1.8 0 0 1-1.8 1.8M15.5 10.5v3.2a1.8 1.8 0 0 1-1.8 1.8"/>`,
	"citation-return": `<path d="M20 5v7a3 3 0 0 1-3 3H5M9 11l-4 4 4 4"/>`,

	// types d'entrée du journal
	"kind-add": `${CIRCLE}<path d="M12 8v8M8 12h8"/>`,
	"kind-ingest": `<path d="M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14M12 4v10M8 10.5l4 4 4-4"/>`,
	generated: `<path d="M11 3.5l1.9 4.6 4.6 1.9-4.6 1.9L11 16.5l-1.9-4.6L4.5 10l4.6-1.9z"/><path d="M18 14.5v5M15.5 17h5"/>`,
	download: `<path d="M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14M12 4v10M8 10.5l4 4 4-4"/>`,
	"kind-query": `<path d="M3.5 4.5H20.5M3.5 8.5H11"/><circle cx="13" cy="15" r="4.5"/><path d="m16.3 18.3 3.2 3.2"/>`,
	"kind-lint": `<path d="m3.5 6.2 1.6 1.6 3-3.2M3.5 12.2l1.6 1.6 3-3.2M3.5 18.2l1.6 1.6 3-3.2M12 6h9M12 12h9M12 18h9"/>`,
	"kind-update": `<path d="M4.12 10.61A8 8 0 0 1 19.88 10.61M21.5 7.8l-1.62 2.81L17.4 8.55M19.88 13.39A8 8 0 0 1 4.12 13.39M2.5 16.2l1.62-2.81 2.48 2.06"/>`,

	// graphe
	"zoom-in": `${LOUPE}<path d="M10.5 7.75v5.5M7.75 10.5h5.5"/>`,
	"zoom-out": `${LOUPE}<path d="M7.75 10.5h5.5"/>`,
	"fit-view": `<path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3M12 12h.01"/>`,
	pause: `<path d="M8.5 5v14M15.5 5v14"/>`,
	play: `<path d="M8 5.2 19 12 8 18.8z"/>`,
	"close-selection": CLOSE,
	"list-view": `<path d="M4 6h.01M4 12h.01M4 18h.01M9 6h11M9 12h11M9 18h11"/>`,

	// réseau
	offline: `<path d="M3 9.2a13.5 13.5 0 0 1 18 0M6.2 12.8a8.8 8.8 0 0 1 11.6 0M9.4 16.2a4.2 4.2 0 0 1 5.2 0M12 19.7h.01M4 4l16 16"/>`,
	"offline-ready": `<path d="m8.5 7.8 2.6 2.6 4.5-5"/><rect x="3.5" y="13.5" width="17" height="7" rx="2"/><path d="M7.5 17h.01"/>`,
	retry: `<path d="M20 12a8 8 0 1 1-2.3-5.6L20 8.6M20 3.5v5.1h-5.1"/>`,
	"new-tab": `<path d="M7 6.5v-1a2 2 0 0 1 2-2h5"/><rect x="3.5" y="9" width="11.5" height="11.5" rx="2"/><path d="m12 12.5 8.5-8.5M15.5 3.5h5v5"/>`,
} as const;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export const STROKE_WIDTH = 1.75;
/** Variante optique : en dessous de 18 px, le trait s'épaissit un peu pour garder le même poids visuel. */
export const strokeFor = (size: number) => (size < 18 ? 2 : STROKE_WIDTH);

export type IconSvgOptions = { size?: number; filled?: boolean; label?: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Le SVG complet d'une icône, en chaîne (mêmes attributs que `icon.svelte`). */
export function iconSvg(name: IconName, { size = 20, filled = false, label }: IconSvgOptions = {}): string {
	const a11y = label ? `role="img" aria-label="${esc(label)}"` : `aria-hidden="true"`;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="${strokeFor(size)}" stroke-linecap="round" stroke-linejoin="round" focusable="false" ${a11y}>${ICONS[name]}</svg>`;
}

/** URL `data:` d'une icône pour `mask-image` en CSS (pastilles des encarts : le contenu exporté ne porte pas de SVG). */
export function iconMask(name: IconName): string {
	const svg = iconSvg(name, { size: 24 }).replace(/"/g, "'");
	return `url("data:image/svg+xml,${svg.replace(/</g, "%3C").replace(/>/g, "%3E").replace(/#/g, "%23")}")`;
}
