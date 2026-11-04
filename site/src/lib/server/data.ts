import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SiteData } from "#lib/types.js";

/** Données écrites par `brain export` dans $BRAIN_SITE_DATA (le site ne lit jamais le wiki lui-même). */
export const dataFile = (name: string): string => {
	const dir = process.env.BRAIN_SITE_DATA;
	if (!dir) throw new Error("BRAIN_SITE_DATA manquant : le site se construit avec `brain export`.");
	return readFileSync(join(dir, name), "utf8");
};

let cache: SiteData | undefined;
export const site = (): SiteData => (cache ??= JSON.parse(dataFile("data.json")));
