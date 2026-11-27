import { t } from "./i18n/index";
import { spaceApi } from "./space";

/** `GET /api/status` of `cortex serve` (src/serve.ts): the site is being rebuilt (a build running or waiting) and how the last one ended. */
export type BuildStatus = { building: boolean; since?: string; last?: { at: string; ok: boolean; ms: number } };

/** Between two probes while nothing builds (the tab is visible); and while a build runs. */
export const IDLE_MS = 30_000, BUILDING_MS = 3_000;
/** How long "Site mis à jour" stays (longer while the visitor points at it or has the focus in it). */
export const DONE_MS = 10_000, HOLD_MS = 4_000, ANNOUNCE_MS = 6_000;
/** Failures in a row, after a first answer, before the probe is given up (the server restarting must not end it at once). */
const MAX_FAILURES = 3;

const asStatus = (v: unknown): BuildStatus | undefined => {
	const o = v as Partial<BuildStatus> | null;
	return o && typeof o === "object" && typeof o.building === "boolean" ? { building: o.building, since: o.since, last: o.last } : undefined;
};

/**
 * Is the site being rebuilt: a small indicator for a `cortex serve` site (never on the static export, which has no `/api/*`).
 * One probe at load, then every 30 s while the tab is visible and every 3 s while a build runs; none in a hidden tab (it starts
 * again, at once, when the tab comes back) and none while the browser is offline. A 404 or a network failure on the first probe
 * means the function is absent (static site, server out of reach): no more probes.
 *
 * Three things are told to the visitor, never more: a build began (`building`), a build that the visitor saw begin or run has
 * ended (`updated`, with a reload on request: the page is never reloaded by itself, a form, a conversation or a journey in
 * progress must not be lost), and, for screen readers, the same two as one `announce` text each (never one per probe).
 * A build that failed changes nothing for the visitor: the previous site stays served.
 */
class BuildState {
	/** A build is running or waiting. */
	building = $state(false);
	/** A build ended during this visit: the notice offers the reload, for a few seconds. */
	updated = $state(false);
	/** Text for the polite live region: one at the start of a build, one at its end. */
	announce = $state("");
	/** The pointer or the focus is on the notice: it stays. */
	hold = false;
	private started = false;
	private absent = false;
	private answered = false;
	private failures = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private doneTimer: ReturnType<typeof setTimeout> | undefined;
	private sayTimer: ReturnType<typeof setTimeout> | undefined;
	private inFlight = false;
	private okAt: string | undefined; // `last.at` of the latest successful build seen
	private swapped = false; // a build succeeded during this build period, whatever the last one did

	/** Once per page load, in the browser (the layout's indicator calls it when it appears). */
	start() {
		if (this.started) return;
		this.started = true;
		document.addEventListener("visibilitychange", () => { if (document.hidden) this.stop(); else void this.probe(); });
		addEventListener("online", () => void this.probe());
		addEventListener("offline", () => this.stop());
		void this.probe();
	}

	private stop() { clearTimeout(this.timer); this.timer = undefined; }

	private schedule() {
		this.stop();
		if (this.absent || document.hidden || !navigator.onLine) return;
		this.timer = setTimeout(() => void this.probe(), this.building ? BUILDING_MS : IDLE_MS);
	}

	private async probe() {
		if (this.absent || this.inFlight || document.hidden || !navigator.onLine) return;
		this.stop();
		this.inFlight = true;
		let status: BuildStatus | undefined, gone = false;
		try {
			const r = await fetch(spaceApi("/api/status"), { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(8000) });
			if (r.status === 404 || r.status === 405) gone = true; // no such route: a static site
			else if (r.ok) status = asStatus(await r.json().catch(() => undefined)) ?? undefined;
		} catch { /* below */ }
		this.inFlight = false;
		if (status) { this.answered = true; this.failures = 0; this.apply(status); }
		else if (gone || !this.answered || ++this.failures >= MAX_FAILURES) { this.absent = true; this.building = false; return; }
		this.schedule();
	}

	private apply(s: BuildStatus) {
		// a build ended and the next one, already waiting, goes on: `last` changes while `building` stays true. The site was swapped then,
		// even if that next build fails and is the last word.
		const ok = s.last?.ok ? s.last.at : undefined;
		if (s.building && this.building && ok && ok !== this.okAt) this.swapped = true;
		if (ok) this.okAt = ok;
		if (s.building && !this.building) {
			this.building = true;
			this.swapped = false;
			this.dismiss();
			this.say(t("build.updating"));
		} else if (!s.building && this.building) {
			this.building = false;
			const failed = s.last?.ok === false && !this.swapped; // the previous site stays: nothing to tell
			this.swapped = false;
			if (failed) { this.say(""); return; }
			this.updated = true;
			this.say(t("build.updated"));
			this.arm();
		}
	}

	/** The notice goes after `ms`, unless the visitor is on it: then a little longer. */
	private arm(ms = DONE_MS) {
		clearTimeout(this.doneTimer);
		this.doneTimer = setTimeout(() => (this.hold ? this.arm(HOLD_MS) : this.dismiss()), ms);
	}

	/** Sets the live region's text and empties it later, so the same text can be announced again by the next build. */
	private say(text: string) {
		clearTimeout(this.sayTimer);
		this.announce = text;
		if (text) this.sayTimer = setTimeout(() => (this.announce = ""), ANNOUNCE_MS);
	}

	/** Closes the "updated" notice. */
	dismiss() { clearTimeout(this.doneTimer); this.updated = false; this.hold = false; }

	/** The visitor asks for the new version. */
	reload() { location.reload(); }
}

export const buildStatus = new BuildState();
