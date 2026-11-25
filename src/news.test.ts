import { expect, test } from "bun:test";
import { brief, briefs, isPair } from "../site/src/lib/news";
import { withIds } from "../site/src/lib/log-view";
import type { Link, LogEntryData } from "../site/src/lib/types";

const page = (id: string, title = id, type = "Concept"): Link => ({ id, title, type });
const entry = (at: string, kind: string, o: Partial<LogEntryData> = {}): LogEntryData => ({ at, kind, html: kind, pages: [], sources: [], sourceRefs: [], counts: null, search: `${kind} ${at}`, ...o });
const ref = (id: string, p?: Link) => ({ id, ...(p && { page: p }) });
const S1 = ref("s1", page("sources/one", "Source un", "Source"));

test("brief: counts come from the export only, otherwise the distinct pages referenced", () => {
	const pages = [page("sources/one", "Source un", "Source"), page("concepts/a", "A"), page("concepts/b", "B"), page("concepts/c", "C"), page("concepts/a", "A")];
	const [a] = withIds([entry("2026-11-24T08:01:45+00:00", "ingest", { pages, sourceRefs: [S1], counts: { created: 1, updated: 2 } })]);
	const b = brief(a!);
	expect(b).toMatchObject({ kind: "ingest", sources: 1, source: S1.page, counts: { created: 1, updated: 2 }, referenced: 4 }); // a duplicate page counts once
	expect(b.pages.map((p) => p.id)).toEqual(["concepts/a", "concepts/b"]); // the Source page is the sentence's, not a link of the list
	expect(b.more).toBe(1);
	const [c] = withIds([entry("2026-11-23", "ingest", { pages: [page("concepts/a")] })]);
	expect(brief(c!)).toMatchObject({ counts: null, referenced: 1, sources: 0, more: 0 });
	expect("source" in brief(c!)).toBe(false);
});

test("briefs: an add then an ingest of the same source the same day is one brief, nothing else is merged", () => {
	const log = withIds([
		entry("2026-11-24T08:01:45+00:00", "ingest", { sourceRefs: [S1], counts: { created: 1, updated: 0 }, pages: [page("sources/one", "Source un", "Source")] }),
		entry("2026-11-24T07:13:28+00:00", "add", { sourceRefs: [S1] }),
		// same title, another source id: never merged on the title alone
		entry("2026-11-23T13:01:07+00:00", "ingest", { sourceRefs: [ref("s2", page("sources/two", "Source un", "Source"))] }),
		entry("2026-11-23T12:11:50+00:00", "add", { sourceRefs: [ref("s3", page("sources/three", "Source un", "Source"))] }),
		// same source, other day
		entry("2026-11-22T00:30:00+00:00", "ingest", { sourceRefs: [ref("s4")] }),
		entry("2026-11-21T23:30:00+00:00", "add", { sourceRefs: [ref("s4")] }),
		// an add after an ingest (the log says the ingest came first): not the story « added, then compiled »
		entry("2026-11-20T11:00:00+00:00", "add", { sourceRefs: [ref("s5")] }),
		entry("2026-11-20T09:30:00+00:00", "ingest", { sourceRefs: [ref("s5")] }),
	]);
	expect(briefs(log, 3).map((b) => [b.kind, b.id === log[0]!.id])).toEqual([["addIngest", true], ["ingest", false], ["add", false]]);
	expect(briefs(log, 8).map((b) => b.kind)).toEqual(["addIngest", "ingest", "add", "ingest", "add", "add", "ingest"]);
	expect(isPair(log[2]!, log[3]!)).toBe(false);
	expect(isPair(log[0]!, log[1]!)).toBe(true);
	expect(isPair(log[6]!, log[7]!)).toBe(false);
	expect(briefs([], 3)).toEqual([]);
});

test("briefs: an entry without any source is never paired (empty sets do not match)", () => {
	const log = withIds([entry("2026-11-24T08:00:00+00:00", "ingest"), entry("2026-11-24T07:00:00+00:00", "add")]);
	expect(briefs(log, 3).map((b) => b.kind)).toEqual(["ingest", "add"]);
});

test("brief: a page or a source titled « ! » is content, kept as is", () => {
	const bang = ref("s1", page("sources/bang", "!", "Source"));
	const [e] = withIds([entry("2026-11-23T12:11:50+00:00", "add", { sourceRefs: [bang] })]);
	expect(brief(e!).source?.title).toBe("!");
});
