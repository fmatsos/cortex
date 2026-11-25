import { expect, test } from "bun:test";

test("graph: collision-free label selection, fast at 2,000 candidates", async () => {
  const { placeLabels } = await import("../site/src/lib/graph-labels");
  type T = { id: string; x: number; y: number; force?: boolean };
  const it = (id: string, x: number, y: number, force = false): T => ({ id, x, y, force });
  const rect = (t: T) => ({ x: t.x, y: t.y, w: 80, h: 16, force: t.force });
  const ids = (a: T[]) => a.map((t) => t.id);
  // priority: the first wins, the overlapping one is dropped, the distant neighbor is kept
  expect(ids(placeLabels([it("a", 0, 0), it("b", 40, 5), it("c", 200, 0)], rect, 10))).toEqual(["a", "c"]);
  expect(ids(placeLabels([it("a", 0, 0), it("c", 200, 0), it("d", 400, 0)], rect, 2))).toEqual(["a", "c"]); // cap
  expect(ids(placeLabels([it("a", 0, 0), it("f", 20, 0, true)], rect, 10))).toEqual(["a", "f"]); // `force` always kept
  expect(ids(placeLabels([it("a", 0, 0), it("b", 0, 40), it("h", -999, 0)], (t) => (t.id === "h" ? null : rect(t)), 10))).toEqual(["a", "b"]); // off-screen dropped
  expect(ids(placeLabels([it("a", -250, -40), it("b", -190, -30)], rect, 10))).toEqual(["a"]); // grid with negative coordinates: overlap detected
  // 2,000 nodes on a screen: no overlap, cap respected, a few milliseconds
  const many = Array.from({ length: 2000 }, (_, i) => it(`n${i}`, (i * 37) % 1200, (i * 91) % 700));
  const t0 = performance.now();
  const kept = placeLabels(many, rect, 65);
  expect(performance.now() - t0).toBeLessThan(20);
  expect(kept.length).toBeLessThanOrEqual(65);
  for (const a of kept) for (const b of kept) if (a !== b) expect(a.x < b.x + 80 && b.x < a.x + 80 && a.y < b.y + 16 && b.y < a.y + 16).toBe(false);
});
