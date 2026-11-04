import { parseRecent, pushRecent } from "./recent";

const KEY = "brain:recent";

/**
 * État de recherche partagé : une seule requête pour toutes les surfaces (champ de l'en-tête, grand champ de l'accueil et de /search/,
 * puces, facettes). `/search/` en est la vue complète ; l'URL (`?q=`) y fait foi et recopie ici.
 * Le champ visible enregistre son <input> : Ctrl+K et « / » (dans le layout) y donnent le focus.
 */
class SearchState {
	q = $state("");
	/** Recherches validées, la plus récente d'abord (localStorage, propre à ce navigateur). */
	recent = $state<string[]>([]);
	private input: HTMLInputElement | null = null;

	/** Enregistre le champ visible ; renvoie la désinscription (à appeler au démontage). */
	register(el: HTMLInputElement) {
		this.input = el;
		return () => { if (this.input === el) this.input = null; };
	}
	focus() {
		this.input?.focus();
		this.input?.select();
	}
	/** À appeler une fois côté navigateur (pas au prérendu). */
	init() {
		try { this.recent = parseRecent(localStorage.getItem(KEY)); } catch { this.recent = []; }
	}
	private save() { try { localStorage.setItem(KEY, JSON.stringify(this.recent)); } catch { /* stockage indisponible : historique de la session */ } }
	remember(q: string) { this.recent = pushRecent(this.recent, q); this.save(); }
	forget() { this.recent = []; try { localStorage.removeItem(KEY); } catch { /* ignoré */ } }
}

export const search = new SearchState();
