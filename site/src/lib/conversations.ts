import { api } from "./api";
import { spaceApi } from "./space";

/** Saved conversations belong to a space: the calls go under its prefix (`spaceApi`; no prefix on a site of one space). A saved assistant conversation, as `GET /api/conversations` lists it (dates are ISO strings). */
export type ConversationSummary = { id: string; title: string; exchanges: number; created_at: string; updated_at: string };
export type ConversationTurn = { question: string; answer: string; pages?: string[]; at?: string };
export type Conversation = { id: string; title: string; turns: ConversationTurn[]; created_at: string; updated_at: string };

/** Saved conversations, newest first; `q` filters titles and questions. */
export const listConversations = (q = "", signal?: AbortSignal) =>
	api<{ conversations: ConversationSummary[] }>(spaceApi(`/api/conversations${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`), { signal }).then((r) => r.conversations);
export const getConversation = (id: string) => api<Conversation>(spaceApi(`/api/conversations/${encodeURIComponent(id)}`));
export const renameConversation = (id: string, title: string) => api<Conversation>(spaceApi(`/api/conversations/${encodeURIComponent(id)}`), { method: "PUT", body: { title } });
export const removeConversation = (id: string) => api(spaceApi(`/api/conversations/${encodeURIComponent(id)}`), { method: "DELETE" });

/** The first save of a conversation of the assistant (title: the visitor's, else the server takes the first question). */
export const createConversation = (title: string | undefined, turns: ConversationTurn[]) => api<Conversation>(spaceApi("/api/conversations"), { method: "POST", body: { title, turns } });
/** Replaces the exchanges of a saved conversation (the next question of a resumed one, or the ones added since the last save). */
export const updateConversation = (id: string, turns: ConversationTurn[]) => api<Conversation>(spaceApi(`/api/conversations/${encodeURIComponent(id)}`), { method: "PUT", body: { turns } });

/**
 * What the account page can do with a saved conversation. The assistant (assistant-session.ts, `registerConversationActions`)
 * provides both: resume opens it in the panel, export downloads it as Markdown. The page only calls `resumeConversation` /
 * `exportConversation`; until they are registered (the first render of the layout) the buttons stay inactive.
 */
export const conversationActions: { resume?: (id: string) => void | Promise<void>; export?: (id: string) => void | Promise<void> } = {};
export const resumeConversation = (id: string) => conversationActions.resume?.(id);
export const exportConversation = (id: string) => conversationActions.export?.(id);
