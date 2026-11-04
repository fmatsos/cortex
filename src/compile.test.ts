import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markCompiled, resolveRawId } from "./agent";
import type { Doc } from "./lib";

function setup(content: string) {
  const root = mkdtempSync(join(tmpdir(), "cortex-compile-"));
  mkdirSync(join(root, "raw/2026/11/a"), { recursive: true });
  const path = "raw/2026/11/a/source.md";
  writeFileSync(join(root, path), content);
  return { root, path, read: () => readFileSync(join(root, path), "utf8") };
}

describe("markCompiled", () => {
  test("CRLF file flips and stays CRLF", async () => {
    const t = setup("---\r\ntype: RawSource\r\nstatus: pending\r\n---\r\nbody\r\n");
    await markCompiled(t.root, t.path);
    expect(t.read()).toBe("---\r\ntype: RawSource\r\nstatus: compiled\r\n---\r\nbody\r\n");
  });
  test("quoted status flips", async () => {
    const t = setup('---\ntype: RawSource\nstatus: "pending"\n---\nbody\n');
    await markCompiled(t.root, t.path);
    expect(t.read()).toBe("---\ntype: RawSource\nstatus: compiled\n---\nbody\n");
  });
  test("no status line throws and leaves the file byte-identical", async () => {
    const src = "---\ntype: RawSource\n---\nbody\n";
    const t = setup(src);
    await expect(markCompiled(t.root, t.path)).rejects.toThrow("statut pending introuvable");
    expect(t.read()).toBe(src);
  });
  test("a body line `status: pending` is left untouched", async () => {
    const src = "---\ntype: RawSource\n---\nstatus: pending\n";
    const t = setup(src);
    await expect(markCompiled(t.root, t.path)).rejects.toThrow();
    expect(t.read()).toBe(src);
    const t2 = setup("---\nstatus: pending\n---\nstatus: pending\n");
    await markCompiled(t2.root, t2.path);
    expect(t2.read()).toBe("---\nstatus: compiled\n---\nstatus: pending\n");
  });
});

describe("resolveRawId", () => {
  const docs: Doc[] = ["01aa-x", "01ab-y", "02cc-z", "02cc-zz"].map((id) => ({ path: `raw/2026/11/${id}/source.md`, fm: {}, body: "" }));
  test("exact id wins even when it prefixes another", () => {
    expect(resolveRawId(docs, "02cc-z").path).toContain("/02cc-z/");
  });
  test("unique prefix", () => {
    expect(resolveRawId(docs, "01aa").path).toContain("/01aa-x/");
  });
  test("ambiguous prefix lists candidates", () => {
    expect(() => resolveRawId(docs, "01a")).toThrow("id ambigu : 01aa-x, 01ab-y");
  });
  test("unknown id", () => {
    expect(() => resolveRawId(docs, "nope")).toThrow("Source introuvable : nope");
  });
  test("substring that is not a prefix no longer matches", () => {
    expect(() => resolveRawId(docs, "cc-z")).toThrow("Source introuvable");
  });
});
