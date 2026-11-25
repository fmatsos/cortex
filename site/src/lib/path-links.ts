import { resolve } from "$app/paths";
import { PATH_PARAM, type PathNavData } from "./paths.js";
import { toPage } from "./links.js";

// Addresses of the reading paths and the maintenance page (prerendered as `x/index.html`, relative links: see links.ts).
const slash = (p: string) => (p.endsWith("/") ? p : `${p}/`);

export const toPaths = () => slash(resolve("/paths"));
export const toPath = (slug: string) => slash(resolve("/paths/[slug]", { slug }));
export const toMaintenance = () => slash(resolve("/maintenance"));
/** A page read in a path: the `?path=` parameter keeps the path (and its Previous / Next) through the walk. */
export const toPageInPath = (id: string, slug: string) => `${toPage(id)}?${PATH_PARAM}=${encodeURIComponent(slug)}`;

let loading: Promise<PathNavData[]> | undefined;
/** The paths, in the form an article needs (`/paths.json`), fetched once; none when the file cannot be read (offline, an old export): the article simply shows no path. */
export const loadPathNav = (): Promise<PathNavData[]> =>
	(loading ??= fetch(resolve("/paths.json")).then((r) => (r.ok ? (r.json() as Promise<PathNavData[]>) : [])).catch(() => { loading = undefined; return []; }));
