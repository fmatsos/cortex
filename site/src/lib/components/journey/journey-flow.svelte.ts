import { account } from "#lib/account.svelte.js";
import { ApiError } from "#lib/api.js";
import { t } from "#lib/i18n/index.js";
import { serializeRoute } from "#lib/journey.js";
import { defaultJourneyTitle } from "#lib/journey-markdown.js";
import { exportRoute, saveJourney, toLink, type SavedLink } from "#lib/journey-session.js";
import { getJourney } from "#lib/journeys.js";
import type { GraphData } from "#lib/types.js";

type Message = { kind: "ok" | "error"; text: string };

/** What the flow reads from the graph page. */
export type JourneyContext = {
	route: () => string[];
	titleOf: (id: string) => string;
	graph: () => GraphData | undefined;
	/** The link to the saved copy changed: the page rewrites its address (`journey=<id>`). */
	changed: () => void;
};

/**
 * What the Save and Export buttons of the journey panel do, and the dialogs they open. The route is the page's; this one holds
 * the link to the saved copy (`saved`, which the address of the page keeps as `journey=<id>`), the dialogs that are open and
 * the short message that says what just happened. A saved copy is only ever updated with the route of the journey it was saved
 * from: Clear (`unlink`) lets the next route start a new copy.
 */
export class JourneyFlow {
	message = $state<Message | null>(null);
	saveOpen = $state(false);
	signInOpen = $state(false);
	busy = $state(false);
	exporting = $state(false);
	/** The saved copy this route belongs to, when there is one. */
	saved = $state<SavedLink | null>(null);
	/** The id of a saved copy the address asked for, until it is read (an account is needed) or given up. */
	wanted = $state<string | null>(null);
	private timer: ReturnType<typeof setTimeout> | undefined;
	private gen = 0;

	constructor(private ctx: JourneyContext) {}

	/** The id the address of the page carries: the saved copy, or the one still being looked for. */
	get linkedId() { return this.saved?.id ?? this.wanted; }
	/** Where the saved copy stands, for the state beside the buttons: nothing before there is a route, an account, or an answer about the copy. */
	get state(): "" | "saved" | "unsaved" {
		if (!account.me || !this.ctx.route().length || this.wanted) return "";
		return this.saved && this.saved.key === serializeRoute(this.ctx.route()) ? "saved" : "unsaved";
	}
	get defaultTitle() { return defaultJourneyTitle(this.ctx.route(), this.ctx.titleOf, t); }

	say(kind: Message["kind"], text: string) {
		clearTimeout(this.timer);
		this.message = { kind, text };
		if (kind === "ok") this.timer = setTimeout(() => (this.message = null), 5000);
	}
	dismiss() { clearTimeout(this.timer); this.message = null; }
	destroy() { clearTimeout(this.timer); }

	// ---- the link to the saved copy ------------------------------------------------------------------------------------

	/** The address names a saved copy (`?journey=<id>`): it is read once the account is known (`resolve`). */
	link(id: string | null) { if (id && !this.saved) this.wanted = id; }
	/** Reads the copy asked for by the address. Without an account, or when it is gone, the address stops naming it. */
	async resolve(signedIn: boolean) {
		const id = this.wanted;
		if (!id) return;
		const gen = this.gen;
		let link: SavedLink | null = null;
		if (signedIn) {
			try { link = toLink(await getJourney(id)); } catch (e) { if (e instanceof ApiError && e.status === 401) account.expire(); }
		}
		if (gen !== this.gen || this.wanted !== id) return;
		this.wanted = null;
		this.saved = link;
		this.ctx.changed();
	}
	/** The route starts over: the saved copy is not this journey any more. */
	unlink() { this.gen++; this.saved = null; this.wanted = null; }

	// ---- save ----------------------------------------------------------------------------------------------------------

	/** The Save button: sign in first when there is no session; the first save asks for a name, the next ones go straight through. */
	save() {
		if (this.busy) return;
		if (!account.me) { if (account.methods.length) this.signInOpen = true; return; }
		if (!this.ctx.route().length || this.wanted) return;
		if (this.saved) void this.update(); else this.saveOpen = true;
	}
	private async update() {
		this.busy = true;
		const gen = this.gen, route = [...this.ctx.route()];
		try {
			const r = await saveJourney(route, this.saved);
			if (gen === this.gen) { this.saved = r.link; this.ctx.changed(); }
			this.say("ok", t(`journey.message.${r.result}`));
		} catch { this.say("error", t("journey.save.failed")); } finally { this.busy = false; }
	}
	/** The name dialog: throws when the server refuses (the dialog stays open and says so). */
	async submitName(title: string) {
		const gen = this.gen, route = [...this.ctx.route()];
		const r = await saveJourney(route, this.saved, title);
		if (gen === this.gen) { this.saved = r.link; this.ctx.changed(); }
		this.say("ok", t(`journey.message.${r.result}`));
	}

	// ---- export --------------------------------------------------------------------------------------------------------

	/** `format: "path"`: a draft of a reading path (goal and reasons left to write) instead of the journey. */
	async export(format: "journey" | "path" = "journey") {
		if (this.exporting || !this.ctx.route().length) return;
		this.exporting = true;
		const route = [...this.ctx.route()];
		try {
			const { partial } = await exportRoute({ route, title: this.saved?.title || this.defaultTitle, created: this.saved?.created_at, graph: this.ctx.graph(), format });
			this.say(partial ? "error" : "ok", format === "path" ? t(partial ? "journey.message.draftExportedPartial" : "journey.message.draftExported") : t(partial ? "journey.message.exportedPartial" : "journey.message.exported"));
		} catch { this.say("error", t("journey.export.failed")); } finally { this.exporting = false; }
	}
}
