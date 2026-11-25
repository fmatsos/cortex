import { changesOf } from "#lib/changes.js";
import { site } from "#lib/server/data.js";

/** Pages created or modified, newest first, with their dates: the browser keeps what the visitor has already seen. */
export const load = () => {
	const { pages, log } = site();
	return { changes: changesOf(pages, log) };
};
