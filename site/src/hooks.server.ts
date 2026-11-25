import { defaultLocale, t } from "#lib/i18n/index.js";
import { referencedIcons, spriteMarkup } from "#lib/icons.js";

// app.html placeholders filled in the export's language at prerender: <html lang> and the <noscript> notice
// (no JavaScript there, so the visitor's language choice cannot apply anyway).
const FILL: Record<string, () => string> = {
	"%cortex.lang%": () => defaultLocale,
	"%cortex.noscript.text%": () => t("noscript.text"),
	"%cortex.noscript.browse%": () => t("noscript.browse"),
	"%cortex.noscript.home%": () => t("noscript.home"),
	"%cortex.noscript.or%": () => t("noscript.or"),
	"%cortex.noscript.tags%": () => t("noscript.tags"),
};

// Per-page icon sprite: right after the opening <body> (outside the hydrated root, so hydration never sees it), the
// symbols that this document references and nothing else. SvelteKit hands the whole document in one chunk
// (`done: true`); a chunk without <body> is left alone, and the client (`ensureSymbols`) completes whatever the scan
// misses, so a split document would degrade to a late sprite, never to a missing icon.
const BODY_OPEN = /<body\b[^>]*>/;
const withSprite = (html: string) => {
	const open = BODY_OPEN.exec(html);
	if (!open) return html;
	const at = open.index + open[0].length;
	return html.slice(0, at) + spriteMarkup(referencedIcons(html)) + html.slice(at);
};

type Resolve = (event: unknown, opts: { transformPageChunk: (input: { html: string; done: boolean }) => string }) => unknown;
export const handle = ({ event, resolve }: { event: unknown; resolve: Resolve }) =>
	resolve(event, { transformPageChunk: ({ html }) => withSprite(html.replace(/%cortex\.[\w.]+%/g, (m) => FILL[m]?.() ?? m)) });
