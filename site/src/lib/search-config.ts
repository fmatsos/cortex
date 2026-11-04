import type { IFuseOptions } from "fuse.js";

/** Champs de l'index : titre, description, tags, contenu (tous passés par `fold`). Titre pondéré plus fort. */
export const FUSE_OPTIONS: IFuseOptions<unknown> = {
  keys: [{ name: "t", weight: 3 }, { name: "d", weight: 1.5 }, { name: "g", weight: 1 }, { name: "x", weight: 0.4 }],
  threshold: 0.3, // tolérance aux fautes de frappe
  ignoreLocation: true, // le terme peut apparaître n'importe où dans le champ
  minMatchCharLength: 2,
  includeScore: true,
  includeMatches: true,
};
