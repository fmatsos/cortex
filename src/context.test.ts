import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openWiki } from "./context";

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;

/** Wiki exercising every section of index.md and log.md (a source cited by a Source page, a page of an unknown type, a journal). */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cortex-ctx-"));
  const w = (p: string, t: string) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), t); };
  w("cortex.json", "{}");
  w(`raw/2026/11/${id(1)}/source.md`, "---\ntype: RawSource\ntitle: R1\nnote: n\nstatus: compiled\n---\ntexte\n");
  w(`wiki/concepts/${id(2)}.md`, "---\ntype: Concept\ntitle: Zeta\ndescription: Un concept.\n---\nCorps.\n");
  w(`wiki/concepts/${id(3)}.md`, `---\ntype: Concept\ntitle: Alpha\ndescription: Autre.\n---\nVoir [Zeta](/wiki/concepts/${id(2)}.md).\n`);
  w(`wiki/entities/${id(4)}.md`, "---\ntype: Entity\ntitle: Bob\ndescription: Une entité.\n---\nx\n");
  w(`wiki/sources/${id(5)}.md`, `---\ntype: Source\ntitle: Source un\ndescription: Résumé.\nsources:\n  - id: r1\n    resource: /raw/2026/11/${id(1)}/source.md\n---\nx[^r1]\n`);
  w(`wiki/concepts/${id(6)}.md`, "---\ntype: Weird\ntitle: Autre type\n---\nx\n");
  w("wiki/log.jsonl",
    `${JSON.stringify({ at: "2026-11-04T10:00:00+01:00", kind: "add", text: `\`${id(1)}\`.`, sources: [id(1)] })}\n` +
    `${JSON.stringify({ at: "2026-11-04T11:00:00+01:00", kind: "ingest", text: "créé Zeta.", sources: [id(1)], pages: [`wiki/concepts/${id(2)}.md`, `wiki/sources/${id(5)}.md`] })}\n`);
  return root;
}

test("openWiki: each loader runs once and returns the same value", async () => {
  const w = openWiki(fixture());
  expect(w.errors).toEqual({ pages: [], raws: [] });
  const [a, b] = await Promise.all([w.pages(), w.pages()]); // concurrent callers share one read
  expect(b).toBe(a);
  expect(await w.pages()).toBe(a);
  expect(await w.raws()).toBe(await w.raws());
  expect(await w.config()).toBe(await w.config());
  expect(await w.naming()).toBe(await w.naming());
  expect(w.journal()).toBe(w.journal());
  expect(await w.titles()).toBe(await w.titles());
  expect(await w.citations()).toBe(await w.citations());
  expect(a).toHaveLength(5);
  expect((await w.raws())).toHaveLength(1);
});

test("openWiki: a read is a snapshot (a file written afterwards is not seen)", async () => {
  const root = fixture();
  const w = openWiki(root);
  expect(await w.pages()).toHaveLength(5);
  writeFileSync(join(root, `wiki/concepts/${id(9)}.md`), "---\ntype: Concept\ntitle: Neuf\n---\n");
  expect(await w.pages()).toHaveLength(5);
  expect(await openWiki(root).pages()).toHaveLength(6);
});

test("openWiki: titles, citations, naming; a broken cortex.json only fails what needs the config", async () => {
  const root = fixture();
  const w = openWiki(root);
  expect((await w.titles()).get(`wiki/concepts/${id(2)}.md`)).toBe("Zeta");
  const cited = (await w.citations()).get(`/raw/2026/11/${id(1)}/source.md`);
  expect(cited?.map((p) => p.path)).toEqual([`wiki/sources/${id(5)}.md`]);
  expect(await w.naming()).toEqual({ raw_path: "{yyyy}/{mm}/{uuid}", page_path: "{type}/{uuid}" });
  writeFileSync(join(root, "cortex.json"), "{ nope");
  const bad = openWiki(root);
  expect(await bad.pages()).toHaveLength(5);
  await expect(bad.config()).rejects.toThrow("cortex.json");
});

test("openWiki: unparseable pages go to errors, not to pages", async () => {
  const root = fixture();
  writeFileSync(join(root, "wiki/concepts/bad.md"), "---\ntype: [oops\n---\nx\n");
  const w = openWiki(root);
  expect(await w.pages()).toHaveLength(5);
  expect(w.errors.pages.map((e) => e.path)).toEqual(["wiki/concepts/bad.md"]);
});

test("cortex index on a fixture writes the same index.md and log.md as before the context", () => {
  const root = fixture();
  const r = Bun.spawnSync(["bun", join(import.meta.dir, "cortex.ts"), "index"], { env: { ...process.env, CORTEX_ROOT: root } });
  expect(r.exitCode).toBe(0);
  const read = (p: string) => Bun.file(join(root, p)).text();
  return Promise.all([read("wiki/index.md"), read("wiki/log.md")]).then(([index, log]) => {
    expect(index).toBe(`# Index

## Concepts
- [Alpha](/wiki/concepts/${id(3)}.md) — Autre.
- [Zeta](/wiki/concepts/${id(2)}.md) — Un concept.

## Entités
- [Bob](/wiki/entities/${id(4)}.md) — Une entité.

## Synthèses

## Sources
- [Source un](/wiki/sources/${id(5)}.md) — Résumé.

## Autres
- [Autre type](/wiki/concepts/${id(6)}.md)
`);
    expect(log).toBe(`# Log

> Généré depuis \`wiki/log.jsonl\` : ne pas éditer à la main (\`cortex log add\`, puis \`cortex index\`).

## 2026-11-04
- **Ingest** créé Zeta. (sources : \`${id(1)}\` ; pages : [Source un](/wiki/sources/${id(5)}.md))
- **Add** \`${id(1)}\`.
`);
  });
});
