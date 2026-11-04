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

/** Racine jetable : 3 pages wiki reliées par liens, tags et source partagée, plus une source raw. */
async function mcpRoot() {
  const root = mkdtempSync(join(tmpdir(), "brain-"));
  const res = "/raw/2026/11/20261104-abcd-x/source.md";
  const page = (type: string, title: string, tags: string, body: string) =>
    `---\ntype: ${type}\ntitle: ${title}\ndescription: D ${title}.\ntags: [${tags}]\nsources:\n  - id: x\n    resource: ${res}\n    title: X\n---\n${body}\n`;
  await Bun.write(join(root, "BRAIN.md"), "");
  await Bun.write(join(root, "raw/2026/11/20261104-abcd-x/source.md"), "---\ntype: RawSource\ntitle: X\nnote: n\nstatus: compiled\n---\nUn texte sur le zythum.\n");
  await Bun.write(join(root, "wiki/concepts/a.md"), page("Concept", "Alpha", "llm, ctx", "Voir [B](/wiki/concepts/b.md)."));
  await Bun.write(join(root, "wiki/concepts/b.md"), page("Concept", "Beta", "ctx", "Rien."));
  await Bun.write(join(root, "wiki/entities/c.md"), page("Entity", "Gamma", "llm", "Voir [A](/wiki/concepts/a.md#x)."));
  await Bun.write(join(root, "wiki/index.md"), "# Index\n- [Alpha](/wiki/concepts/a.md)\n- [Beta](/wiki/concepts/b.md)\n- [Gamma](/wiki/entities/c.md)\n");
  await Bun.write(join(root, "wiki/log.md"), "# Log\n\n## 2026-11-04\n- **Add** x.\n\n## 2026-11-03\n- **Add** y.\n");
  return root;
}

test("related : liens, rétroliens, sources et tags, classés par force", async () => {
  const { related } = await import("./mcp");
  const { readDocs } = await import("./lib");
  const docs = await readDocs(await mcpRoot(), "wiki");
  const a = related(docs, "/wiki/concepts/a.md");
  // B : lien sortant 3 + source 2 + tag ctx 1 = 6 ; C : lien entrant 3 + source 2 + tag llm 1 = 6 ; index.md exclu
  expect(a.map((r) => r.path)).toEqual(["wiki/concepts/b.md", "wiki/entities/c.md"]);
  expect(a[0]).toMatchObject({ score: 6, reasons: ["lien sortant", "source partagée : /raw/2026/11/20261104-abcd-x/source.md", "tag partagé : ctx"] });
  expect(a[1].reasons).toContain("lien entrant");
  // sans lien direct : seulement la source partagée (B et C n'ont aucun tag commun)
  expect(related(docs, "wiki/concepts/b.md").map((r) => [r.path, r.score])).toEqual([["wiki/concepts/a.md", 6], ["wiki/entities/c.md", 2]]);
  expect(() => related(docs, "/wiki/concepts/nope.md")).toThrow("introuvable");
});

test("get : refuse tout chemin hors de wiki/ et raw/", async () => {
  const { getFile } = await import("./mcp");
  const { symlinkSync } = await import("node:fs");
  const root = await mcpRoot();
  await Bun.write(join(root, "secret.md"), "secret");
  symlinkSync("../secret.md", join(root, "wiki/piege.md")); // lien qui ressort de wiki/
  expect(await getFile(root, "/wiki/concepts/b.md")).toContain("Beta");
  expect(await getFile(root, "wiki/concepts/b.md")).toContain("Beta");
  expect(await getFile(root, "raw/2026/11/20261104-abcd-x/source.md")).toContain("zythum");
  for (const p of ["BRAIN.md", "secret.md", "wiki/../secret.md", "/wiki/../secret.md", "wiki/piege.md", "/etc/passwd", "../x.md"])
    expect(getFile(root, p)).rejects.toThrow();
  expect(getFile(root, "wiki/concepts")).rejects.toThrow("introuvable"); // un dossier n'est pas un fichier
});

test("lastLog : sections datées les plus récentes", async () => {
  const { lastLog } = await import("./mcp");
  const root = await mcpRoot();
  expect(await lastLog(root, 1)).toBe("## 2026-11-04\n- **Add** x.");
  expect(await lastLog(root, 5)).toContain("## 2026-11-03");
});

test("brain mcp : initialize, tools/list, search, get, add sans réseau (JSON-RPC sur stdio)", async () => {
  const root = await mcpRoot();
  const proc = Bun.spawn(["bun", join(import.meta.dir, "brain.ts"), "mcp"], {
    env: { ...process.env, BRAIN_ROOT: root }, stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  const send = (m: object) => { proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n"); proc.stdin.flush(); };
  const reader = proc.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  const recv = async (id: number) => {
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        const msg = JSON.parse(buf.slice(0, nl)); // une ligne hors protocole sur stdout ferait échouer ce parse
        buf = buf.slice(nl + 1);
        if (msg.id === id) return msg;
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error(`serveur arrêté : ${await new Response(proc.stderr).text()}`);
      buf += value;
    }
  };
  const call = async (id: number, name: string, args: object) => {
    send({ id, method: "tools/call", params: { name, arguments: args } });
    return (await recv(id)).result;
  };
  try {
    send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    expect((await recv(1)).result.serverInfo.name).toBe("brain");
    send({ method: "notifications/initialized" });

    send({ id: 2, method: "tools/list" });
    expect((await recv(2)).result.tools.map((t: any) => t.name).sort()).toEqual(["add", "get", "lint", "log", "related", "search"]);

    const s = await call(3, "search", { q: "zythum" });
    expect(JSON.parse(s.content[0].text).hits[0]).toMatchObject({ area: "raw", path: "/raw/2026/11/20261104-abcd-x/source.md" });
    expect(JSON.parse(s.content[0].text).hint).toContain("trou");
    expect((await call(4, "get", { path: "/wiki/concepts/b.md" })).content[0].text).toContain("Beta");
    expect((await call(5, "get", { path: "wiki/../BRAIN.md" })).isError).toBe(true);
    expect((await call(6, "add", { text: "# Idée\n\nUn texte qui parle de houblon.", note: "" })).isError).toBe(true);
    const added = JSON.parse((await call(7, "add", { text: "# Idée\n\nUn texte qui parle de houblon.", note: "test" })).content[0].text);
    expect(added).toMatchObject({ duplicate: false, title: "Idée" });
    expect(JSON.parse((await call(8, "add", { text: "# Idée\n\nUn texte qui parle de houblon.", note: "test" })).content[0].text).id).toBe(added.id);
    expect((await call(10, "add", { input: "/etc/hostname", note: "fuite" })).isError).toBe(true); // pas de fichier local via MCP
    expect((await call(9, "log", {})).content[0].text).toContain(`**Add** \`${added.id}\``);
    expect((await call(10, "related", { path: "/wiki/concepts/a.md" })).content[0].text).toContain("wiki/concepts/b.md");
  } finally { proc.stdin.end(); proc.kill(); }
});
