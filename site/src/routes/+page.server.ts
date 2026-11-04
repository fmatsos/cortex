import { site } from "#lib/server/data.js";
import { searchSeed } from "#lib/server/search-seed.js";
import { TYPES } from "#lib/type-meta.js";

const PREVIEW = 5; // pages montrées par collection ; « Voir tout » ouvre la vue filtrée de /search/

// L'accueil reste borné quelle que soit la taille du wiki : un aperçu par collection (titre, ordre alphabétique français),
// l'effectif exact, et de quoi démarrer une recherche. Les favoris se retrouvent dans l'index de recherche, côté navigateur.
export const load = () => {
	const pages = site().pages;
	return {
		seed: searchSeed(),
		collections: TYPES.map((t) => {
			const all = pages.filter((p) => p.type === t.type).sort((a, b) => a.title.localeCompare(b.title, "fr"));
			return {
				type: t.type,
				plural: t.plural,
				count: all.length,
				preview: all.slice(0, PREVIEW).map(({ id, type, title, description, status, verified, needsReview, partial }) => ({ id, type, title, description, status, verified: !!verified, needsReview, partial })),
			};
		}).filter((c) => c.count),
	};
};
