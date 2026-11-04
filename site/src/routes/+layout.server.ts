import { dataFile, site } from "#lib/server/data.js";

/** Pied de page : nom, date d'export et quelques chiffres du wiki, calculés au prérendu. */
export const load = () => {
	const { pages, tags, log } = site();
	const build = JSON.parse(dataFile("build.json")) as { generatedAt: string; links: number };
	const count = (t: string) => pages.filter((p) => p.type === t).length;
	return {
		footer: {
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
		},
	};
};
