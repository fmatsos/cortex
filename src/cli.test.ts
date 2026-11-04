import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLog } from "./log";

const root = mkdtempSync(join(tmpdir(), "cortex-cli-"));
await Bun.write(join(root, "cortex.json"), "{}");
await Bun.write(join(root, "wiki/log.jsonl"), "");
const run = (...a: string[]) => {
  const p = Bun.spawnSync(["bun", join(import.meta.dir, "cortex.ts"), ...a], { env: { ...process.env, CORTEX_ROOT: root, NO_COLOR: "1" } });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};
const oneLine = (err: string) => { expect(err.trim().split("\n")).toHaveLength(1); expect(err).not.toMatch(/\bat \S+ \(|\bat \//); };

test("option inconnue ou valeur manquante : exit 2, une ligne française, pas de stack trace", () => {
  for (const a of [["--bogus"], ["add", "--notes", "x"], ["search", "x", "-z"]]) {
    const r = run(...a);
    expect(r.code).toBe(2);
    expect(r.err).toContain("option inconnue");
    expect(r.err).toContain("cortex --help");
    oneLine(r.err);
  }
  const r = run("add", "--note");
  expect(r.code).toBe(2);
  expect(r.err).toContain("--note");
  oneLine(r.err);
});

test("--limit invalide : erreur d'usage (search et log)", () => {
  for (const a of [["search", "x", "--limit", "abc"], ["search", "x", "--limit", "0"], ["log", "--limit", "abc"], ["log", "--limit=-1"]]) {
    const r = run(...a);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--limit attend un entier");
    oneLine(r.err);
  }
  expect(run("log", "--limit", "5").code).toBe(0);
});

test("arité incorrecte : même code que les autres erreurs d'usage", () => {
  expect(run("new", "Concept").code).toBe(2);
  expect(run("new").code).toBe(2);
  expect(run("add").code).toBe(2);
  expect(run("search").code).toBe(2);
});

test("`cortex search log add` ne déclenche pas log add", () => {
  const before = readLog(root).entries.length;
  const r = run("search", "log", "add", "update", "x");
  expect(r.code).toBe(0);
  expect(readLog(root).entries).toHaveLength(before);
  const ok = run("log", "add", "update", "vrai");
  expect(ok.code).toBe(0);
  expect(readLog(root).entries).toHaveLength(before + 1);
  const viaOption = run("--json", "log", "add", "update", "avec option avant");
  expect(viaOption.code).toBe(0);
  expect(readLog(root).entries).toHaveLength(before + 2);
});
