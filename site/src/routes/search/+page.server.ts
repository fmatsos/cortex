import { searchSeed } from "#lib/server/search-seed.js";

// La page est prérendue sans requête (`?q=` ne se lit que dans le navigateur) : on lui donne de quoi démarrer.
export const load = () => ({ seed: searchSeed() });
