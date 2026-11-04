import { site } from "#lib/server/data.js";

export const load = () => ({
	pages: site().pages.map(({ id, type, title, description, status, tags, partial }) => ({ id, type, title, description, status, tags, partial })),
	nbTags: site().tags.length,
});
