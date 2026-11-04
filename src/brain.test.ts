import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { add } from "./add";
import { renderIndex } from "./index";
import { localIso, normUrl, randomId4, slugify } from "./lib";
import { ftsQuery, search } from "./search";

test("utilitaires", () => {
  expect(localIso(new Date())).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
  for (let i = 0; i < 200; i++) expect(randomId4()).toMatch(/^[a-z0-9]{4}$/);
  expect(slugify("Le C++26 refusé à l'ISO : une première")).toBe("le-c-26-refuse-a-l-iso-une-premiere");
  expect(normUrl("https://X.com/a/?utm_source=z&hl=en#f")).toBe(normUrl("https://x.com/a?hl=en"));
  expect(ftsQuery(`l'IA "spec"`)).toBe(`"l'IA" """spec"""`);
});

test("add → index → search, idempotent", async () => {
  const root = mkdtempSync(join(tmpdir(), "brain-"));
  await Bun.write(join(root, "BRAIN.md"), "");
  await Bun.write(join(root, "wiki/log.md"), "# Log\n\n## 2000-01-01\n- ancien\n");
  await Bun.write(join(root, "wiki/concepts/x.md"), "---\ntype: Concept\ntitle: Relecture\ndescription: D.\n---\nCorps sur la relecture.\n");
  const note = join(root, "n.md");
  await Bun.write(note, "# Ma note\n\nUne idée sur l'hydroponie et la relecture.\n");

  const now = new Date("2026-11-04T10:00:00");
  const a = await add(root, note, { note: "test", now });
  expect(a.duplicate).toBe(false);
  expect((await add(root, note, { note: "test", now })).duplicate).toBe(true);
  const log = await Bun.file(join(root, "wiki/log.md")).text();
  expect(log).toStartWith(`# Log\n\n## 2026-11-04\n- **Add** \`${a.id}\``);

  expect(await renderIndex(root)).toContain("- [Relecture](/wiki/concepts/x.md) — D.");
  const hits = await search(root, "relecture");
  expect(hits.map((h) => h.area)).toEqual(["wiki", "raw"]); // wiki d'abord
  expect((await search(root, "hydroponie", { in: "raw" }))[0].path).toContain(a.id);
});

test("lint : erreurs bloquantes et avertissements", async () => {
  const { lint } = await import("./lint");
  const root = mkdtempSync(join(tmpdir(), "brain-"));
  await Bun.write(join(root, "wiki/concepts/a.md"),
    "---\ntype: Concept\ntitle: A\ndescription: D.\ngenerated: { by: x, at: 2026-11-04T11:00:00+01:00 }\nverified: { by: y, at: 2026-11-04T10:00:00+01:00 }\n---\nVoir [B](/wiki/concepts/b.md). Fait.[^z]\n");
  await Bun.write(join(root, "raw/2026/01/20260101-abcd-x/source.md"), "---\ntype: RawSource\ntitle: X\nfetched_at: 2026-01-01T00:00:00+01:00\nnote: \"\"\nstatus: pending\n---\nx\n");
  const msgs = (await lint(root, new Date("2026-11-04T12:00:00+01:00"))).map((i) => `${i.level} ${i.msg}`);
  expect(msgs).toContain("error lien cassé : /wiki/concepts/b.md");
  expect(msgs).toContain("error note [^z] sans entrée sources[]");
  expect(msgs.some((m) => m.startsWith("warning modifiée depuis la relecture"))).toBe(true);
  expect(msgs).toContain("warning note manquante : à demander avant de compiler");
  expect(msgs).toContain("warning en attente depuis plus de 7 jours");
});

test("garde-fou : écritures limitées à wiki/, Bash limité à brain", async () => {
  const { guard } = await import("./backends/claude");
  const { symlinkSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "brain-"));
  await Bun.write(join(root, "BRAIN.md"), "");
  await Bun.write(join(root, "wiki/concepts/x.md"), "");
  symlinkSync("BRAIN.md", join(root, "CLAUDE.md"));
  symlinkSync("../BRAIN.md", join(root, "wiki/piege.md")); // lien qui ressort de wiki/
  const ok = (tool: string, input: object, mode: "read" | "write" = "write") => guard(root, tool, input, mode).allow;
  expect(ok("Write", { file_path: join(root, "wiki/concepts/nouveau.md") })).toBe(true);
  expect(ok("Edit", { file_path: "wiki/concepts/x.md" })).toBe(true);
  expect(ok("Write", { file_path: join(root, "wiki/sous/dossier/neuf.md") })).toBe(true);
  expect(ok("Edit", { file_path: join(root, "raw/2026/11/a/source.md") })).toBe(false);
  expect(ok("Edit", { file_path: join(root, "wiki/../BRAIN.md") })).toBe(false);
  expect(ok("Edit", { file_path: join(root, "CLAUDE.md") })).toBe(false);
  expect(ok("Edit", { file_path: join(root, "wiki/piege.md") })).toBe(false);
  expect(ok("Write", { file_path: join(root, "wiki/x.md") }, "read")).toBe(false);
  expect(ok("Bash", { command: "brain search context rot" }, "read")).toBe(true);
  expect(ok("Bash", { command: "brain index" }, "read")).toBe(false);
  expect(ok("Bash", { command: "brain index" })).toBe(true);
  expect(ok("Bash", { command: "brain search x; sed -i s/a/b/ raw/x.md" })).toBe(false);
  expect(ok("Bash", { command: "echo x > raw/a.md" })).toBe(false);
  expect(ok("Read", { file_path: "/etc/passwd" }, "read")).toBe(true);
  expect(ok("WebFetch", { url: "https://x" })).toBe(false);
});

test("config.json : absent = agnostique, client inconnu = erreur", async () => {
  const { loadConfig, backendFor } = await import("./backends/index");
  const root = mkdtempSync(join(tmpdir(), "brain-"));
  expect(await loadConfig(root)).toEqual({});
  await Bun.write(join(root, "config.json"), '{"client":"gpt"}');
  expect(loadConfig(root)).rejects.toThrow("client inconnu");
  await Bun.write(join(root, "config.json"), '{"client":"opencode"}');
  expect((await backendFor(root)).interactive("p")).toEqual(["opencode", "--prompt", "p"]);
  await Bun.write(join(root, "config.json"), "{}");
  expect((await backendFor(root)).interactive("p")).toEqual(["claude", "p"]);
});
