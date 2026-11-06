import { expect, test } from "bun:test";
import { components, findBridges } from "./bridges";
import type { Page } from "./doc";
import type { QueueEntry } from "./queue";

const path = (t: string, ty = "Concept") => `wiki/${ty === "Entity" ? "entities" : "concepts"}/${t.toLowerCase()}.md`;
const link = (t: string) => `[${t}](/${path(t)})`;
/** A page `title` that links `to` (titles). */
const P = (title: string, to: string[] = [], type = "Concept") => ({ path: path(title, type), fm: { type, title }, body: to.map(link).join(" "), issues: [] }) as unknown as Page;
const open = (...pages: string[]): QueueEntry => ({ at: "2026-11-01", kind: "synthesis", title: "t", reason: "r", pages, sources: [], status: "open" });

// group A: a - b - c (b is the hub), group B: x - y - z (y is the hub, linked from both sides), a lone page and a small pair
const WIKI = [P("A", ["B"]), P("B", ["C"]), P("C"), P("X", ["Y"]), P("Y"), P("Z", ["Y"]), P("Lone"), P("S1", ["S2"]), P("S2")];

test("components: undirected links, hub = highest degree, Source pages join nothing", () => {
  const c = components([...WIKI, P("Src", ["A", "X"], "Source")]);
  expect(c.map((x) => [x.title, x.pages.length])).toEqual([["B", 3], ["Lone", 1], ["S1", 2], ["Y", 3]]);
  expect(c[0]!.hub).toBe("wiki/concepts/b.md");
  // a link between the groups merges them
  expect(components([...WIKI, P("Link", ["A", "Z"])]).map((x) => x.pages.length).sort()).toEqual([1, 2, 7]);
});

test("findBridges: two groups of 3 touched → a bridge, hubs first, titled by the hubs", () => {
  const before = components(WIKI);
  const [b, ...rest] = findBridges(before, ["wiki/concepts/a.md", "wiki/concepts/x.md", "wiki/entities/new.md"], []);
  expect(rest).toEqual([]);
  expect(b!.title).toBe("Synthèse : B / Y");
  expect(b!.pages).toEqual(["wiki/concepts/b.md", "wiki/concepts/y.md", "wiki/concepts/a.md", "wiki/concepts/x.md", "wiki/entities/new.md"]);
  expect(b!.reason).toContain("3 et 3 pages");
});

test("findBridges: no bridge when one group only, a group too small, or a page of no group", () => {
  const before = components(WIKI);
  expect(findBridges(before, ["wiki/concepts/a.md", "wiki/concepts/c.md"], [])).toEqual([]);
  expect(findBridges(before, ["wiki/concepts/a.md", "wiki/concepts/s1.md"], [])).toEqual([]);
  expect(findBridges(before, ["wiki/concepts/a.md", "wiki/concepts/lone.md", "wiki/entities/new.md"], [])).toEqual([]);
});

test("findBridges: an open entry that links both groups is not duplicated, one for another pair is", () => {
  const before = components([...WIKI, P("M1", ["M2"]), P("M2", ["M3"]), P("M3")]);
  const touched = ["wiki/concepts/a.md", "wiki/concepts/x.md", "wiki/concepts/m1.md"];
  expect(findBridges(before, touched, []).map((b) => b.title)).toEqual(["Synthèse : B / M2", "Synthèse : B / Y", "Synthèse : M2 / Y"]);
  // the entry of the pair (B, Y): any of the pages of both groups counts
  expect(findBridges(before, touched, [open("wiki/concepts/c.md", "wiki/concepts/z.md")]).map((b) => b.title)).toEqual(["Synthèse : B / M2", "Synthèse : M2 / Y"]);
  // a page of the pair is not enough
  expect(findBridges(before, touched, [open("wiki/concepts/c.md")])).toHaveLength(3);
  // the pages of a bridge are those of its two groups (and of no group worth a bridge), not of the third
  expect(findBridges(before, touched, [])[0]!.pages).toEqual(["wiki/concepts/b.md", "wiki/concepts/m2.md", "wiki/concepts/a.md", "wiki/concepts/m1.md"]);
});
