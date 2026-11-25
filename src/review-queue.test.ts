import { expect, test } from "bun:test";
import { inQueue, loadDone, loadQueue, markDone, position, queueHref, reviewQueue, saveQueue } from "../site/src/lib/review-queue";

const p = (id: string, o: { verified?: string; generated?: string; needsReview?: boolean } = {}) => ({
	id, title: id.toUpperCase(), type: "Concept", needsReview: !!o.needsReview,
	...(o.verified && { verified: { by: "me", at: o.verified } }), ...(o.generated && { generated: { by: "ai", at: o.generated } }),
});
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

test("reviewQueue: modified-since-review first, then never reviewed, longest wait first, up-to-date pages out", () => {
	const q = reviewQueue([
		p("fresh", { verified: "2026-11-02", generated: "2026-11-01" }),
		p("never-new", { generated: "2026-11-05T10:00:00Z" }),
		p("never-old", { generated: "2026-10-01T10:00:00Z" }),
		p("never-undated"),
		p("again", { verified: "2026-10-15", generated: "2026-11-03", needsReview: true }),
	]);
	expect(q.map((i) => [i.id, i.reason])).toEqual([["again", "modified"], ["never-old", "never"], ["never-new", "never"], ["never-undated", "never"]]);
	expect(q[0]).toMatchObject({ at: "2026-11-03", verifiedAt: "2026-10-15" });
	expect(reviewQueue([])).toEqual([]);
});

test("the queue parameter: only `queue=review` marks an article as reached from the queue", () => {
	expect(inQueue(new URLSearchParams("queue=review"))).toBe(true);
	for (const s of ["", "queue=other", "q=review"]) expect(inQueue(new URLSearchParams(s))).toBe(false);
	expect(queueHref("/wiki/a/")).toBe("/wiki/a/?queue=review");
});

test("session memory: the queue and the validated pages survive a round trip, damaged storage gives nothing", () => {
	const s = memory();
	expect(loadQueue(s)).toEqual([]);
	saveQueue([{ id: "a", title: "A" }, { id: "b", title: "B" }], s);
	expect(loadQueue(s)).toEqual([{ id: "a", title: "A" }, { id: "b", title: "B" }]);
	markDone("a", s); markDone("a", s); markDone("b", s);
	expect([...loadDone(s)]).toEqual(["a", "b"]);
	s.m.set("cortex:review-queue", "not json");
	s.m.set("cortex:review-done", '{"x":1}');
	expect(loadQueue(s)).toEqual([]);
	expect(loadDone(s).size).toBe(0);
	s.m.set("cortex:review-queue", '[{"id":"a"},{"id":"b","title":"B"},3]');
	expect(loadQueue(s)).toEqual([{ id: "b", title: "B" }]);
	const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); } };
	expect(loadQueue(broken)).toEqual([]);
	expect(() => saveQueue([], broken)).not.toThrow();
});

test("position: place in the queue and the next page not validated yet", () => {
	const q = ["a", "b", "c", "d"].map((id) => ({ id, title: id.toUpperCase() }));
	expect(position(q, "a", new Set())).toEqual({ index: 1, total: 4, next: q[1] });
	expect(position(q, "a", new Set(["b"]))!.next).toEqual(q[2]);
	expect(position(q, "d", new Set())).toEqual({ index: 4, total: 4, next: undefined });
	expect(position(q, "c", new Set(["d"]))!.next).toBeUndefined();
	expect(position(q, "zzz", new Set())).toBeUndefined();
});
