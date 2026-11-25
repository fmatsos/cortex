import { error } from "@sveltejs/kit";
import { readingPaths } from "#lib/server/paths-data.js";

export const entries = () => readingPaths().map((p) => ({ slug: p.slug }));

export const load = ({ params }) => {
	const path = readingPaths().find((p) => p.slug === params.slug.replace(/\/$/, ""));
	if (!path) error(404, "Path not found");
	return { path };
};
