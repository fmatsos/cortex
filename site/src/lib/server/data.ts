import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SiteData } from "#lib/types.js";

/** Data written by `cortex export` into $CORTEX_SITE_DATA (the site never reads the wiki itself). */
export const dataFile = (name: string): string => {
	const dir = process.env.CORTEX_SITE_DATA;
	if (!dir) throw new Error("CORTEX_SITE_DATA missing: the site is built by `cortex export`.");
	return readFileSync(join(dir, name), "utf8");
};

let cache: SiteData | undefined;
export const site = (): SiteData => (cache ??= JSON.parse(dataFile("data.json")));
