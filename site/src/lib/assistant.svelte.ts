import { spaceApi } from "./space";
import type { Scope } from "./space-search";
import { spaceKey } from "./storage";

/** Longest question the server accepts (src/serve.ts MAX_QUESTION): checked before sending. */
export const MAX_QUESTION = 500;

/** A display block of an answer, its text fields already sanitized HTML (src/answer-blocks.ts DrawnBlock). */
export type Block =
	| { type: "callout"; tone: "info" | "warning" | "success" | "danger"; title?: string; html: string }
	| { type: "table"; title?: string; columns: string[]; rows: string[][] }
	| { type: "steps"; title?: string; items: { title: string; html: string }[] }
	| { type: "tabs"; tabs: { label: string; html: string }[] }
	| { type: "facts"; title?: string; items: { label: string; html: string }[] }
	| { type: "pages"; title?: string; items: { id: string; title: string; html: string }[] };
export type Segment = { html: string } | { block: Block };
/** A page an answer cites, with the space it is in (an answer that read several spaces cites pages of each). */
export type PageRef = { space: string; id: string; title: string };
/** `md`: the answer as written, sent back as history; retained and related: the pages the judge chose, by id. `refs`: only for an answer that read several spaces, the pages it cites, each with its space. */
export type Answer = { segments: Segment[]; md: string; cited: string[]; retained: string[]; related: string[]; model?: string; refs?: PageRef[] };
/** `stopped`: the visitor stopped the answer on its way (never an HTTP status). */
export type AskErrorKind = "busy" | "off" | "invalid" | "scope" | "failed" | "network" | "stopped";
/** What the agent is doing (the server's `step` event): the panel words it; `path` and `title` of a page read, `query` of a search. */
export type Step = { kind: "pages" | "read" | "search" | "layout" | "write" | "work"; path?: string; title?: string; query?: string };
/**
 * `at`: when the answer came (ISO), kept in the saved copy. `partial`, `draft`, `step`: the text written so far (raw), the same
 * text rendered (segments, like an answer's) and what the agent is doing while the answer is on its way. Provisional: never
 * saved; a turn that stops or is cut keeps `partial` and `draft` on screen for this page, next to its error.
 */
export type Turn = { id: number; q: string; answer?: Answer; error?: AskErrorKind; pending?: boolean; at?: string; partial?: string; draft?: Segment[]; step?: Step };
/** The saved copy this conversation continues: its id, its name, the exchanges it holds (`keys`) and when it was created. */
export type SavedLink = { id: string; title: string; keys: string; created_at: string };
/** A turn as `POST /api/conversations` (of the page's space: conversations.ts) takes it. */
export type SavedTurn = { question: string; answer: string; pages?: string[]; at?: string };

/** HTTP status of POST /api/ask → what the visitor is told (and whether a retry makes sense). */
export const askErrorKind = (status: number): AskErrorKind =>
	status === 429 ? "busy" : status === 404 ? "off" : status === 400 ? "invalid" : "failed";

const KEY = spaceKey("assistant");
/** What identifies the exchanges of a conversation: their numbers (never reused, so an answer asked again is a new one). */
export const keysOf = (turns: Turn[]) => turns.map((t) => t.id).join(",");

/**
 * The assistant (`cortex serve` with site_ask): a conversation with the wiki's agent, in a panel of the shell that survives
 * navigation. The server keeps no state: the earlier answered turns travel with each question. Kept for the tab
 * (sessionStorage): a reload of a static page must not lose the conversation.
 */
class Assistant {
	/** The server answers questions (HEAD probe): a static host has no /api/. */
	api = $state(false);
	/** Earlier exchanges the server sends on to the agent (`x-ask-history-turns` of the probe); null: unknown (an older server). */
	historyTurns = $state<number | null>(null);
	open = $state(false);
	turns = $state<Turn[]>([]);
	draft = $state("");
	/** Where the next question reads: this space, all the visitor's, or the ones they picked (the server drops what they may not see). A conversation stays in the space it is asked in. */
	scope = $state<Scope>("current");
	picked = $state<string[]>([]);
	/** Bumped when the panel must take focus on its question field (entry points outside the panel). */
	focusSeq = $state(0);
	/** The saved copy of this conversation (null: never saved). Kept with the turns, so a reload does not start a second copy. */
	saved = $state<SavedLink | null>(null);
	/** A conversation of the account page waits to be resumed here (the panel's flow takes it). */
	resumeRequest = $state<string | null>(null);
	/** Bumped when the conversation is replaced (new, resumed): a save that comes back after that is not about this one. */
	generation = 0;
	private probed = false;
	private next = 1;
	/** Aborts the request of the answer on its way (the server then stops the run and frees its one-question lock). */
	private ctl?: AbortController;

	get pending() { return this.turns.some((t) => t.pending); }
	/** `spaces` of the next question: nothing for this space, "all", or the picked names; undefined too when "choose" holds none yet (then `scopeReady` is false). */
	get spaces(): "all" | string[] | undefined { return this.scope === "all" ? "all" : this.scope === "set" && this.picked.length ? this.picked : undefined; }
	/** A scope that names no space cannot be asked. */
	get scopeReady() { return this.scope !== "set" || this.picked.length > 0; }
	/** The exchanges that got an answer: what is saved and exported (a failed or waiting one is not). */
	get complete() { return this.turns.filter((t) => t.answer); }
	/** The conversation holds as many answered exchanges as the server passes on: the next ones push the oldest out of the agent's memory. */
	get historyFull() { return this.historyTurns !== null && this.complete.length >= this.historyTurns; }
	/** Something to save or export, and nothing on its way. */
	get canSave() { return !this.pending && this.complete.length > 0; }
	/** Answered exchanges that the saved copy does not hold (a new one, or a conversation never saved). */
	get dirty() { return this.complete.length > 0 && keysOf(this.complete) !== this.saved?.keys; }

	/** Once per page load, in the browser. */
	probe() {
		if (this.probed) return;
		this.probed = true;
		try {
			const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
			if (saved) {
				this.turns = (saved.turns as Turn[]).filter((t) => !t.pending);
				this.open = !!saved.open;
				this.next = Math.max(0, ...this.turns.map((t) => t.id)) + 1;
				const link = saved.saved;
				this.saved = link && typeof link.id === "string" && typeof link.keys === "string" ? { id: link.id, title: String(link.title ?? ""), keys: link.keys, created_at: String(link.created_at ?? "") } : null;
			}
		} catch { /* storage unavailable */ }
		fetch(spaceApi("/api/ask"), { method: "HEAD" }).then((r) => {
			this.api = r.status === 204;
			const n = Number(r.headers.get("x-ask-history-turns"));
			this.historyTurns = Number.isInteger(n) && n > 0 ? n : null;
		}, () => {});
	}

	private save() {
		try { sessionStorage.setItem(KEY, JSON.stringify({ turns: this.turns.filter((t) => !t.pending).map(({ partial, draft, step, ...t }) => t), open: this.open, saved: this.saved })); } catch { /* storage unavailable: kept for this page only */ }
	}

	setOpen(open: boolean) { this.open = open; this.save(); }

	/** Opens the panel with `question` as the draft, ready to confirm with Enter: never sent. Empty: opens, keeps the draft. */
	prefill(question: string) {
		const q = question.trim();
		if (q) this.draft = q;
		this.open = true;
		this.focusSeq++;
		this.save();
	}

	/** Sends a question; false when it is not sent (empty, another one pending, too long: then the turn says why). */
	ask(question: string): boolean {
		const q = question.trim();
		if (!q || this.pending || !this.scopeReady) return false;
		this.open = true;
		this.focusSeq++;
		const turn: Turn = { id: this.next++, q, pending: q.length <= MAX_QUESTION, error: q.length > MAX_QUESTION ? "invalid" : undefined };
		// the earlier turns that got an answer: what the agent needs to understand a follow-up
		const spaces = this.spaces;
		const history = this.turns.flatMap((t) => (t.answer ? [{ role: "user", text: t.q }, { role: "assistant", text: t.answer.md }] : []));
		this.turns = [...this.turns, turn];
		this.draft = "";
		if (!turn.pending) { this.save(); return false; }
		const ctl = (this.ctl = new AbortController());
		// the text so far (raw, then rendered) and the step: what a cut or failed turn keeps on screen
		let partial = "", draft: Segment[] | undefined, step: Step | undefined, timer: ReturnType<typeof setTimeout> | undefined;
		const settle = (change: Partial<Turn>) => {
			if (this.ctl === ctl) this.ctl = undefined;
			this.turns = this.turns.map((t) => (t.id === turn.id ? { ...t, partial: undefined, draft: undefined, step: undefined, ...change, pending: false } : t));
			this.save();
		};
		const keep = (error: AskErrorKind) => { clearTimeout(timer); settle({ error, partial: partial || undefined, draft }); };
		const done = (b: any) => {
			if (!Array.isArray(b.segments)) return keep("failed");
			const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
			const refs = Array.isArray(b.refs) ? b.refs.flatMap((r: any): PageRef[] => (r && typeof r.space === "string" && typeof r.id === "string" ? [{ space: r.space, id: r.id, title: String(r.title ?? r.id) }] : [])) : undefined;
			settle({ at: new Date().toISOString(), answer: { segments: b.segments, md: String(b.md ?? ""), cited: ids(b.cited), retained: ids(b.retained), related: ids(b.related), model: b.model, ...(refs?.length ? { refs } : {}) } });
		};
		void (async () => {
			try {
				const r = await fetch(spaceApi("/api/ask"), { method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson, application/json" }, body: JSON.stringify({ q, history, ...(spaces && { spaces }) }), signal: ctl.signal });
				if (!r.ok || !r.body || !r.headers.get("content-type")?.includes("application/x-ndjson")) {
					const b = await r.json().catch(() => ({}));
					return r.ok ? done(b) : settle({ error: spaces && r.status === 400 ? "scope" : askErrorKind(r.status) });
				}
				// one JSON event per line: the text so far and its rendering (shown a few times a second, not saved), then the final payload
				let buf = "", final: any;
				const show = () => { timer = undefined; this.turns = this.turns.map((t) => (t.id === turn.id ? { ...t, partial, draft, step } : t)); };
				const line = (l: string) => {
					if (!l.trim()) return;
					const e = JSON.parse(l);
					if (e.t === "delta") { partial += String(e.text ?? ""); step = { kind: "write" }; timer ??= setTimeout(show, 60); }
					else if (e.t === "step") { step = e.step; show(); }
					else if (e.t === "draft") { if (Array.isArray(e.segments)) { draft = e.segments; timer ??= setTimeout(show, 60); } }
					else if (e.t === "reset") { clearTimeout(timer); partial = ""; draft = undefined; step = { kind: "work" }; show(); }
					else if (e.t === "done") final = e;
					else if (e.t === "error") final = {};
				};
				const reader = r.body.getReader(), dec = new TextDecoder();
				for (let c = await reader.read(); !c.done; c = await reader.read()) {
					buf += dec.decode(c.value, { stream: true });
					const lines = buf.split("\n");
					buf = lines.pop()!;
					lines.forEach(line);
				}
				line(buf + dec.decode());
				clearTimeout(timer);
				if (!final) throw new Error("stream cut");
				done(final);
			} catch { keep(ctl.signal.aborted ? "stopped" : "network"); }
		})();
		return true;
	}

	/** Asks a failed question again, in place of its turn. */
	retry(turn: Turn) {
		if (this.pending) return;
		this.turns = this.turns.filter((t) => t.id !== turn.id);
		this.ask(turn.q);
	}

	/** Stops the answer on its way: its turn settles as stopped, keeping what had arrived. */
	stop() { this.ctl?.abort(); }

	/** A new conversation; an answer on its way is aborted first (it must not come back into the new one). */
	clear() {
		this.ctl?.abort();
		this.turns = [];
		this.saved = null;
		this.generation++;
		this.save();
	}

	/** The saved copy now holds these answered exchanges (`keys` taken when the request left). */
	markSaved(link: SavedLink) { this.saved = link; this.save(); }

	/** The conversation was renamed on the account page. */
	renamed(id: string, title: string) { if (this.saved?.id === id) { this.saved = { ...this.saved, title }; this.save(); } }
	/** The saved copy was deleted on the account page: what is here is no longer saved anywhere. */
	forget(id: string) { if (this.saved?.id === id) { this.saved = null; this.save(); } }

	/**
	 * Replaces the conversation by a saved one and opens the panel on it: the next question goes into the same copy. `drawn`
	 * holds the segments of each answer (the server draws them: the saved copy holds the Markdown only); the answers keep their
	 * Markdown as written, which is also what the history sent to `/api/ask` carries.
	 */
	load(c: { id: string; title: string; created_at: string; turns: SavedTurn[] }, drawn: { segments: Segment[]; refs?: PageRef[] }[]) {
		this.generation++;
		this.turns = c.turns.map((t, i) => ({
			id: this.next++, q: t.question, at: t.at,
			answer: { segments: drawn[i]?.segments ?? [], md: t.answer, cited: t.pages ?? [], retained: [], related: [], ...(drawn[i]?.refs?.length ? { refs: drawn[i]!.refs } : {}) },
		}));
		this.saved = { id: c.id, title: c.title, keys: keysOf(this.turns), created_at: c.created_at };
		this.open = true;
		this.focusSeq++;
		this.save();
	}
}

export const assistant = new Assistant();
