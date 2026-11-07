import { expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderIndex } from "./catalog";
import { isReservedPage, parseDoc, readDocs, serializeDoc } from "./lib";
import { lint } from "./lint";
import { search } from "./search";

const GOOD = "wiki/concepts/good.md", BAD = "wiki/concepts/bad.md";

function wikiWithBadPage() {
  const root = mkdtempSync(join(tmpdir(), "cortex-tol-"));
  writeFileSync(join(root, "cortex.json"), "{}");
  mkdirSync(join(root, "wiki/concepts"), { recursive: true });
  writeFileSync(join(root, GOOD), "---\ntype: Concept\ntitle: Bonne page\ndescription: D.\n---\nlicorne\n");
  writeFileSync(join(root, BAD), "---\ntype: [oops\n---\nlicorne\n");
  return root;
}

test("readDocs returns the valid pages and reports the invalid one", async () => {
  const { docs, errors } = await readDocs(wikiWithBadPage(), "wiki");
  expect(docs.map((d) => d.path)).toEqual([GOOD]);
  expect(errors).toHaveLength(1);
  expect(errors[0]!.path).toBe(BAD);
  expect(errors[0]!.msg).toBeTruthy();
});

test("index: the invalid page is skipped with a warning, the valid one is listed", async () => {
  const warn = spyOn(console, "error").mockImplementation(() => {});
  try {
    const idx = await renderIndex(wikiWithBadPage());
    expect(idx).toContain("[Bonne page](/wiki/concepts/good.md)");
    expect(warn.mock.calls.flat().join("\n")).toContain(BAD);
  } finally { warn.mockRestore(); }
});

test("search: the valid page is still found, the invalid one warned about", async () => {
  const warn = spyOn(console, "error").mockImplementation(() => {});
  try {
    const hits = await search(wikiWithBadPage(), "licorne");
    expect(hits.map((h) => h.path)).toEqual([GOOD]);
    expect(warn.mock.calls.flat().join("\n")).toContain(BAD);
  } finally { warn.mockRestore(); }
});

test("lint: the invalid page is an error, the valid one is still checked", async () => {
  const issues = await lint(wikiWithBadPage());
  expect(issues.find((i) => i.path === BAD)).toMatchObject({ level: "error" });
  expect(issues.find((i) => i.path === BAD)!.msg).toContain("invalid YAML");
  expect(issues.some((i) => i.path === GOOD && i.msg.includes("orphan"))).toBe(true);
});

test("isReservedPage: wiki/index.md and wiki/log.md only", () => {
  expect(isReservedPage("wiki/index.md")).toBe(true);
  expect(isReservedPage("wiki/log.md")).toBe(true);
  expect(isReservedPage("wiki/concepts/index.md")).toBe(false);
  expect(isReservedPage("wiki/log.jsonl")).toBe(false);
  expect(isReservedPage("raw/index.md")).toBe(false);
});

test("serializeDoc: byte-identical to the previous inline format, and parseDoc round-trips it", () => {
  const fm = { type: "Concept", title: "A: b", status: "draft" };
  expect(serializeDoc(fm, "")).toBe(`---\n${Bun.YAML.stringify(fm, null, 2)}\n---\n`);
  expect(serializeDoc(fm, "Corps\n")).toBe(`---\n${Bun.YAML.stringify(fm, null, 2)}\n---\nCorps\n`);
  expect(parseDoc("p.md", serializeDoc(fm, "Corps\n"))).toEqual({ path: "p.md", fm, body: "Corps\n" });
});
