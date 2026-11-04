// Favorites: specific to each browser (the site is static), stored in localStorage.
const KEY = "brain:favs";
let ids = $state<string[]>([]);
let failed = $state(false); // the last write failed: favorites only last for this session
let removed = $state<string | null>(null); // last favorite removed, to undo it

const save = () => {
	try { localStorage.setItem(KEY, JSON.stringify(ids)); failed = false; } catch { failed = true; }
};
const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); ids = Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { ids = []; } };

export const favs = {
	get ids() { return ids; },
	/** False if the browser refused to save: the interface must then say so ("conservés pour cette session seulement"). */
	get persisted() { return !failed; },
	/** Last favorite removed (id), as long as it can be restored by `undo()`. */
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
	/** To call once on the browser side (not at prerender); also follows changes made in another tab. */
	init() {
		load();
		const on = (e: StorageEvent) => { if (e.key === KEY) load(); };
		window.addEventListener("storage", on);
		return () => window.removeEventListener("storage", on);
	},
};
