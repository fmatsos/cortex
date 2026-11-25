import { untrack } from "svelte";
import { replaceState } from "$app/navigation";
import { page } from "$app/state";
import { api, ApiError } from "./api";
import { favs } from "./favs.svelte";
import { lang } from "./lang.svelte";
import { plan, stateKey, toBody, type SyncState } from "./sync-state";
import { theme } from "./theme.svelte";

/**
 * The visitor's account on a `cortex serve` site with sign-in configured (`auth` of cortex.json). On a static site, or when
 * the server is out of reach, `/api/auth/methods` does not answer: `methods` stays empty, nobody is shown any account element
 * and the site works as it always did. Loaded once at start (`init`, from the layout's `onMount`), never blocking a render:
 * `ready` says when `methods` and `me` are known.
 *
 * Preferences (theme, language, favorites) stay local first. Once signed in, the account's state is read once; the first
 * synchronisation of an account sends the local state, later ones apply the server's (favorites: union), then every change
 * goes back as one `PUT` of the whole object, 1.5 s after the last one (see sync-state.ts for the rules).
 */
export type Provider = { id: string; label: string };
export type Me = { id: string; name: string; email: string; provider: string };
export type AuthNotice = "refused" | "error";

const DEBOUNCE_MS = 1500;
const STATE = "/api/me/state";

/** The one place that reads the local stores... */
const collectLocal = (): SyncState => ({ theme: theme.mode, lang: lang.choice, favs: [...favs.ids] });
/** ...and the one that writes them: only what differs is touched (a language change re-renders the whole layout). */
function applyLocal(next: SyncState) {
	if (next.theme !== theme.mode) theme.set(next.theme);
	if (next.lang !== lang.choice) lang.set(next.lang);
	favs.replace(next.favs);
}

const isProvider = (p: unknown): p is Provider => !!p && typeof p === "object" && typeof (p as Provider).id === "string" && typeof (p as Provider).label === "string";
const asMe = (m: unknown): Me | null => {
	const o = m as Partial<Record<keyof Me, unknown>> | null;
	return o && typeof o.id === "string" && typeof o.name === "string" ? { id: o.id, name: o.name, email: typeof o.email === "string" ? o.email : "", provider: typeof o.provider === "string" ? o.provider : "" } : null;
};

class Account {
	/** Sign-in methods the server offers; empty on a static site or when none is configured. */
	methods = $state<Provider[]>([]);
	me = $state<Me | null>(null);
	/** `methods` and `me` are known (the page of the account waits for it before saying "not signed in"). */
	ready = $state(false);
	/** Why the last sign-in did not open a session (`?auth=` of the return URL), until the visitor dismisses it. */
	notice = $state<AuthNotice | null>(null);
	private started = false;
	private base: unknown = {}; // what the server holds, to PUT back the keys this front end does not know
	private lastSent = "";
	private timer: ReturnType<typeof setTimeout> | undefined;
	private stopWatch: (() => void) | undefined;

	/** The account elements (menu entries, page content) exist: sign-in is configured here, or a session is open. */
	get enabled() { return this.me !== null || this.methods.length > 0; }
	/** Display name of a provider id (the label the server gave it). */
	providerLabel(id: string) { return this.methods.find((p) => p.id === id)?.label ?? id; }

	/** Once per page load, in the browser (after the stores read their local value). */
	async init() {
		if (this.started) return;
		this.started = true;
		try {
			const r = await api<{ providers?: unknown }>("/api/auth/methods");
			this.methods = Array.isArray(r.providers) ? r.providers.filter(isProvider) : [];
		} catch { /* a static site answers 404, a server out of reach nothing: no account elements */ }
		if (this.methods.length) {
			try { this.me = asMe(await api("/api/me")); } catch { /* 401: signed out */ }
		}
		this.ready = true;
		if (this.me) void this.startSync();
	}

	/** Reads `?auth=refused|error` (the return of a sign-in that did not open a session), keeps the message and clears it from the URL. */
	takeNotice() {
		const url = new URL(location.href), a = url.searchParams.get("auth");
		if (a !== "refused" && a !== "error") return;
		this.notice = a;
		url.searchParams.delete("auth");
		replaceState(url, page.state);
	}
	dismissNotice() { this.notice = null; }

	/** Leaves for the provider; the server brings the visitor back to the page they are on. */
	signIn(provider: string) {
		const here = new URL(location.href);
		here.searchParams.delete("auth");
		location.assign(`/api/auth/login/${encodeURIComponent(provider)}?return=${encodeURIComponent(here.pathname + here.search + here.hash)}`);
	}

	async signOut() {
		await this.flush();
		try { await api("/api/auth/logout", { method: "POST" }); } catch { /* the reload below shows what the server says */ }
		location.reload();
	}

	/** The server no longer knows the session (a 401 on any account call): back to signed out, local preferences only. */
	expire() {
		this.me = null;
		this.stopSync();
	}

	/** Deletes the account and everything under it; the caller leaves for the home page. Throws `ApiError`. */
	async remove() {
		this.stopSync();
		await api("/api/me", { method: "DELETE" });
		this.me = null; // the sign-in methods stay: the visitor may open a new account
	}

	// ---- preferences synchronisation ---------------------------------------------------------------------------------

	private async startSync() {
		let server: unknown;
		try { server = await api(STATE); } catch (e) { if (e instanceof ApiError && e.status === 401) this.me = null; return; }
		const { apply, push } = plan(collectLocal(), server);
		this.base = server;
		this.lastSent = push ? "" : stateKey(apply);
		applyLocal(apply);
		if (push) await this.flush();
		// only now: watching before the server's state is applied would send this browser's defaults over it
		const stop = $effect.root(() => {
			$effect(() => {
				const key = stateKey(collectLocal());
				untrack(() => this.schedule(key));
			});
		});
		const leave = () => void this.flush(true);
		addEventListener("pagehide", leave);
		this.stopWatch = () => { stop(); removeEventListener("pagehide", leave); };
	}

	private stopSync() {
		clearTimeout(this.timer);
		this.stopWatch?.();
		this.stopWatch = undefined;
	}

	private schedule(key: string) {
		clearTimeout(this.timer);
		if (key !== this.lastSent) this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
	}

	/** Sends the current state now if it differs from the last one sent (`leaving`: the page is going away). */
	private async flush(leaving = false) {
		clearTimeout(this.timer);
		if (!this.me) return;
		const state = collectLocal(), key = stateKey(state);
		if (key === this.lastSent) return;
		try {
			const body = toBody(this.base, state);
			await fetch(STATE, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: leaving })
				.then((r) => {
					if (r.status === 401) { this.me = null; this.stopSync(); } // the session ended: back to local only
					else if (r.ok) { this.lastSent = key; this.base = body; }
				});
		} catch { /* offline: the next change tries again */ }
	}
}

export const account = new Account();
