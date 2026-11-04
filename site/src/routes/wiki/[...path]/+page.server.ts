import { error } from "@sveltejs/kit";
import { sharedSources } from "#lib/article.js";
import { site } from "#lib/server/data.js";

export const entries = () => site().pages.map((p) => ({ path: p.id }));

export const load = ({ params }) => {
	const { pages, tags } = site();
	const page = pages.find((p) => p.id === params.path.replace(/\/$/, ""));
	if (!page) error(404, "Page introuvable");
	const slugs = Object.fromEntries(tags.map((t) => [t.tag, t.slug]));
	// sources que chaque page liée partage avec celle-ci : le motif « source commune » dit lesquelles
	return { page, slugs, shared: sharedSources(page, pages) };
};
