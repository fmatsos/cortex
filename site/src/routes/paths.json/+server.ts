import { toPathNav } from "#lib/paths.js";
import { readingPaths } from "#lib/server/paths-data.js";

export const prerender = true;

/**
 * The reading paths in the form an article needs to show "Previous / Next" (titles and reasons, no HTML). A file of its own,
 * read by the browser only when the address names a path (`?path=`): the pages' data stays the same whatever the paths are.
 */
export const GET = () => new Response(JSON.stringify(readingPaths().map(toPathNav)), { headers: { "content-type": "application/json" } });
