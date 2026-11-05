import { site } from "#lib/server/data.js";
import { searchSeed } from "#lib/server/search-seed.js";
import { TYPES } from "#lib/type-meta.js";

const PREVIEW = 5; // pages shown per collection; "See all" opens the filtered view of /search/

// The home page stays bounded whatever the size of the wiki: a preview per collection (title, French alphabetical order),
// the exact count, and what it takes to start a search. Favorites are found in the search index, on the browser side.
export const load = () => {
	const pages = site().pages;
	return {
		seed: searchSeed(),
		collections: TYPES.map((t) => {
			const all = pages.filter((p) => p.type === t.type).sort((a, b) => a.title.localeCompare(b.title, "fr"));
			return {
				type: t.type,
				count: all.length,
				preview: all.slice(0, PREVIEW).map(({ id, type, title, description, status, verified, needsReview, partial }) => ({ id, type, title, description, status, verified: !!verified, needsReview, partial })),
			};
		}).filter((c) => c.count),
	};
};
