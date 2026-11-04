// Favoris : propres à chaque navigateur (le site est statique), stockés dans localStorage.
const KEY = "brain:favs";
let ids = $state<string[]>([]);

const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* stockage indisponible : favoris de la session seulement */ } };
const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); ids = Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { ids = []; } };

export const favs = {
	get ids() { return ids; },
	has: (id: string) => ids.includes(id),
	toggle(id: string) { ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]; save(); },
	/** À appeler une fois côté navigateur (pas au prérendu) ; suit aussi les modifications faites dans un autre onglet. */
	init() {
		load();
		const on = (e: StorageEvent) => { if (e.key === KEY) load(); };
		window.addEventListener("storage", on);
		return () => window.removeEventListener("storage", on);
	},
};
