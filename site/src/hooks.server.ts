import { defaultLocale, t } from "#lib/i18n/index.js";

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

type Resolve = (event: unknown, opts: { transformPageChunk: (input: { html: string }) => string }) => unknown;
export const handle = ({ event, resolve }: { event: unknown; resolve: Resolve }) =>
	resolve(event, { transformPageChunk: ({ html }) => html.replace(/%cortex\.[\w.]+%/g, (m) => FILL[m]?.() ?? m) });
