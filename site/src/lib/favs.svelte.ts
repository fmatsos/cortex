// Favoris : propres à chaque navigateur (le site est statique), stockés dans localStorage.
const KEY = "brain:favs";
let ids = $state<string[]>([]);
let failed = $state(false); // la dernière écriture a échoué : les favoris ne durent que pour cette session
let removed = $state<string | null>(null); // dernier favori retiré, pour l'annuler

const save = () => {
	try { localStorage.setItem(KEY, JSON.stringify(ids)); failed = false; } catch { failed = true; }
};
const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); ids = Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { ids = []; } };

export const favs = {
	get ids() { return ids; },
	/** Faux si le navigateur a refusé d'enregistrer : l'interface doit alors le dire (« conservés pour cette session seulement »). */
	get persisted() { return !failed; },
	/** Dernier favori retiré (id), tant qu'il peut être rétabli par `undo()`. */
	get removed() { return removed; },
	has: (id: string) => ids.includes(id),
	toggle(id: string) {
		const had = ids.includes(id);
		ids = had ? ids.filter((x) => x !== id) : [...ids, id];
		removed = had ? id : null;
		save();
	},
	undo() {
		if (removed && !ids.includes(removed)) { ids = [...ids, removed]; save(); }
		removed = null;
	},
	dismissUndo() { removed = null; },
	/** À appeler une fois côté navigateur (pas au prérendu) ; suit aussi les modifications faites dans un autre onglet. */
	init() {
		load();
		const on = (e: StorageEvent) => { if (e.key === KEY) load(); };
		window.addEventListener("storage", on);
		return () => window.removeEventListener("storage", on);
	},
};
