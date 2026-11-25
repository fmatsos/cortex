import { error } from "@sveltejs/kit";
import { sharedSources } from "#lib/article.js";
import { site } from "#lib/server/data.js";

export const entries = () => site().pages.map((p) => ({ path: p.id }));

export const load = ({ params }) => {
	const { pages } = site();
	const page = pages.find((p) => p.id === params.path.replace(/\/$/, ""));
	if (!page) error(404, "Page not found");
	// sources that each related page shares with this one: the "shared source" reason says which ones
	return { page, shared: sharedSources(page, pages) };
};
