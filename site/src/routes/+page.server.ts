import { site } from "#lib/server/data.js";

export const load = () => ({
	pages: site().pages.map(({ id, type, title, description, status, tags }) => ({ id, type, title, description, status, tags })),
	nbTags: site().tags.length,
});
