import { expect, test } from "bun:test";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guard } from "./backends/claude";

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cortex-guard-"));
  const outside = mkdtempSync(join(tmpdir(), "cortex-outside-"));
  await Bun.write(join(root, "wiki/concepts/x.md"), "x");
  await Bun.write(join(outside, "secret.txt"), "secret");
  symlinkSync(outside, join(root, "wiki/lien")); // wiki link pointing outside the root
  return { root, outside, ok: (tool: string, input: object) => guard(root, tool, input, "read").allow };
}

test("Read hors du dépôt refusé, dans le dépôt autorisé", async () => {
  const { root, ok } = await fixture();
  expect(ok("Read", { file_path: "/etc/passwd" })).toBe(false);
  expect(ok("Read", { file_path: join(root, "../x") })).toBe(false);
  expect(ok("Read", { file_path: "~/.ssh/id_ed25519" })).toBe(false);
  expect(ok("Read", { file_path: join(root, "wiki/concepts/x.md") })).toBe(true);
  expect(ok("Read", { file_path: "wiki/concepts/x.md" })).toBe(true);
  expect(ok("Read", { file_path: join(root, "wiki/pas-encore.md") })).toBe(true);
});

test("Grep avec path hors du dépôt refusé, sans path autorisé", async () => {
  const { root, ok } = await fixture();
  expect(ok("Grep", { pattern: "root", path: "/etc" })).toBe(false);
  expect(ok("Grep", { pattern: "x", path: join(root, "wiki") })).toBe(true);
  expect(ok("Grep", { pattern: "/etc/passwd" })).toBe(true); // the pattern is a regex, not a path
});

test("lien symbolique du wiki vers l'extérieur refusé", async () => {
  const { root, outside, ok } = await fixture();
  expect(ok("Read", { file_path: join(root, "wiki/lien/secret.txt") })).toBe(false);
  expect(ok("Grep", { pattern: "secret", path: join(root, "wiki/lien") })).toBe(false);
  expect(ok("Glob", { pattern: "*", path: join(root, "wiki/lien") })).toBe(false);
  expect(ok("Read", { file_path: join(outside, "secret.txt") })).toBe(false);
});

test("Glob sans path autorisé, motif sortant refusé", async () => {
  const { ok } = await fixture();
  expect(ok("Glob", { pattern: "wiki/**/*.md" })).toBe(true);
  expect(ok("Glob", { pattern: "/etc/*" })).toBe(false);
  expect(ok("Glob", { pattern: "../**/*" })).toBe(false);
});
