import { account } from "#lib/account.svelte.js";
import { assistant } from "#lib/assistant.svelte.js";
import { exportCurrent, fetchResumable, saveConversation } from "#lib/assistant-session.js";
import { ApiError } from "#lib/api.js";
import { t } from "#lib/i18n/index.js";

type Message = { kind: "ok" | "error"; text: string };
type Resumable = Awaited<ReturnType<typeof fetchResumable>>;

/**
 * What the buttons of the panel's header do, and the dialogs they open: save, export, new conversation, resume. The state
 * of the conversation itself is the assistant's; this one only holds what is on screen about it (the dialogs that are open,
 * the short message that says what just happened). `then` is what runs once a save has gone through, and only then: a
 * conversation is never replaced (new, resumed) unless its save succeeded when the visitor asked for that.
 */
export class AssistantFlow {
	message = $state<Message | null>(null);
	saveOpen = $state(false);
	signInOpen = $state(false);
	newOpen = $state(false);
	resumeOpen = $state(false);
	busy = $state(false);
	/** The saved conversation waiting for the visitor's answer (the current one is not saved). */
	waiting = $state<Resumable | null>(null);
	private then: (() => void) | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private refocus = false;
	private seq = 0;

	/** `focusInput`: gives the focus back to the question field. */
	constructor(private focusInput: () => void) {}

	say(kind: Message["kind"], text: string) {
		clearTimeout(this.timer);
		this.message = { kind, text };
		if (kind === "ok") this.timer = setTimeout(() => (this.message = null), 5000);
	}
	dismiss() { clearTimeout(this.timer); this.message = null; }

	/** A dialog closed: the focus goes back to the question when what it led to wanted that (a new or a resumed conversation). */
	closed() { if (this.refocus) { this.refocus = false; this.focusInput(); } }

	/** The name dialog was left without saving: what was to follow the save does not happen. */
	cancelSave() { this.then = undefined; }

	// ---- save ----------------------------------------------------------------------------------------------------------

	/** The Save button: sign in first when there is no session; the first save asks for a name, the next ones go straight through. */
	save() {
		if (!account.me) { if (account.methods.length) this.signInOpen = true; return; }
		if (assistant.canSave) this.saveThen();
	}

	/** Saves, then runs `then` (and only then). */
	saveThen(then?: () => void) {
		this.then = then;
		if (assistant.saved) void this.update();
		else this.saveOpen = true;
	}

	private async update() {
		if (this.busy) return;
		this.busy = true;
		try {
			const r = await saveConversation();
			this.say("ok", t(`assistant.message.${r}`));
			const then = this.then;
			this.then = undefined;
			then?.();
		} catch { this.say("error", t("assistant.save.failed")); } finally { this.busy = false; }
	}

	/** The name dialog: throws when the server refuses (the dialog stays open and says so). */
	async submitName(title: string) {
		await saveConversation(title);
		this.say("ok", t("assistant.message.created"));
		const then = this.then;
		this.then = undefined;
		then?.();
	}

	// ---- export --------------------------------------------------------------------------------------------------------

	async export(): Promise<boolean> {
		if (!assistant.canSave) return false;
		try { await exportCurrent(); this.say("ok", t("assistant.message.exported")); return true; } catch { this.say("error", t("assistant.export.failed")); return false; }
	}

	// ---- new conversation ----------------------------------------------------------------------------------------------

	/** Starts over at once when nothing would be lost; otherwise asks first (what is lost: not saved, or no account to save to). */
	startNew() {
		if (assistant.complete.length && (assistant.dirty || !account.me)) this.newOpen = true;
		else this.reset();
	}
	reset() {
		this.refocus = true;
		assistant.clear();
		this.dismiss();
		this.focusInput();
	}
	saveAndReset() { this.saveThen(() => this.reset()); }
	async exportAndReset() { if (await this.export()) this.reset(); }

	// ---- resume --------------------------------------------------------------------------------------------------------

	/** A conversation of the account page: read, and replaces the current one (asking first when this one is not saved). */
	async resume(id: string) {
		const mine = ++this.seq;
		if (assistant.pending) { assistant.setOpen(true); this.say("error", t("assistant.resume.busy")); return; }
		let r: Resumable;
		try { r = await fetchResumable(id); } catch (e) {
			if (mine !== this.seq) return;
			if (e instanceof ApiError && e.status === 401) account.expire();
			assistant.setOpen(true);
			this.say("error", t("assistant.resume.failed"));
			return;
		}
		if (mine !== this.seq) return;
		if (assistant.pending) { assistant.setOpen(true); this.say("error", t("assistant.resume.busy")); return; }
		if (assistant.dirty) { this.waiting = r; this.resumeOpen = true; } else this.apply(r);
	}
	apply(r: Resumable | null = this.waiting) {
		if (!r) return;
		this.refocus = true;
		assistant.load(r.conversation, r.drawn);
		this.waiting = null;
		this.say("ok", t("assistant.message.resumed", { title: r.conversation.title }));
	}
	saveAndResume() { this.saveThen(() => this.apply()); }
}
