import { dataFile, site } from "#lib/server/data.js";
import type { Footer } from "#lib/types.js";

export const prerender = true;

/**
 * Footer: export date and a few wiki figures. A file of its own, read by the browser, and not layout data: the date and
 * the counts (the log grows with every operation) would otherwise be written into every prerendered page, so that
 * one changed page would change them all and the offline mode would download the whole site again.
 */
export const GET = () => {
	const { pages, tags, log } = site();
	const build = JSON.parse(dataFile("build.json")) as { generatedAt: string; links: number };
	const count = (t: string) => pages.filter((p) => p.type === t).length;
	const footer: Footer = {
		generatedAt: build.generatedAt,
		pages: pages.length,
		concepts: count("Concept"),
		entities: count("Entity"),
		syntheses: count("Synthesis"),
		sources: count("Source"),
		tags: tags.length,
		links: build.links,
		verified: pages.filter((p) => p.verified).length,
		log: log.length,
	};
	return new Response(JSON.stringify(footer), { headers: { "content-type": "application/json" } });
};
