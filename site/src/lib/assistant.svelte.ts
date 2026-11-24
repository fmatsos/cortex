import { storageKey } from "./storage";

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
/** `md`: the answer as written, sent back as history; retained and related: the pages the judge chose, by id. */
export type Answer = { segments: Segment[]; md: string; cited: string[]; retained: string[]; related: string[]; model?: string };
export type AskErrorKind = "busy" | "off" | "invalid" | "failed" | "network";
export type Turn = { id: number; q: string; answer?: Answer; error?: AskErrorKind; pending?: boolean };

/** HTTP status of POST /api/ask → what the visitor is told (and whether a retry makes sense). */
export const askErrorKind = (status: number): AskErrorKind =>
	status === 429 ? "busy" : status === 404 ? "off" : status === 400 ? "invalid" : "failed";

const KEY = storageKey("assistant");

/**
 * The assistant (`cortex serve` with site_ask): a conversation with the wiki's agent, in a panel of the shell that survives
 * navigation. The server keeps no state: the earlier answered turns travel with each question. Kept for the tab
 * (sessionStorage): a reload of a static page must not lose the conversation.
 */
class Assistant {
	/** The server answers questions (HEAD probe): a static host has no /api/. */
	api = $state(false);
	open = $state(false);
	turns = $state<Turn[]>([]);
	draft = $state("");
	private probed = false;
	private next = 1;

	get pending() { return this.turns.some((t) => t.pending); }

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
			}
		} catch { /* storage unavailable */ }
		fetch("/api/ask", { method: "HEAD" }).then((r) => (this.api = r.status === 204), () => {});
	}

	private save() {
		try { sessionStorage.setItem(KEY, JSON.stringify({ turns: this.turns.filter((t) => !t.pending), open: this.open })); } catch { /* storage unavailable: kept for this page only */ }
	}

	setOpen(open: boolean) { this.open = open; this.save(); }

	/** Sends a question; false when it is not sent (empty, another one pending, too long: then the turn says why). */
	ask(question: string): boolean {
		const q = question.trim();
		if (!q || this.pending) return false;
		this.open = true;
		const turn: Turn = { id: this.next++, q, pending: q.length <= MAX_QUESTION, error: q.length > MAX_QUESTION ? "invalid" : undefined };
		// the earlier turns that got an answer: what the agent needs to understand a follow-up
		const history = this.turns.flatMap((t) => (t.answer ? [{ role: "user", text: t.q }, { role: "assistant", text: t.answer.md }] : []));
		this.turns = [...this.turns, turn];
		this.draft = "";
		if (!turn.pending) { this.save(); return false; }
		const settle = (change: Partial<Turn>) => { this.turns = this.turns.map((t) => (t.id === turn.id ? { ...t, ...change, pending: false } : t)); this.save(); };
		void (async () => {
			try {
				const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q, history }) });
				const b = await r.json().catch(() => ({}));
				if (!r.ok || !Array.isArray(b.segments)) return settle({ error: r.ok ? "failed" : askErrorKind(r.status) });
				const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
				settle({ answer: { segments: b.segments, md: String(b.md ?? ""), cited: ids(b.cited), retained: ids(b.retained), related: ids(b.related), model: b.model } });
			} catch { settle({ error: "network" }); }
		})();
		return true;
	}

	/** Asks a failed question again, in place of its turn. */
	retry(turn: Turn) {
		if (this.pending) return;
		this.turns = this.turns.filter((t) => t.id !== turn.id);
		this.ask(turn.q);
	}

	/** A new conversation; refused while an answer is on its way (it would come back into the new one). */
	clear() {
		if (this.pending) return;
		this.turns = [];
		this.save();
	}
}

export const assistant = new Assistant();
