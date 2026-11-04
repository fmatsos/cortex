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
  expect((await backendFor(root)).interactive("p")).toEqual(["opencode", "--model", "opencode/big-pickle", "--prompt", "p"]);
  // effort : traduit dans le vocabulaire de chaque CLI
  const it = async (cfg: object) => { await Bun.write(join(root, "config.json"), JSON.stringify(cfg)); return (await backendFor(root)).interactive("p"); };
  expect(await it({ client: "opencode", effort: "high" })).toEqual(["opencode", "--model", "opencode/big-pickle#high", "--prompt", "p"]);
  expect(await it({ client: "claude", model: "opus", effort: "max" })).toEqual(["claude", "--model", "opus", "--effort", "max", "p"]);
  expect(await it({ client: "codex", effort: "low" })).toEqual(["codex", "-c", 'model_reasoning_effort="low"', "p"]);
  await Bun.write(join(root, "config.json"), "{}");
  expect((await backendFor(root)).interactive("p")).toEqual(["claude", "p"]);
});

test("brain config : init, set, get, remove, lint", async () => {
  const { configCmd, lintConfig, loadConfig } = await import("./backends/index");
  const root = mkdtempSync(join(tmpdir(), "brain-"));
  const log = console.log; console.log = () => {};
  try {
    expect(await configCmd(root, ["init"])).toBe(0);
    expect(await loadConfig(root)).toEqual({}); // squelette tout à null : agnostique
    expect(configCmd(root, ["init"])).rejects.toThrow("existe déjà");
    await configCmd(root, ["set", "client", "codex"]);
    await configCmd(root, ["set", "effort", "low"]);
    expect(configCmd(root, ["set", "effort", "turbo"])).rejects.toThrow("invalide pour codex");
    expect(configCmd(root, ["set", "couleur", "x"])).rejects.toThrow("Propriété attendue");
    expect(await loadConfig(root)).toEqual({ client: "codex", effort: "low" });
    await configCmd(root, ["remove", "effort"]);
    expect(await loadConfig(root)).toEqual({ client: "codex" });
    await Bun.write(join(root, "config.json"), "{ pas du json");
    expect(await configCmd(root, ["lint"])).toBe(1);
  } finally { console.log = log; }
  expect(lintConfig({ client: "opencode", effort: "n'importe" })).toEqual([]); // variante propre au modèle
  expect(lintConfig({ effort: "high" })[0].level).toBe("warning");
  expect(lintConfig([])[0].level).toBe("error");
});

test("confinement bubblewrap : wiki/ seul inscriptible", async () => {
  const { confine } = await import("./backends/backend");
  const root = mkdtempSync(join(tmpdir(), "brain-"));
  await Bun.write(join(root, "wiki/.keep"), "");
  await Bun.write(join(root, "raw/.keep"), "");
  const sh = (mode: "read" | "write", f: string) =>
    Bun.spawnSync(confine(root, ["sh", "-c", `touch ${join(root, f)}`], mode), { stderr: "pipe" }).exitCode;
  expect(sh("write", "wiki/ok.md")).toBe(0);
  expect(sh("write", "raw/non.md")).not.toBe(0);
  expect(sh("write", "BRAIN.md")).not.toBe(0);
  expect(sh("read", "wiki/non.md")).not.toBe(0);
});
