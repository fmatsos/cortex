import { intlLocale } from "./i18n/index";
import type { LogEntryData, PageData } from "./types";

/**
 * « What changed since my last visit »: one deduplicated entry per page, built from what the export already publishes
 * (`generated.at` of each page and the pages cited by the compile and update entries of the log), and a local reference
 * point. Pure functions (tested by `src/changes.test.ts`), with no DOM access.
 *
 * The reference point is a watermark in the data (the newest change date the visitor has seen), never the clock of the
 * browser: a wiki that has not changed for months stays « up to date », and an export taken today needs no clock agreement.
 */

/** One page with its dates (epoch ms of the ISO texts of the export). `created` is only set when the log proves it (see `changesOf`). */
export type Change = { id: string; title: string; type: string; modified: number; created?: number };
/** What the list shows: the page, how it changed since the reference point and when. */
export type Shown = { id: string; title: string; type: string; kind: "created" | "modified"; at: number };

type PageDates = Pick<PageData, "id" | "title" | "type" | "generated">;
const ms = (iso?: string) => { const t = iso ? Date.parse(iso) : NaN; return Number.isNaN(t) ? undefined : t; };

/** Hard cap on what the export ships to the browser (newest first): the list is a window, not an archive. */
export const MAX_CHANGES = 300;

/**
 * Pages with a known date, newest change first.
 * - modified = the later of `generated.at` (last write of the page) and the newest compile or update entry that cites it
 *   (the pages of a compile entry are the pages it touched);
 * - created = the date of the oldest compile or update entry that cites the page, only when that entry proves the page was
 *   created: its automatic text says `N created, 0 updated` (every page it cites is then new). A mixed entry, a text typed by
 *   hand (`counts` null) or an update entry proves nothing: the page is reported as modified, never as created by a guess.
 *   Add, lint and query entries change no page.
 */
export function changesOf(pages: PageDates[], log: LogEntryData[], max = MAX_CHANGES): Change[] {
	const first = new Map<string, { at: number; proves: boolean }>(), last = new Map<string, number>();
	for (const e of log) {
		const at = ms(e.at);
		if (at === undefined || (e.kind !== "ingest" && e.kind !== "update")) continue;
		const proves = e.kind === "ingest" && e.counts !== null && e.counts.created > 0 && e.counts.updated === 0;
		for (const p of e.pages) {
			last.set(p.id, Math.max(last.get(p.id) ?? at, at));
			const f = first.get(p.id);
			if (!f || at < f.at) first.set(p.id, { at, proves });
		}
	}
	const out: Change[] = [];
	for (const p of pages) {
		const modified = Math.max(ms(p.generated?.at) ?? -Infinity, last.get(p.id) ?? -Infinity);
		if (modified === -Infinity) continue;
		const f = first.get(p.id), created = f?.proves ? f.at : undefined;
		out.push({ id: p.id, title: p.title, type: p.type, modified: Math.max(modified, created ?? -Infinity), ...(created !== undefined && { created }) });
	}
	return out.sort((a, b) => b.modified - a.modified || a.title.localeCompare(b.title, "fr")).slice(0, max);
}

/** First visit: the changes of the last 14 days of the wiki's activity (counted back from its newest change), at most 30. */
export const FIRST_DAYS = 14;
export const FIRST_MAX = 30;

/** The newest change date: what « Mark as seen » remembers. */
export const watermark = (list: Change[]): number | undefined => list.reduce<number | undefined>((m, c) => (m === undefined || c.modified > m ? c.modified : m), undefined);

/**
 * The list to show, newest first. With a reference point: the pages created or modified after it (`created` wins when
 * the page was created after it). Without one (first visit, or storage unavailable): the recent window.
 */
export function since(list: Change[], seen: number | undefined, windowDays = FIRST_DAYS, windowMax = FIRST_MAX): { items: Shown[]; recent: boolean } {
	const newest = watermark(list);
	const recent = seen === undefined;
	const from = recent ? (newest === undefined ? 0 : newest - windowDays * 864e5) : seen;
	const items: Shown[] = [];
	for (const c of list) {
		if (recent ? c.modified < from : c.modified <= from) continue;
		const kind = c.created !== undefined && (recent ? c.created >= from : c.created > from) ? "created" : "modified";
		items.push({ id: c.id, title: c.title, type: c.type, kind, at: kind === "created" ? c.created! : c.modified });
	}
	items.sort((a, b) => b.at - a.at || a.title.localeCompare(b.title, "fr"));
	return { items: recent ? items.slice(0, windowMax) : items, recent };
}

/** The reference point as stored: a single number of epoch ms, or nothing if absent or damaged. */
export const parseSeen = (raw: string | null | undefined): number | undefined => {
	const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
	return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** `YYYY-MM-DD` of an instant, UTC (the date written in the log: no shift depending on the reader's time zone). */
export const dayOfMs = (t: number) => new Date(t).toISOString().slice(0, 10);
/** « 4 novembre 2026 » from `YYYY-MM-DD` (UTC), in the language in force. */
export const longDay = (day: string) => new Intl.DateTimeFormat(intlLocale(), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
