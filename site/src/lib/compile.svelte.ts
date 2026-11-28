import { api, ApiError } from "./api";
import { t } from "./i18n/index";
import { spaceApi } from "./space";

/** `GET /api/compile` of `cortex serve` (src/serve.ts): the compile of the space's pending sources, run on demand. */
export type CompileStatus = { running: boolean; pending: number; done: number; failed: number; current?: { id: string; title: string }; lastError?: string };

/** Between two reads while a compile runs. */
export const POLL_MS = 3_000;

const asStatus = (v: unknown): CompileStatus | undefined => {
	const o = v as Partial<CompileStatus> | null;
	if (!o || typeof o !== "object" || typeof o.running !== "boolean" || typeof o.pending !== "number") return;
	const num = (n: unknown) => (typeof n === "number" ? n : 0);
	const cur = o.current as { id?: unknown; title?: unknown } | undefined;
	return {
		running: o.running, pending: o.pending, done: num(o.done), failed: num(o.failed),
		current: cur && typeof cur.id === "string" ? { id: cur.id, title: typeof cur.title === "string" && cur.title ? cur.title : cur.id } : undefined,
		lastError: typeof o.lastError === "string" ? o.lastError : undefined,
	};
};

/**
 * "Compile the queue": the sources a space holds pending are compiled now by the server, instead of at the next scheduled run. `available` is
 * true only when the server answers `GET /api/compile` (a `cortex serve` where the visitor is a member of the space: 401, 403 and 404 mean no
 * entry, and a static site has no such route). Once started, the status is read every few seconds until the run ends; `summary` then tells how
 * it went (until the visitor closes it), and `announce` is the text of the polite live region: one line at the start, one per source
 * compiled or failed, one at the end.
 */
class CompileState {
	available = $state(false);
	status = $state<CompileStatus>({ running: false, pending: 0, done: 0, failed: 0 });
	/** The run that ended during this visit: shown until dismissed. */
	summary = $state<{ done: number; failed: number; lastError?: string } | null>(null);
	/** The server refused to start (409: another run, read-only…): its own words. */
	error = $state("");
	announce = $state("");
	private timer: ReturnType<typeof setTimeout> | undefined;
	private probed = false;
	private seen = 0;

	get running() { return this.status.running; }
	/** What the run is doing, in words: counts so far, and the source in hand. */
	get progress() {
		const s = this.status;
		return t("compile.progress", { done: s.done, failed: s.failed }) + (s.current ? ` ${t("compile.current", { title: s.current.title })}` : "");
	}

	/** Reads the queue once (when the visitor is known to write there); a visit shows the entry or never does. */
	async probe() {
		if (this.probed) return;
		this.probed = true;
		try {
			const s = asStatus(await api(spaceApi("/api/compile")));
			if (!s) return;
			this.available = true;
			this.apply(s);
			if (s.running) this.poll(); // a run started elsewhere (another tab, an earlier visit): followed all the same
		} catch { /* 401, 403, 404, out of reach: no entry */ }
	}

	/** Starts the run. The server answers 202 with the status, or says why not (409, 400). */
	async start() {
		if (this.running || this.status.pending === 0) return;
		this.error = "";
		this.summary = null;
		try {
			const s = asStatus(await api(spaceApi("/api/compile"), { method: "POST" }));
			if (s) this.apply(s);
			this.say(t("compile.started"));
			this.poll();
		} catch (e) {
			this.error = e instanceof ApiError && e.detail ? e.detail : t("compile.failedToStart");
			this.say(this.error);
			await this.refresh();
		}
	}

	dismiss() { this.summary = null; this.error = ""; }

	private poll() {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.refresh().then(() => { if (this.running) this.poll(); }), POLL_MS);
	}

	/** Reads the status again (the menu does when it opens: sources may have been added since the page loaded). */
	async refresh() {
		try { const s = asStatus(await api(spaceApi("/api/compile"))); if (s) this.apply(s); }
		catch (e) { if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { this.available = false; this.status = { ...this.status, running: false }; } }
	}

	private apply(s: CompileStatus) {
		const was = this.status.running;
		this.status = s;
		const n = s.done + s.failed;
		if (s.running && n > this.seen) this.say(this.progress);
		if (s.running) { this.seen = n; return; }
		this.seen = 0;
		if (was) { // it ended while the visitor watched
			this.summary = { done: s.done, failed: s.failed, lastError: s.lastError };
			this.say(t("compile.summary", { done: s.done, failed: s.failed }));
		}
	}

	private say(text: string) { this.announce = text; }
}

export const compile = new CompileState();
