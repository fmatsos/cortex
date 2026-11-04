import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { search } from "./search";

// FTS5 edge cases of `search` (the quote test is in lib.test.ts, the wiki-before-raw order in add.test.ts).

const page = (title: string, body: string) => `---\ntype: Concept\ntitle: ${title}\ndescription: D.\n---\n${body}\n`;

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  await Bun.write(join(root, "wiki/concepts/a.md"), page("Alpha", "Le mot near et un opérateur NEAR dans le texte."));
  await Bun.write(join(root, "wiki/concepts/b.md"), page("Beta", "Un autre texte sur le near aussi."));
  await Bun.write(join(root, "wiki/concepts/c.md"), page("Gamma", "Rien de commun, sauf le mot near une fois."));
  return root;
}

test("search: FTS5 syntax characters and operators in the query are plain text, never a syntax error", async () => {
  const root = await fixture();
  for (const q of ["*", "(", ")", "near(", "NEAR", "alpha AND", "OR beta", "NOT", "a:b", "^alpha", "-beta", "alp*", '"', "''", "alpha; DROP TABLE docs"])
    expect(Array.isArray(await search(root, q))).toBe(true); // resolves, whatever it finds
  expect((await search(root, "NEAR")).length).toBe(3); // the operator word is just a word (case-insensitive)
  expect((await search(root, "alp*")).length).toBe(0); // no prefix operator: the asterisk is not a wildcard
  expect((await search(root, "alpha AND")).length).toBe(0); // AND is a term, not a conjunction
});

test("search: --limit boundaries", async () => {
  const root = await fixture();
  expect(await search(root, "near", { limit: 0 })).toEqual([]);
  expect(await search(root, "near", { limit: 1 })).toHaveLength(1);
  expect(await search(root, "near", { limit: 3 })).toHaveLength(3);
  expect(await search(root, "near", { limit: 50 })).toHaveLength(3);
  expect(await search(root, "near")).toHaveLength(3); // default limit
});

test("search: an empty wiki gives no hit, in every area", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  expect(await search(root, "rien")).toEqual([]);
  expect(await search(root, "rien", { in: "raw" })).toEqual([]);
  expect(await search(root, "rien", { in: "wiki" })).toEqual([]);
});

test("search: --in raw on a wiki with no raw source finds nothing, even when wiki/ matches", async () => {
  const root = await fixture();
  expect(await search(root, "near", { in: "raw" })).toEqual([]);
  expect((await search(root, "near", { in: "wiki" })).every((h) => h.area === "wiki")).toBe(true);
});
