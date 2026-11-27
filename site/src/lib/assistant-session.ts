import { ApiError } from "./api";
import { spaceApi } from "./space";
import { assistant, keysOf, type Segment, type SavedTurn, type Turn } from "./assistant.svelte";
import { conversationActions, createConversation, getConversation, updateConversation, type Conversation } from "./conversations";
import { conversationFilename, conversationMarkdown, normalizeTitle } from "./conversation-markdown";
import { download, siteUrl } from "./export-file";
import { loadEngine } from "./search-client";
import { account } from "./account.svelte";

// The conversation of the assistant and the account: save it, resume a saved one, export it as Markdown. The state is the
// assistant's (assistant.svelte.ts); this module talks to the API and to the browser's download.

/** The answered exchanges as the account keeps them: the Markdown as written, the pages cited (judge first), the date. */
export const toSavedTurns = (turns: Turn[]): SavedTurn[] =>
	turns.flatMap((t) => {
		if (!t.answer) return [];
		const pages = [...new Set([...t.answer.retained, ...t.answer.related, ...t.answer.cited])];
		return [{ question: t.q, answer: t.answer.md, ...(pages.length ? { pages } : {}), ...(t.at ? { at: t.at } : {}) }];
	});

/** What a conversation is called until its owner names it: the first question, on one line. */
export const defaultTitle = (turns: Turn[] = assistant.complete) => normalizeTitle(turns[0]?.q ?? "");

export type SaveResult = "created" | "updated" | "same";

/**
 * Saves the answered exchanges: creates the copy the first time (`title` is the owner's), updates it afterwards, and does
 * nothing when it already holds them. Throws on failure; a conversation replaced meanwhile (new, resumed) is left alone.
 */
export async function saveConversation(title?: string): Promise<SaveResult> {
	const gen = assistant.generation, before = assistant.saved, turns = assistant.complete, keys = keysOf(turns);
	if (before && before.keys === keys) return "same";
	const payload = toSavedTurns(turns);
	let saved: Conversation, result: SaveResult = before ? "updated" : "created";
	try {
		if (before) saved = await updateConversation(before.id, payload);
		else saved = await createConversation(title?.trim() || undefined, payload);
	} catch (e) {
		if (e instanceof ApiError && e.status === 401) account.expire();
		// the copy was deleted elsewhere (the account page of another tab): the conversation is saved again, under its name
		if (!(e instanceof ApiError && e.status === 404 && before)) throw e;
		saved = await createConversation(before.title || undefined, payload);
		result = "created";
	}
	if (assistant.generation === gen) assistant.markSaved({ id: saved.id, title: saved.title, keys, created_at: saved.created_at });
	return result;
}

// ---- export -----------------------------------------------------------------------------------------------------------

/** Page titles for the Sources list; without the index (a failure to load it) the ids stand in. */
async function pageTitles(): Promise<(id: string) => string | undefined> {
	try { const docs = (await loadEngine()).docs; const by = new Map(docs.map((d) => [d.id, d.title])); return (id) => by.get(id); } catch { return () => undefined; }
}

/** Downloads the conversation on screen (its answered exchanges) as Markdown. */
export async function exportCurrent() {
	const turns = assistant.complete;
	if (!turns.length) return;
	const title = assistant.saved?.title || defaultTitle(turns);
	const text = conversationMarkdown({ title, turns: toSavedTurns(turns), site: siteUrl(), pageTitle: await pageTitles(), created: assistant.saved?.created_at || undefined });
	download(conversationFilename(title), text);
}

/** Downloads a saved conversation as Markdown (from the account page). Throws when it cannot be read. */
export async function exportSaved(id: string) {
	const c = await getConversation(id);
	download(conversationFilename(c.title), conversationMarkdown({ title: c.title, turns: c.turns, site: siteUrl(), pageTitle: await pageTitles(), created: c.created_at, updated: c.updated_at }));
}

// ---- resume -----------------------------------------------------------------------------------------------------------

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** The saved answers drawn again by the server (POST /api/ask/render); where it cannot, the Markdown as plain text: nothing is lost. */
async function drawAll(mds: string[]): Promise<Segment[][]> {
	const plain = (md: string): Segment[] => [{ html: `<p class="whitespace-pre-wrap">${escape(md)}</p>` }];
	try {
		const res = await fetch(spaceApi("/api/ask/render"), { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers: mds }) });
		const body = (await res.json().catch(() => ({}))) as { answers?: { segments?: Segment[] }[] };
		if (!res.ok || !Array.isArray(body.answers) || body.answers.length !== mds.length) return mds.map(plain);
		return body.answers.map((a, i) => (Array.isArray(a?.segments) ? a.segments : plain(mds[i]!)));
	} catch { return mds.map(plain); }
}

/** Reads a saved conversation and draws its answers: ready for `assistant.load`. Throws when it cannot be read. */
export async function fetchResumable(id: string) {
	const c = await getConversation(id);
	return { conversation: c, drawn: await drawAll(c.turns.map((t) => t.answer)) };
}

/** The hooks the account page calls (conversations.ts); once, from the layout. */
export function registerConversationActions() {
	conversationActions.resume = (id) => { assistant.resumeRequest = id; };
	conversationActions.export = exportSaved;
}
