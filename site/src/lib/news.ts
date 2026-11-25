import type { LogEntry } from "./log-view";
import type { Link } from "./types";

/**
 * Home page « wiki news »: the latest log entries as short briefs, built from structured data only (never the log HTML,
 * whose links are relative to /log). Pure functions (tested by `src/export.test.ts`), with no DOM access.
 */

export type BriefKind = "add" | "ingest" | "addIngest" | "update" | "lint" | "query";
export type Brief = {
	id: string; // anchor of the entry in /log (the latest one of a merged pair)
	at: string; // of the latest entry
	kind: BriefKind; // addIngest: a source added, then compiled
	sources: number; // raw ids of the entry
	source?: Link; // the Source page, when the entry has exactly one source and the wiki has a page for it
	counts: { created: number; updated: number } | null; // never inferred: null unless the export read them from the automatic text
	referenced: number; // distinct pages the entry references, Source pages included
	pages: Link[]; // the first pages to show, without the Source page already named by the sentence
	more: number; // pages not shown
	text?: string; // plain text of update, lint and query entries
};

const SHOWN = 2;
const same = <T>(a: Set<T>, b: Set<T>) => a.size > 0 && a.size === b.size && [...a].every((x) => b.has(x));
const refIds = (e: LogEntry) => new Set(e.sourceRefs.map((s) => s.id));

/** Consecutive add then ingest of the same sources on the same day: one story. Never on a title or a time proximity alone. */
export const isPair = (newer: LogEntry, older: LogEntry) =>
	newer.kind === "ingest" && older.kind === "add" && newer.at.slice(0, 10) === older.at.slice(0, 10) && same(refIds(newer), refIds(older));

/** One brief from one entry, or from an add then ingest pair (`newer` = the ingest). */
export function brief(newer: LogEntry, older?: LogEntry): Brief {
	const e = newer;
	const refs = e.sourceRefs;
	const sourcePages = new Set(refs.flatMap((s) => (s.page ? [s.page.id] : [])));
	const all = [...new Map(e.pages.map((p) => [p.id, p])).values()];
	const pool = all.filter((p) => !sourcePages.has(p.id));
	return {
		id: e.id, at: e.at,
		kind: older ? "addIngest" : (e.kind as BriefKind),
		sources: refs.length,
		...(refs.length === 1 && refs[0]!.page && { source: refs[0]!.page }),
		counts: e.counts,
		referenced: all.length,
		pages: pool.slice(0, SHOWN),
		more: Math.max(0, pool.length - SHOWN),
		...(e.text && { text: e.text }),
	};
}

/** The `max` latest briefs of the entries (most recent first). */
export function briefs(entries: LogEntry[], max: number): Brief[] {
	const out: Brief[] = [];
	for (let i = 0; i < entries.length && out.length < max; i++) {
		const paired = i + 1 < entries.length && isPair(entries[i]!, entries[i + 1]!);
		out.push(brief(entries[i]!, paired ? entries[i + 1] : undefined));
		if (paired) i++;
	}
	return out;
}
