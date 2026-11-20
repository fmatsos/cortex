/**
 * Optional notions of the wiki, from cortex.json (`review`, `drafts`), resolved by `cortex export` and injected at build time
 * as __CORTEX_FEATURES__ (site/vite.config.ts). Off: the site shows nothing of them (badges, filters, facets, actions).
 * Outside a Vite build (unit tests), everything is on.
 */
declare const __CORTEX_FEATURES__: { review: boolean; drafts: boolean } | undefined;
export const features = typeof __CORTEX_FEATURES__ === "object" ? __CORTEX_FEATURES__ : { review: true, drafts: true };
