import { fold } from "./fold";
import { kindLabel, KINDS } from "./type-meta";
import type { LogEntryData } from "./types";

/**
 * Journal côté client : identifiants stables, filtres synchronisés dans l'URL, recherche locale, archives par période.
 * Fonctions pures (testées par `cli/src/log-view.test.ts`), sans accès au DOM.
 */

/** Une entrée du journal avec son identifiant d'ancre et son texte de recherche (libellé français compris). */
export type LogEntry = LogEntryData & { id: string; hay: string };

/** FNV-1a 32 bits, en base 36 sur 6 caractères. */
const hash = (s: string): string => {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return ((h >>> 0) % 36 ** 6).toString(36).padStart(6, "0");
};

/**
 * Identifiant d'ancre stable : la date de l'entrée et une empreinte de son contenu, donc indépendant de sa position
 * (ajouter des entrées plus récentes ne change aucun lien). Deux entrées identiques reçoivent un suffixe d'ordre.
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

/** Lit les filtres dans l'URL : `type`, `q`, `mois` (AAAA-MM), `jour` (AAAA-MM-JJ). Une valeur inconnue ou mal formée est ignorée. */
export function readFilter(sp: URLSearchParams): LogFilter {
	const kind = sp.get("type") ?? "", month = sp.get("mois") ?? "", day = sp.get("jour") ?? "";
	return {
		kind: KINDS.some((k) => k.kind === kind) ? kind : "",
		q: (sp.get("q") ?? "").trim(),
		month: /^\d{4}-\d\d$/.test(month) ? month : "",
		day: /^\d{4}-\d\d-\d\d$/.test(day) ? day : "",
	};
}

/** Chaîne de requête canonique d'un filtre (`""` si aucun filtre). Un jour précis rend le mois superflu. */
export function filterQuery(f: LogFilter): string {
	const sp = new URLSearchParams();
	if (f.kind) sp.set("type", f.kind);
	if (f.q.trim()) sp.set("q", f.q.trim());
	if (f.day) sp.set("jour", f.day);
	else if (f.month) sp.set("mois", f.month);
	const s = sp.toString();
	return s && `?${s}`;
}

/** Les entrées qui passent les filtres. `skip` ignore un critère : sert aux décomptes par facette (type, mois…). */
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

/** Décompte par clé, dans l'ordre d'apparition. */
export function countBy(entries: LogEntry[], key: (e: LogEntry) => string): Map<string, number> {
	const m = new Map<string, number>();
	for (const e of entries) m.set(key(e), (m.get(key(e)) ?? 0) + 1);
	return m;
}
export const monthOf = (e: { at: string }) => e.at.slice(0, 7);
export const dayOf = (e: { at: string }) => e.at.slice(0, 10);

/** Entrées (plus récente d'abord) regroupées par jour : un jour = une série contiguë. */
export function groupDays<T extends { at: string }>(entries: T[]): { day: string; entries: T[] }[] {
	const out: { day: string; entries: T[] }[] = [];
	for (const e of entries) {
		const day = dayOf(e);
		if (out.at(-1)?.day === day) out.at(-1)!.entries.push(e);
		else out.push({ day, entries: [e] });
	}
	return out;
}

/** Mois présents (plus récent d'abord) avec leur nombre d'entrées, et jours présents. */
export function archives(entries: LogEntry[]) {
	const months = [...countBy(entries, monthOf)].map(([month, n]) => ({ month, n })).sort((a, b) => b.month.localeCompare(a.month));
	const days = [...countBy(entries, dayOf)].map(([day, n]) => ({ day, n })).sort((a, b) => b.day.localeCompare(a.day));
	return { months, days };
}

// UTC : la date écrite dans le journal, sans décalage selon le fuseau du lecteur
const longDay = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" });
const monthName = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
export const dayLabel = (day: string) => longDay.format(new Date(`${day}T00:00:00Z`));
export const dayShort = (day: string) => shortDay.format(new Date(`${day}T00:00:00Z`));
export const monthLabel = (month: string) => monthName.format(new Date(`${month}-01T00:00:00Z`));
/** Heure d'une entrée (`HH:MM`), ou `""` quand le journal ne note que la date. */
export const hourOf = (at: string) => (at.length > 10 ? at.slice(11, 16) : "");
