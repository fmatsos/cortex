import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromResource, pageId, pageLink, pageRoute, rawId, toPage, toRawSource, toResource } from "./doc";
import { renderIndex } from "./catalog";
import { parseDoc, readPages } from "./lib";

const doc = (fm: string) => parseDoc("wiki/concepts/x.md", `---\n${fm}\n---\ncorps\n`);

test("toPage: a conforming page keeps every key, known or not", () => {
  const p = toPage(doc("type: Concept\ntitle: A\ndescription: D.\ntags: [x]\nstatus: draft\ncustom: 1"));
  expect(p.issues).toEqual([]);
  expect(p.fm).toMatchObject({ type: "Concept", title: "A", tags: ["x"], custom: 1 });
});

test("toPage: a non-conforming field is dropped and reported, the page and its other fields stay", () => {
  const p = toPage(doc("type: concept\ntitle: A\nstatus: wip\ntags: x\ndescription: D."));
  expect(p.fm.type).toBeUndefined();
  expect(p.fm.title).toBe("A");
  expect(p.fm.description).toBe("D.");
  expect(p.issues.map((i) => i.field).sort()).toEqual(["status", "tags", "type"]);
  expect(toPage(doc("type: Concept")).issues).toEqual([{ field: "title", msg: "titre manquant" }]);
  expect(toPage(doc("type: Concept\ntitle: 2026")).fm.title).toBe("2026"); // a bare number is its text
});

test("toRawSource: tolerant, passthrough", () => {
  const r = toRawSource(parseDoc("raw/2026/11/a/source.md", "---\ntype: RawSource\nstatus: done\nnote: 42\nauthor: x\n---\nt\n"));
  expect(r.fm.status).toBeUndefined();
  expect(r.fm.note).toBe("42");
  expect(r.fm).toMatchObject({ author: "x" });
});

test("identity conversions", () => {
  expect(rawId("raw/2026/11/01a1/source.md")).toBe("01a1");
  expect(toResource("raw/a/source.md")).toBe("/raw/a/source.md");
  expect(fromResource(" /wiki/x.md")).toBe("wiki/x.md");
  expect(pageLink("wiki/concepts/x.md")).toBe("/wiki/concepts/x.md");
  expect(pageId("wiki/concepts/x.md")).toBe("concepts/x");
  expect(pageRoute("wiki/concepts/x.md")).toBe("wiki/concepts/x/");
});

test("renderIndex: unknown types under « Autres », never « undefined »", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-idx-"));
  const w = (n: string, fm: string) => Bun.write(join(root, `wiki/concepts/${n}.md`), `---\n${fm}\n---\n`);
  await w("ok", "type: Concept\ntitle: Bon\ndescription: D.");
  await w("typo", "type: concept\ntitle: Typo\ndescription: Tapé en minuscules.");
  await w("notype", "title: Sans type\ndescription: D.");
  await w("notitle", "type: Entity\ndescription: Sans titre.");
  await w("nodesc", "type: Concept\ntitle: Sans description");
  const idx = await renderIndex(root);
  expect(idx).not.toContain("undefined");
  expect(idx).toContain("## Concepts\n- [Bon](/wiki/concepts/ok.md) — D.\n- [Sans description](/wiki/concepts/nodesc.md)\n");
  expect(idx).toContain("## Entités\n- [concepts/notitle](/wiki/concepts/notitle.md) — Sans titre.\n");
  expect(idx).toContain("## Autres\n- [Sans type](/wiki/concepts/notype.md) — D.\n- [Typo](/wiki/concepts/typo.md) — Tapé en minuscules.\n");
  expect((await readPages(root)).pages).toHaveLength(5); // nothing dropped
});

test("renderIndex: no « Autres » section on a valid wiki", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-idx-"));
  await Bun.write(join(root, "wiki/concepts/a.md"), "---\ntype: Concept\ntitle: A\ndescription: D.\n---\n");
  expect(await renderIndex(root)).toBe("# Index\n\n## Concepts\n- [A](/wiki/concepts/a.md) — D.\n\n## Entités\n\n## Synthèses\n\n## Sources\n");
});
