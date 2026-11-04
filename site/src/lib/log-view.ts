import { fold } from "./fold";
import { kindLabel, KINDS } from "./type-meta";
import type { LogEntryData } from "./types";

/**
 * Client-side log: stable identifiers, filters synchronized in the URL, local search, archives by period.
 * Pure functions (tested by `src/log-view.test.ts`), with no DOM access.
 */

/** A log entry with its anchor identifier and its search text (French label included). */
export type LogEntry = LogEntryData & { id: string; hay: string };

/** 32-bit FNV-1a, in base 36 over 6 characters. */
const hash = (s: string): string => {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return ((h >>> 0) % 36 ** 6).toString(36).padStart(6, "0");
};

/**
 * Stable anchor identifier: the entry's date and a fingerprint of its content, hence independent of its position
 * (adding more recent entries changes no link). Two identical entries get an order suffix.
 */
export function withIds(entries: LogEntryData[]): LogEntry[] {
	const seen = new Map<string, number>();
	return entries.map((e) => {
		const base = `e-${e.at.slice(0, 10).replaceAll("-", "")}-${hash(`${e.at}|${e.kind}|${e.search}`)}`;
		const n = (seen.get(base) ?? 0) + 1;
		seen.set(base, n);
		return { ...e, id: n > 1 ? `${base}-${n}` : base, hay: `${fold(kindLabel(e.kind))} ${e.search}` };
	});
}

export type LogFilter = { kind: string; q: string; month: string; day: string };
export const NO_FILTER: LogFilter = { kind: "", q: "", month: "", day: "" };
export const isUnfiltered = (f: LogFilter) => !f.kind && !f.q.trim() && !f.month && !f.day;

/** Reads the filters from the URL: `type`, `q`, `mois` (YYYY-MM), `jour` (YYYY-MM-DD). An unknown or malformed value is ignored. */
export function readFilter(sp: URLSearchParams): LogFilter {
	const kind = sp.get("type") ?? "", month = sp.get("mois") ?? "", day = sp.get("jour") ?? "";
	return {
		kind: KINDS.some((k) => k.kind === kind) ? kind : "",
		q: (sp.get("q") ?? "").trim(),
		month: /^\d{4}-\d\d$/.test(month) ? month : "",
		day: /^\d{4}-\d\d-\d\d$/.test(day) ? day : "",
	};
}

/** Canonical query string of a filter (`""` if no filter). A specific day makes the month redundant. */
export function filterQuery(f: LogFilter): string {
	const sp = new URLSearchParams();
	if (f.kind) sp.set("type", f.kind);
	if (f.q.trim()) sp.set("q", f.q.trim());
	if (f.day) sp.set("jour", f.day);
	else if (f.month) sp.set("mois", f.month);
	const s = sp.toString();
	return s && `?${s}`;
}

/** The entries that pass the filters. `skip` ignores one criterion: used for per-facet counts (type, month…). */
export function filterEntries(entries: LogEntry[], f: LogFilter, skip?: keyof LogFilter): LogEntry[] {
	const words = skip === "q" ? [] : fold(f.q).split(/\s+/).filter(Boolean);
	return entries.filter(
		(e) =>
			(skip === "kind" || !f.kind || e.kind === f.kind) &&
			(skip === "month" || !f.month || e.at.startsWith(f.month)) &&
			(skip === "day" || !f.day || e.at.startsWith(f.day)) &&
			words.every((w) => e.hay.includes(w)),
	);
}

/** Count per key, in order of appearance. */
export function countBy(entries: LogEntry[], key: (e: LogEntry) => string): Map<string, number> {
	const m = new Map<string, number>();
	for (const e of entries) m.set(key(e), (m.get(key(e)) ?? 0) + 1);
	return m;
}
export const monthOf = (e: { at: string }) => e.at.slice(0, 7);
export const dayOf = (e: { at: string }) => e.at.slice(0, 10);

/** Entries (most recent first) grouped by day: a day = a contiguous run. */
export function groupDays<T extends { at: string }>(entries: T[]): { day: string; entries: T[] }[] {
	const out: { day: string; entries: T[] }[] = [];
	for (const e of entries) {
		const day = dayOf(e);
		if (out.at(-1)?.day === day) out.at(-1)!.entries.push(e);
		else out.push({ day, entries: [e] });
	}
	return out;
}

/** Months present (most recent first) with their entry count, and days present. */
export function archives(entries: LogEntry[]) {
	const months = [...countBy(entries, monthOf)].map(([month, n]) => ({ month, n })).sort((a, b) => b.month.localeCompare(a.month));
	const days = [...countBy(entries, dayOf)].map(([day, n]) => ({ day, n })).sort((a, b) => b.day.localeCompare(a.day));
	return { months, days };
}

// UTC: the date written in the log, without offset depending on the reader's time zone
const longDay = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" });
const monthName = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
export const dayLabel = (day: string) => longDay.format(new Date(`${day}T00:00:00Z`));
export const dayShort = (day: string) => shortDay.format(new Date(`${day}T00:00:00Z`));
export const monthLabel = (month: string) => monthName.format(new Date(`${month}-01T00:00:00Z`));
/** Time of an entry (`HH:MM`), or `""` when the log only records the date. */
export const hourOf = (at: string) => (at.length > 10 ? at.slice(11, 16) : "");
