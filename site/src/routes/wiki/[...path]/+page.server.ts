import { error } from "@sveltejs/kit";
import { sharedSources } from "#lib/article.js";
import { site } from "#lib/server/data.js";

export const entries = () => site().pages.map((p) => ({ path: p.id }));

export const load = ({ params }) => {
	const { pages, tags } = site();
	const page = pages.find((p) => p.id === params.path.replace(/\/$/, ""));
	if (!page) error(404, "Page not found");
	const slugs = Object.fromEntries(tags.map((t) => [t.tag, t.slug]));
	// sources that each related page shares with this one: the "shared source" reason says which ones
	return { page, slugs, shared: sharedSources(page, pages) };
};
