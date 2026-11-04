import { error } from "@sveltejs/kit";
import { site } from "#lib/server/data.js";

export const entries = () => site().tags.map((t) => ({ tag: t.slug }));

export const load = ({ params }) => {
	const t = site().tags.find((x) => x.slug === params.tag);
	if (!t) error(404, "Tag introuvable");
	const pages = site().pages.filter((p) => t.ids.includes(p.id)).map(({ id, type, title, description, status }) => ({ id, type, title, description, status }));
	return { tag: t.tag, pages };
};
