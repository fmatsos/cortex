import { resolve } from "$app/paths";

// All routes are prerendered as `x/index.html` (trailingSlash "always") and links are relative
// during server rendering (paths.relative): the site works behind any file server, subpath included.
const slash = (p: string) => (p.endsWith("/") ? p : `${p}/`);

export const toPage = (id: string) => slash(resolve("/wiki/[...path]", { path: id }));
export const toTag = (slug: string) => slash(resolve("/tags/[tag]", { tag: slug }));
export const toRoute = (r: "/" | "/graph" | "/tags" | "/log" | "/search") => slash(resolve(r));
