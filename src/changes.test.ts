import { expect, test } from "bun:test";
import { changesOf, dayOfMs, FIRST_MAX, parseSeen, since, watermark } from "../site/src/lib/changes";
import type { Link, LogEntryData } from "../site/src/lib/types";

const L = (id: string): Link => ({ id, title: id.toUpperCase(), type: "Concept" });
const page = (id: string, at?: string) => ({ id, title: id.toUpperCase(), type: "Concept", ...(at && { generated: { by: "t", at } }) });
const entry = (at: string, kind: string, ids: string[], counts: LogEntryData["counts"] = null): LogEntryData =>
	({ at, kind, html: kind, pages: ids.map(L), sources: [], sourceRefs: [], counts, search: kind });
const T = (iso: string) => Date.parse(iso);

test("changesOf: one entry per page, modified = the later of generated.at and the log, newest first", () => {
	const c = changesOf(
		[page("a", "2026-11-01T10:00:00Z"), page("b", "2026-11-03T10:00:00Z"), page("c")],
		[entry("2026-11-05T08:00:00Z", "update", ["a", "a"]), entry("2026-11-02T08:00:00Z", "lint", ["b"])],
	);
	expect(c.map((x) => [x.id, x.modified])).toEqual([["a", T("2026-11-05T08:00:00Z")], ["b", T("2026-11-03T10:00:00Z")]]); // a lint entry changes nothing, a page with no date is left out
});

test("changesOf: created only when the oldest entry proves it (`N created, 0 updated`), never by a guess", () => {
	const at = "2026-11-04T10:00:00Z";
	const c = changesOf(
		[page("a", at), page("b", at), page("c", at), page("d", at), page("e", at), page("f", at)],
		[
			entry("2026-11-04T09:00:00Z", "ingest", ["a", "b"], { created: 2, updated: 0 }), // both are new
			entry("2026-11-04T09:10:00Z", "ingest", ["c", "d"], { created: 1, updated: 1 }), // mixed: which one is new is not told
			entry("2026-11-04T09:20:00Z", "ingest", ["e"], null), // text typed by hand
			entry("2026-11-01T09:00:00Z", "ingest", ["f"], { created: 0, updated: 1 }), // f already existed...
			entry("2026-11-04T09:30:00Z", "ingest", ["f"], { created: 1, updated: 0 }), // ...a later entry cannot create it
			entry("2026-11-03T09:00:00Z", "add", ["a"]),
			entry("2026-11-05T09:00:00Z", "ingest", ["a"], { created: 0, updated: 1 }), // later compile: a is modified, still created before
		],
	);
	const by = Object.fromEntries(c.map((x) => [x.id, x]));
	expect(by.a!.created).toBe(T("2026-11-04T09:00:00Z"));
	expect(by.a!.modified).toBe(T("2026-11-05T09:00:00Z"));
	expect(by.b!.created).toBe(T("2026-11-04T09:00:00Z"));
	for (const id of ["c", "d", "e", "f"]) expect(by[id]!.created, id).toBeUndefined();
	// an update entry proves nothing either
	expect(changesOf([page("u", at)], [entry("2026-11-02T00:00:00Z", "update", ["u"])])[0]!.created).toBeUndefined();
});

test("changesOf: the export is a window of at most `max` pages", () => {
	const pages = Array.from({ length: 5 }, (_, i) => page(`p${i}`, `2026-11-0${i + 1}T00:00:00Z`));
	expect(changesOf(pages, [], 2).map((x) => x.id)).toEqual(["p4", "p3"]);
});

test("since: pages created or modified after the reference point, created wins when it is after it, newest first", () => {
	const list = changesOf(
		[page("a", "2026-11-06T00:00:00Z"), page("b", "2026-11-07T00:00:00Z"), page("c", "2026-11-04T00:00:00Z")],
		[entry("2026-11-06T00:00:00Z", "ingest", ["a"], { created: 1, updated: 0 }), entry("2026-11-01T00:00:00Z", "ingest", ["b"], { created: 1, updated: 0 })],
	);
	const seen = T("2026-11-05T00:00:00Z");
	const { items, recent } = since(list, seen);
	expect(recent).toBe(false);
	expect(items.map((i) => [i.id, i.kind, i.at])).toEqual([["b", "modified", T("2026-11-07T00:00:00Z")], ["a", "created", T("2026-11-06T00:00:00Z")]]);
	// the point is the newest date seen: nothing is new after marking, a later change shows alone
	const w = watermark(list)!;
	expect(since(list, w).items).toEqual([]);
	const later = changesOf([page("a", "2026-11-06T00:00:00Z"), page("d", "2026-11-09T00:00:00Z")], []);
	expect(since(later, w).items.map((i) => i.id)).toEqual(["d"]);
});

test("since: first visit shows the last 14 days of activity (from the newest change, not from today), at most FIRST_MAX", () => {
	const pages = [page("old", "2025-01-01T00:00:00Z"), page("mid", "2026-11-10T00:00:00Z"), page("new", "2026-11-20T00:00:00Z")];
	const { items, recent } = since(changesOf(pages, []), undefined);
	expect(recent).toBe(true);
	expect(items.map((i) => i.id)).toEqual(["new", "mid"]); // a stale wiki still shows its latest activity
	const many = Array.from({ length: FIRST_MAX + 5 }, (_, i) => page(`p${i}`, `2026-11-20T00:00:${String(i).padStart(2, "0")}Z`));
	expect(since(changesOf(many, []), undefined).items).toHaveLength(FIRST_MAX);
	// a page created long before the window but modified inside it is a modification
	const log = [entry("2026-01-01T00:00:00Z", "ingest", ["x"], { created: 1, updated: 0 })];
	expect(since(changesOf([page("x", "2026-11-20T00:00:00Z"), page("y", "2026-11-19T00:00:00Z")], log), undefined).items.find((i) => i.id === "x")!.kind).toBe("modified");
	expect(since([], undefined).items).toEqual([]);
});

test("parseSeen reads back what was stored, nothing from a damaged value; dayOfMs is UTC", () => {
	expect(parseSeen("1793836800000")).toBe(1793836800000);
	for (const v of [null, undefined, "", " ", "abc", "-5", "0", "NaN"]) expect(parseSeen(v)).toBeUndefined();
	expect(dayOfMs(T("2026-11-05T23:30:00Z"))).toBe("2026-11-05");
});
