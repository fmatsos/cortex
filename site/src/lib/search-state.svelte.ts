import { parseRecent, pushRecent } from "./recent";

const KEY = "brain:recent";

/**
 * Shared search state: a single query for all surfaces (header field, large field of the home page and of /search/,
 * chips, facets). `/search/` is the full view; the URL (`?q=`) is authoritative there and copies back here.
 * The visible field registers its <input>: Ctrl+K and "/" (in the layout) give it focus.
 */
class SearchState {
	q = $state("");
	/** Validated searches, most recent first (localStorage, specific to this browser). */
	recent = $state<string[]>([]);
	private input: HTMLInputElement | null = null;

	/** Registers the visible field; returns the unregistration (to call on unmount). */
	register(el: HTMLInputElement) {
		this.input = el;
		return () => { if (this.input === el) this.input = null; };
	}
	focus() {
		this.input?.focus();
		this.input?.select();
	}
	/** To call once on the browser side (not at prerender). */
	init() {
		try { this.recent = parseRecent(localStorage.getItem(KEY)); } catch { this.recent = []; }
	}
	private save() { try { localStorage.setItem(KEY, JSON.stringify(this.recent)); } catch { /* storage unavailable: session history */ } }
	remember(q: string) { this.recent = pushRecent(this.recent, q); this.save(); }
	forget() { this.recent = []; try { localStorage.removeItem(KEY); } catch { /* ignored */ } }
}

export const search = new SearchState();
