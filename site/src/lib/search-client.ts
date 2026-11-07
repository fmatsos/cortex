import { resolve } from "$app/paths";
import { createEngine, type Engine } from "./search-engine";
import type { SearchIndex } from "./types";

export * from "./search-engine";

let engine: Promise<Engine> | undefined;

/** Loads the index precomputed at export (only once, kept in memory). A failure is not memoized: one can retry. */
export const loadEngine = () =>
	(engine ??= (async () => {
		const [{ default: Fuse }, idx] = await Promise.all([
			import("fuse.js"),
			fetch(resolve("/search-index.json")).then((r) => {
				if (!r.ok) throw new Error(`index de recherche : HTTP ${r.status}`);
				return r.json() as Promise<SearchIndex>;
			}),
		]);
		return createEngine(idx, Fuse);
	})().catch((e) => { engine = undefined; throw e; }));
