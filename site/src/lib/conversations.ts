import { api } from "./api";

/** A saved assistant conversation, as `GET /api/conversations` lists it (dates are ISO strings). */
export type ConversationSummary = { id: string; title: string; exchanges: number; created_at: string; updated_at: string };
export type ConversationTurn = { question: string; answer: string; pages?: string[]; at?: string };
export type Conversation = { id: string; title: string; turns: ConversationTurn[]; created_at: string; updated_at: string };

/** Saved conversations, newest first; `q` filters titles and questions. */
export const listConversations = (q = "", signal?: AbortSignal) =>
	api<{ conversations: ConversationSummary[] }>(`/api/conversations${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`, { signal }).then((r) => r.conversations);
export const getConversation = (id: string) => api<Conversation>(`/api/conversations/${encodeURIComponent(id)}`);
export const renameConversation = (id: string, title: string) => api<Conversation>(`/api/conversations/${encodeURIComponent(id)}`, { method: "PUT", body: { title } });
export const removeConversation = (id: string) => api(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });

/**
 * Phase C plugs in here. The account page only calls `resumeConversation` / `exportConversation`; the assistant panel
 * (resume: reopen the conversation in the panel) and the Markdown export (download of the conversation) register their
 * implementation in `conversationActions`. While one is missing its button stays disabled.
 */
export const conversationActions: { resume?: (id: string) => void | Promise<void>; export?: (id: string) => void | Promise<void> } = {};
// phase C: resume a saved conversation in the assistant panel
export const resumeConversation = (id: string) => conversationActions.resume?.(id);
// phase C: export a saved conversation as Markdown
export const exportConversation = (id: string) => conversationActions.export?.(id);
