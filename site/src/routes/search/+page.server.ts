import { searchSeed } from "#lib/server/search-seed.js";

// The page is prerendered without a query (`?q=` is only read in the browser): we give it what it takes to start.
export const load = () => ({ seed: searchSeed() });
