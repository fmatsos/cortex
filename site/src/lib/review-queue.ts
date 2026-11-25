import type { PageData } from "./types";

/**
 * Review queue: the pages never reviewed and the pages modified since their review (the `review` feature of cortex.json),
 * and the session memory that lets an article reached from the queue offer the next page. Pure functions (tested by
 * `src/review-queue.test.ts`); the storage is passed in and never throws.
 */

export type Reason = "never" | "modified";
export type ReviewItem = { id: string; title: string; type: string; reason: Reason; at?: string; verifiedAt?: string };

type PageReview = Pick<PageData, "id" | "title" | "type" | "verified" | "generated" | "needsReview">;

/**
 * Pages to review: « to review again » first, then « never reviewed »; inside each group the one that has waited longest
 * first (`generated.at`, the last write of the page), a page with no date last.
 */
export function reviewQueue(pages: PageReview[]): ReviewItem[] {
	const items: ReviewItem[] = [];
	for (const p of pages) {
		const reason: Reason | undefined = !p.verified ? "never" : p.needsReview ? "modified" : undefined;
		if (reason) items.push({ id: p.id, title: p.title, type: p.type, reason, ...(p.generated?.at && { at: p.generated.at }), ...(p.verified && { verifiedAt: p.verified.at }) });
	}
	const t = (i: ReviewItem) => (i.at && !Number.isNaN(Date.parse(i.at)) ? Date.parse(i.at) : Infinity);
	return items.sort((a, b) => (a.reason === b.reason ? 0 : a.reason === "modified" ? -1 : 1) || t(a) - t(b) || a.title.localeCompare(b.title, "fr"));
}

/** An article reached from the queue carries `?queue=review`. */
export const QUEUE_PARAM = "queue";
export const QUEUE_VALUE = "review";
export const inQueue = (sp: URLSearchParams) => sp.get(QUEUE_PARAM) === QUEUE_VALUE;
/** Link to a page from the queue. */
export const queueHref = (href: string) => `${href}?${QUEUE_PARAM}=${QUEUE_VALUE}`;

export type QueueRef = { id: string; title: string };
type Store = Pick<Storage, "getItem" | "setItem">;
const QUEUE_KEY = "cortex:review-queue", DONE_KEY = "cortex:review-done";
const store = (s?: Store): Store | undefined => { try { return s ?? globalThis.sessionStorage; } catch { return undefined; } };
const read = <T>(key: string, s?: Store): T | undefined => { try { const v = store(s)?.getItem(key); return v ? (JSON.parse(v) as T) : undefined; } catch { return undefined; } };
const write = (key: string, value: unknown, s?: Store) => { try { store(s)?.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: no next link, nothing else */ } };

/** The queue as shown by the last visit of /review/ (per tab: sessionStorage). */
export const saveQueue = (queue: QueueRef[], s?: Store) => write(QUEUE_KEY, queue, s);
export const loadQueue = (s?: Store): QueueRef[] => {
	const v = read<unknown>(QUEUE_KEY, s);
	return Array.isArray(v) ? v.filter((x): x is QueueRef => !!x && typeof (x as QueueRef).id === "string" && typeof (x as QueueRef).title === "string") : [];
};
/** Pages validated from this tab: they leave the queue until the rebuilt site carries the review. */
export const loadDone = (s?: Store): Set<string> => {
	const v = read<unknown>(DONE_KEY, s);
	return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
};
export const markDone = (id: string, s?: Store) => write(DONE_KEY, [...loadDone(s).add(id)], s);

/** Place of `id` in the queue and the next page that is not validated yet; undefined when `id` is not in the queue. */
export function position(queue: QueueRef[], id: string, done: Set<string>): { index: number; total: number; next?: QueueRef } | undefined {
	const index = queue.findIndex((q) => q.id === id);
	if (index < 0) return undefined;
	return { index: index + 1, total: queue.length, next: queue.slice(index + 1).find((q) => !done.has(q.id)) };
}
