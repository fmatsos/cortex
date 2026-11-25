import { parseRecent, pushRecent } from "./recent";
import { storageKey } from "./storage";

const KEY = storageKey("recent");

/**
 * Shared search state: a single query for all surfaces (header field, large field of the home page and of /search/,
 * chips, facets). `/search/` is the full view; the URL (`?q=`) is authoritative there and copies back here.
 * The visible field registers its <input>: Ctrl+K and "/" (in the layout) give it focus.
 */
class SearchState {
	q = $state("");
	/**
	 * The last search the visitor validated (Enter, a link with `?q=`): the only one the server's hybrid search and its judge answer
	 * on /search/. Typing never changes it, and the palette never sends it anywhere.
	 */
	validated = $state("");
	/** Validated searches, most recent first (localStorage, specific to this browser). */
	recent = $state<string[]>([]);
	private input: HTMLInputElement | null = null;

	/**
	 * A deliberate change of the query on /search/ (a facet, a chip, a fix, "reset filters", "clear"): the visitor chose it, so it is a
	 * validated search, unlike typing. What is displayed, the counters included, then keeps agreeing with what a click announces.
	 */
	apply(q: string) {
		this.q = q;
		this.validated = q.trim();
	}
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
