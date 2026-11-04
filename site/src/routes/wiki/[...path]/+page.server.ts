import { error } from "@sveltejs/kit";
import { site } from "#lib/server/data.js";

export const entries = () => site().pages.map((p) => ({ path: p.id }));

export const load = ({ params }) => {
	const page = site().pages.find((p) => p.id === params.path.replace(/\/$/, ""));
	if (!page) error(404, "Page introuvable");
	const slugs = Object.fromEntries(site().tags.map((t) => [t.tag, t.slug]));
	return { page, slugs };
};
