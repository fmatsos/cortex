import { expect, test } from "bun:test";
import { archives, countBy, dayLabel, filterEntries, filterQuery, groupDays, hourOf, isUnfiltered, monthLabel, monthOf, NO_FILTER, readFilter, withIds } from "../site/src/lib/log-view";
import { filterTags, readTagsParams, sortTags, tagsQuery, type Tag } from "../site/src/lib/tags-view";
import { fold } from "../site/src/lib/fold";
import type { LogEntryData } from "../site/src/lib/types";

const entry = (at: string, kind: string, text: string): LogEntryData => ({ at, kind, html: text, pages: [], sources: [], search: fold(`${kind} ${text}`) });
const LOG = [
	entry("2026-11-04T10:00:00+01:00", "ingest", "Créé concepts/context-rot, mis à jour Chroma"),
	entry("2026-11-04T09:00:00+01:00", "add", "Source ajoutée : article sur la fenêtre de contexte"),
	entry("2026-10-30", "lint", "3 orphelins, 1 contradiction"),
	entry("2026-10-12", "query", "Comparaison des agents"),
];

test("withIds : identifiants stables, uniques, indépendants de la position", () => {
	const a = withIds(LOG);
	expect(new Set(a.map((e) => e.id)).size).toBe(a.length);
	expect(a[0].id).toMatch(/^e-20261104-[0-9a-z]{6}$/);
	// ajouter une entrée plus récente en tête ne change aucun identifiant existant
	const b = withIds([entry("2026-11-05", "update", "Correction"), ...LOG]);
	expect(b.slice(1).map((e) => e.id)).toEqual(a.map((e) => e.id));
	// le contenu change l'identifiant ; deux entrées identiques restent distinctes
	expect(withIds([entry("2026-11-04", "add", "x")])[0].id).not.toBe(withIds([entry("2026-11-04", "add", "y")])[0].id);
	const twin = withIds([entry("2026-11-04", "add", "x"), entry("2026-11-04", "add", "x")]);
	expect(twin[0].id).not.toBe(twin[1].id);
	expect(twin[1].id.endsWith("-2")).toBe(true);
});

test("readFilter / filterQuery : aller-retour dans l'URL, valeurs invalides ignorées", () => {
	const f = readFilter(new URLSearchParams("type=ingest&q=%20contexte%20rot&mois=2026-11"));
	expect(f).toEqual({ kind: "ingest", q: "contexte rot", month: "2026-11", day: "" });
	expect(filterQuery(f)).toBe("?type=ingest&q=contexte+rot&mois=2026-11");
	expect(readFilter(new URLSearchParams(filterQuery(f)))).toEqual(f);
	expect(readFilter(new URLSearchParams("type=bogus&mois=nov&jour=hier"))).toEqual(NO_FILTER);
	expect(filterQuery(NO_FILTER)).toBe("");
	// un jour précis remplace le mois
	expect(filterQuery({ ...NO_FILTER, month: "2026-11", day: "2026-11-04" })).toBe("?jour=2026-11-04");
	expect(isUnfiltered({ ...NO_FILTER, q: "  " })).toBe(true);
	expect(isUnfiltered({ ...NO_FILTER, kind: "add" })).toBe(false);
});

test("filterEntries : texte en ET, sans accents ni casse, libellés français inclus", () => {
	const log = withIds(LOG);
	expect(filterEntries(log, { ...NO_FILTER, q: "FENETRE contexte" }).map((e) => e.kind)).toEqual(["add"]);
	expect(filterEntries(log, { ...NO_FILTER, q: "cree chroma" }).map((e) => e.kind)).toEqual(["ingest"]);
	expect(filterEntries(log, { ...NO_FILTER, q: "chroma absent" })).toEqual([]);
	// « Contrôle » et « Compilation » sont les libellés affichés, l'identifiant technique reste « lint » / « ingest »
	expect(filterEntries(log, { ...NO_FILTER, q: "controle" }).map((e) => e.kind)).toEqual(["lint"]);
	expect(filterEntries(log, { ...NO_FILTER, q: "compilation" }).map((e) => e.kind)).toEqual(["ingest"]);
	expect(filterEntries(log, { ...NO_FILTER, q: "" })).toHaveLength(4);
});

test("filterEntries : type, mois et jour se combinent ; `skip` sert aux facettes", () => {
	const log = withIds(LOG);
	expect(filterEntries(log, { ...NO_FILTER, month: "2026-10" })).toHaveLength(2);
	expect(filterEntries(log, { ...NO_FILTER, day: "2026-11-04" })).toHaveLength(2);
	expect(filterEntries(log, { ...NO_FILTER, day: "2026-11-04", kind: "add" })).toHaveLength(1);
	expect(filterEntries(log, { ...NO_FILTER, month: "2026-10", kind: "add" })).toHaveLength(0);
	const f = { ...NO_FILTER, kind: "add", month: "2026-10" };
	expect(filterEntries(log, f, "kind")).toHaveLength(2);
	expect(Object.fromEntries(countBy(filterEntries(log, { ...NO_FILTER, q: "context" }, "kind"), (e) => e.kind))).toEqual({ add: 1, ingest: 1 });
});

test("groupDays, archives et libellés de dates", () => {
	const log = withIds(LOG);
	expect(groupDays(log).map((d) => [d.day, d.entries.length])).toEqual([["2026-11-04", 2], ["2026-10-30", 1], ["2026-10-12", 1]]);
	const a = archives(log);
	expect(a.months).toEqual([{ month: "2026-11", n: 2 }, { month: "2026-10", n: 2 }]);
	expect(a.days.map((d) => d.day)).toEqual(["2026-11-04", "2026-10-30", "2026-10-12"]);
	expect(monthOf(log[0])).toBe("2026-11");
	expect(monthLabel("2026-11")).toBe("novembre 2026");
	expect(dayLabel("2026-11-04")).toBe("mercredi 4 novembre 2026");
	expect(hourOf("2026-11-04T10:05:00+01:00")).toBe("10:05");
	expect(hourOf("2026-11-04")).toBe("");
});

const TAGS: Tag[] = [
	{ tag: "llm", slug: "llm", count: 5 },
	{ tag: "évaluation", slug: "evaluation", count: 2 },
	{ tag: "agents", slug: "agents", count: 5 },
	{ tag: "zèbre", slug: "zebre", count: 1 },
];

test("sortTags : fréquence puis nom, ou alphabétique (accents repliés), sans muter l'entrée", () => {
	const before = TAGS.map((t) => t.tag);
	expect(sortTags(TAGS, "freq").map((t) => t.tag)).toEqual(["agents", "llm", "évaluation", "zèbre"]);
	expect(sortTags(TAGS, "alpha").map((t) => t.tag)).toEqual(["agents", "évaluation", "llm", "zèbre"]);
	expect(TAGS.map((t) => t.tag)).toEqual(before);
});

test("filterTags : sans accents ni casse, # initial ignoré", () => {
	expect(filterTags(TAGS, "EVAL").map((t) => t.tag)).toEqual(["évaluation"]);
	expect(filterTags(TAGS, "#ll").map((t) => t.tag)).toEqual(["llm"]);
	expect(filterTags(TAGS, "  ")).toHaveLength(4);
	expect(filterTags(TAGS, "zzzz")).toEqual([]);
});

test("readTagsParams / tagsQuery : aller-retour, défaut sans paramètre", () => {
	expect(tagsQuery("", "freq")).toBe("");
	expect(tagsQuery(" ll ", "alpha")).toBe("?q=ll&tri=alpha");
	expect(readTagsParams(new URLSearchParams("q=ll&tri=alpha"))).toEqual({ q: "ll", sort: "alpha" });
	expect(readTagsParams(new URLSearchParams("tri=bogus"))).toEqual({ q: "", sort: "freq" });
});
