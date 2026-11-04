import { resolve } from "$app/paths";

// Toutes les routes sont prérendues en `x/index.html` (trailingSlash « always ») et les liens sont relatifs
// pendant le rendu serveur (paths.relative) : le site marche derrière n'importe quel serveur de fichiers, sous-chemin compris.
const slash = (p: string) => (p.endsWith("/") ? p : `${p}/`);

export const toPage = (id: string) => slash(resolve("/wiki/[...path]", { path: id }));
export const toTag = (slug: string) => slash(resolve("/tags/[tag]", { tag: slug }));
export const toRoute = (r: "/" | "/graph" | "/tags" | "/log" | "/search") => slash(resolve(r));
