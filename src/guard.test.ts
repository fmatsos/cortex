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

test("guard: writes limited to wiki/, Bash limited to cortex", async () => {
  const { guard } = await import("./backends/claude");
  const { symlinkSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  await Bun.write(join(root, "wiki/concepts/x.md"), "");
  symlinkSync("cortex.json", join(root, "CLAUDE.md"));
  symlinkSync("../cortex.json", join(root, "wiki/piege.md")); // link that leaves wiki/
  const ok = (tool: string, input: object, mode: "read" | "write" = "write") => guard(root, tool, input, mode).allow;
  expect(ok("Write", { file_path: join(root, "wiki/concepts/nouveau.md") })).toBe(true);
  expect(ok("Edit", { file_path: "wiki/concepts/x.md" })).toBe(true);
  expect(ok("Write", { file_path: join(root, "wiki/sous/dossier/neuf.md") })).toBe(true);
  expect(ok("Edit", { file_path: join(root, "raw/2026/11/a/source.md") })).toBe(false);
  expect(ok("Edit", { file_path: join(root, "wiki/../cortex.json") })).toBe(false);
  expect(ok("Edit", { file_path: join(root, "CLAUDE.md") })).toBe(false);
  expect(ok("Edit", { file_path: join(root, "wiki/piege.md") })).toBe(false);
  expect(ok("Write", { file_path: join(root, "wiki/x.md") }, "read")).toBe(false);
  expect(ok("Bash", { command: "cortex search context rot" }, "read")).toBe(true);
  expect(ok("Bash", { command: "cortex index" }, "read")).toBe(false);
  expect(ok("Bash", { command: "cortex index" })).toBe(true);
  expect(ok("Bash", { command: "cortex new Concept \"Context rot\"" })).toBe(true);
  expect(ok("Bash", { command: "cortex new Concept \"Context rot\"" }, "read")).toBe(false);
  // journal: reading allowed everywhere, writing (cortex log add) only in write mode; the quoted text may contain ; | > &
  expect(ok("Bash", { command: "cortex log --limit 5 --kind lint --json" }, "read")).toBe(true);
  expect(ok("Bash", { command: "cortex log add update \"x\"" }, "read")).toBe(false);
  expect(ok("Bash", { command: "cortex log add update \"CLI : a ; b | c > d & l'idée\" --page wiki/concepts/x.md --source 01a1a5c9-5e80-7075-ae13-aab03b0a8697" })).toBe(true);
  expect(ok("Bash", { command: "cortex log add ingest 'texte avec `backticks` et $HOME' --source 01a1a5c9-5e80-7075-ae13-aab03b0a8697" })).toBe(true); // single quotes: literal
  expect(ok("Bash", { command: "cortex log add update \"x $(rm -rf wiki)\"" })).toBe(false); // expansion under double quotes
  expect(ok("Bash", { command: "cortex log add update \"x `id`\"" })).toBe(false);
  expect(ok("Bash", { command: "cortex log add update \"x\" ; rm -rf wiki" })).toBe(false); // chaining
  expect(ok("Bash", { command: "cortex log add update \"x\" && cortex index" })).toBe(false);
  // escaped quote outside quotes: the shell sees a literal character, not a string — what follows would run
  expect(ok("Bash", { command: "cortex search \\'; touch /tmp/pwn; \\'" })).toBe(false);
  expect(ok("Bash", { command: 'cortex search \\"; touch /tmp/pwn; \\"' })).toBe(false);
  expect(ok("Bash", { command: "cortex search a\\ b" })).toBe(false);
  expect(ok("Bash", { command: "cortex log add update \"x" })).toBe(false); // unclosed quote
  expect(ok("Bash", { command: "cortex log add update x > wiki/log.jsonl" })).toBe(false);
  expect(ok("Bash", { command: "cortex log add update \"x\"\nrm -rf wiki" })).toBe(false);
  expect(ok("Bash", { command: "cortex logs add" })).toBe(false);
  expect(ok("Bash", { command: "cortex log --json add update \"x\"" }, "read")).toBe(false); // `add` hidden behind an option
  expect(ok("Bash", { command: "cortex log --json add update \"x\"" })).toBe(false);
  expect(ok("Bash", { command: "cortex search x; sed -i s/a/b/ raw/x.md" })).toBe(false);
  expect(ok("Bash", { command: "echo x > raw/a.md" })).toBe(false);
  expect(ok("Read", { file_path: "/etc/passwd" }, "read")).toBe(false); // reads are confined to the root (REL-07)
  expect(ok("WebFetch", { url: "https://x" })).toBe(false);
});
