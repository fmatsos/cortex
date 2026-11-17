import { storageKey } from "./storage";

/** Longest question the server accepts (src/serve.ts MAX_QUESTION): checked before sending. */
export const MAX_QUESTION = 500;

export type AskAnswer = { q: string; html: string; cited: string[]; model?: string };
export type AskErrorKind = "busy" | "off" | "invalid" | "failed" | "network";
export type AskError = { q: string; kind: AskErrorKind };

/** HTTP status of POST /api/ask → what the visitor is told (and whether a retry makes sense). */
export const askErrorKind = (status: number): AskErrorKind =>
	status === 429 ? "busy" : status === 404 ? "off" : status === 400 ? "invalid" : "failed";

const KEY = storageKey("ask");

/**
 * Natural-language questions to the wiki's agent (`cortex serve` with site_ask), shared by the palette and /search/:
 * the request outlives the page that sent it, so following a cited page and coming back finds the answer again, and
 * the palette knows when a question is already being answered. The last answer is kept for the tab (sessionStorage).
 */
class AskState {
	/** The server answers questions (HEAD probe): a static host has no /api/. */
	api = $state(false);
	/** The question being answered. */
	pending = $state<string>();
	last = $state<AskAnswer>();
	error = $state<AskError>();
	private probed = false;

	/** Once per page load, in the browser. */
	probe() {
		if (this.probed) return;
		this.probed = true;
		try { this.last = JSON.parse(sessionStorage.getItem(KEY) ?? "null") ?? undefined; } catch { /* storage unavailable */ }
		fetch("/api/ask", { method: "HEAD" }).then((r) => (this.api = r.status === 204), () => {});
	}

	/** Sends a question; false when it is not sent (empty, another one pending, too long: then `error` says why). */
	ask(question: string): boolean {
		const q = question.trim();
		if (!q || this.pending) return false;
		if (q.length > MAX_QUESTION) { this.error = { q, kind: "invalid" }; return false; }
		this.pending = q;
		this.error = undefined;
		void (async () => {
			try {
				const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q }) });
				const b = await r.json().catch(() => ({}));
				if (!r.ok || typeof b.html !== "string") { this.error = { q, kind: r.ok ? "failed" : askErrorKind(r.status) }; return; }
				this.last = { q, html: b.html, cited: Array.isArray(b.cited) ? b.cited : [], model: b.model };
				try { sessionStorage.setItem(KEY, JSON.stringify(this.last)); } catch { /* storage unavailable: kept for this page only */ }
			} catch { this.error = { q, kind: "network" }; }
			finally { this.pending = undefined; }
		})();
		return true;
	}
}

export const asker = new AskState();
