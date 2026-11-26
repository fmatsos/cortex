import { expect, test } from "bun:test";
import { compactAnswer, coreOf, historyPart, pagesPart } from "./ask-site";
import type { Page } from "./doc";

const page = (path: string, body = "corps"): Page => ({ path, fm: { type: "Concept", title: path }, body, issues: [] }) as unknown as Page;

test("coreOf: retained at the upper bar, related in the grey zone, reading budget past the first page, stable order", () => {
  const judged = [
    { page: page("wiki/c.md", "x".repeat(30)), relevance: 0.6 },
    { page: page("wiki/b.md", "x".repeat(30)), relevance: 0.9 },
    { page: page("wiki/a.md", "x".repeat(30)), relevance: 0.6 },
    { page: page("wiki/d.md"), relevance: 0.4 },
    { page: page("wiki/e.md"), relevance: 0.1 },
  ];
  const core = coreOf(judged, { retained: 0.5, related: 0.3 }, 70);
  expect(core.retained.map((r) => r.path)).toEqual(["wiki/b.md", "wiki/a.md", "wiki/c.md"]); // ties by path
  expect(core.related.map((r) => r.path)).toEqual(["wiki/d.md"]);
  expect(core.documents.map((r) => r.path)).toEqual(["wiki/b.md", "wiki/a.md"]); // the third is past the budget
  expect(core.unread.map((r) => r.path)).toEqual(["wiki/c.md"]);
  // a first page longer than the budget is still given
  expect(coreOf([{ page: page("wiki/long.md", "x".repeat(500)), relevance: 1 }], { retained: 0.5, related: 0.3 }, 10).documents).toHaveLength(1);
});

test("pagesPart: retained pages in full, none judged relevant, or the search hits without a judge", () => {
  const core = coreOf([{ page: page("wiki/a.md", "Texte A"), relevance: 0.8 }, { page: page("wiki/d.md"), relevance: 0.4 }], { retained: 0.5, related: 0.3 });
  const part = pagesPart(core, []);
  expect(part).toContain("### /wiki/a.md « wiki/a.md » (relevance 0.8)\n\nTexte A");
  expect(part).toContain("Related, less certain");
  expect(pagesPart(coreOf([], { retained: 0.5, related: 0.3 }), [])).toContain("judged none of the pages");
  const onlyRelated = pagesPart(coreOf([{ page: page("wiki/d.md"), relevance: 0.4 }], { retained: 0.5, related: 0.3 }), []);
  expect(onlyRelated).not.toContain("given in full");
  expect(onlyRelated).toContain("no page of the wiki certain to answer");
  expect(pagesPart(undefined, ["/wiki/x.md « X »"])).toContain("best first: /wiki/x.md « X »");
});

test("history: a long earlier answer is cut, saying so, and keeps the pages it cited", () => {
  const md = `Voir [A](/wiki/a.md).${"x".repeat(100)} et [B](/wiki/b.md).`;
  const cut = compactAnswer(md, 30);
  expect(cut).toContain("left out of the history");
  expect(cut).toContain("[Pages cited in this answer: /wiki/a.md, /wiki/b.md]");
  expect(historyPart([], 10)).toBe("");
  expect(historyPart([{ role: "user", text: "Q1" }, { role: "assistant", text: "R1" }], 10)).toContain("User: Q1\n\nAssistant: R1");
});

test("history: the last N exchanges (2N messages) are kept, the older ones left out", () => {
  const turns = [1, 2, 3, 4].flatMap((i) => [{ role: "user" as const, text: `Q${i}` }, { role: "assistant" as const, text: `R${i}` }]);
  const part = historyPart(turns, 2);
  expect(part).not.toContain("Q2");
  expect(part).not.toContain("R2");
  expect(part).toContain("User: Q3\n\nAssistant: R3\n\nUser: Q4\n\nAssistant: R4");
  expect(historyPart(turns, 4)).toContain("Q1");
});
