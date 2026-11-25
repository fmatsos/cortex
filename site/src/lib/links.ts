import { resolve } from "$app/paths";

// All routes are prerendered as `x/index.html` (trailingSlash "always") and links are relative
// during server rendering (paths.relative): the site works behind any file server, subpath included.
const slash = (p: string) => (p.endsWith("/") ? p : `${p}/`);

export const toPage = (id: string) => slash(resolve("/wiki/[...path]", { path: id }));
// owner: a tag always leads to the search page filtered on it (`#tag` operator), never to a dead label
export const toTag = (tag: string) => `${slash(resolve("/search"))}?q=${encodeURIComponent(`#${tag}`)}`;
export const toRoute = (r: "/" | "/graph" | "/tags" | "/log" | "/search" | "/design-system") => slash(resolve(r));
