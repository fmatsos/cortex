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

test("inbox : fichiers et urls.txt vidés, échecs conservés, idempotent", async () => {
  const { inbox } = await import("./inbox");
  const { existsSync, readdirSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "brain-"));
  await Bun.write(join(root, "BRAIN.md"), "");
  const page = `<html><head><title>Page de test</title></head><body><article><h1>Page de test</h1>${"<p>Un paragraphe de remplissage assez long pour que l'extraction dépasse le seuil de cinquante mots exigé par brain add, sans réseau.</p>".repeat(4)}</article></body></html>`;
  const srv = Bun.serve({ port: 0, fetch: (req) => new URL(req.url).pathname === "/ok" ? new Response(page, { headers: { "content-type": "text/html" } }) : new Response("non", { status: 404 }) });
  const sources = () => (existsSync(join(root, "raw")) ? readdirSync(join(root, "raw"), { recursive: true }) : []).filter((f) => String(f).endsWith("source.md")).length;
  const urls = join(root, "inbox/urls.txt");
  const [ok, ko] = [`${srv.url}ok`, `${srv.url}ko`];
  const log = console.log, err = console.error; // sorties du CLI : rendues muettes
  const out: string[] = [];
  console.log = (...a) => void out.push(a.join(" ")); console.error = (...a) => void out.push(a.join(" "));
  try {
    expect(await inbox(root)).toBe(0); // inbox absente
    expect(out.at(-1)).toBe("Inbox vide.");

    await Bun.write(urls, `# commentaire\n\n${ok} pourquoi je garde ça\n${ko}\n`);
    await Bun.write(join(root, "inbox/avec.md"), "# Avec note\n\nUne idée sur la fermentation lactique des légumes.\n");
    await Bun.write(join(root, "inbox/avec.md.note"), "ma note\n");
    await Bun.write(join(root, "inbox/sans.txt"), "# Sans note\n\nUne autre idée sur la lacto-fermentation, très différente.\n");
    await Bun.write(join(root, "inbox/.gitkeep"), "");

    // dry-run : rien ne bouge
    expect(await inbox(root, { dryRun: true })).toBe(1);
    expect(sources()).toBe(0);
    expect(await Bun.file(urls).text()).toContain(ok);
    expect(existsSync(join(root, "inbox/avec.md.note"))).toBe(true);

    // vrai passage : 3 sources, l'échec (404) reste, commentaires conservés
    expect(await inbox(root)).toBe(1);
    expect(sources()).toBe(3);
    expect(await Bun.file(urls).text()).toBe(`# commentaire\n\n${ko}\n`);
    expect(readdirSync(join(root, "inbox")).sort()).toEqual([".gitkeep", "urls.txt"]);
    const raws = (await import("./lib")).readDocs(root, "raw");
    expect((await raws).map((d) => d.fm.note).sort()).toEqual(["", "ma note", "pourquoi je garde ça"]);
    expect(out.some((l) => l.startsWith(`✗ ${ko}`))).toBe(true);

    // second passage : seul l'échec revient, rien de nouveau
    expect(await inbox(root)).toBe(1);
    expect(sources()).toBe(3);

    // l'URL déjà présente quitte l'inbox sans nouvelle source
    await Bun.write(urls, `${ok}\n`);
    expect(await inbox(root)).toBe(0);
    expect(await Bun.file(urls).text()).toBe("");
    expect(sources()).toBe(3);
  } finally { console.log = log; console.error = err; srv.stop(true); }
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

test("recherche : index inversé (exact, préfixe, faute), filtres, phrases, classement, instantanée à grande échelle", async () => {
  const { buildTerms, createEngine, rank } = await import("../site/src/lib/search-engine");
  const { parseQuery } = await import("../site/src/lib/query");
  const Fuse = (await import("fuse.js")).default;
  const doc = (id: string, title: string, text: string, tags: string[] = [], type = "Concept") =>
    ({ id, title, description: "", type, tags, status: "stable", verified: true, text });
  const docs = [
    doc("a", "Context rot", "La fenêtre de contexte se dégrade."),
    doc("b", "Harnais", "Un long texte. ".repeat(2000) + "Le contexte compte aussi ici.", ["llm"]),
    doc("c", "Décentralisation", "Le fédivers et Mastodon.", ["reseau"], "Entity"),
    doc("d", "Constructor", "Le constructor et toString d'une classe."), // mots qui sont aussi des propriétés d'Object
  ];
  const e = createEngine({ docs, terms: buildTerms(docs), vocab: [] }, Fuse);
  const ids = (q: string) => rank(e, parseQuery(q), () => false).map((r) => r.doc.id);
  expect(ids("contexte")).toEqual(["a", "b"]); // mot en fin d'une longue page trouvé ; « Context » au titre classe a devant
  expect(ids("conte")).toContain("b"); // préfixe pendant la frappe
  expect(ids("contexet")).toContain("a"); // faute de frappe
  expect(ids("decentralisation")).toEqual(["c"]); // accents ignorés
  expect(ids("contexte #llm")).toEqual(["b"]);
  expect(ids("contexte -fenetre")).toEqual(["b"]);
  expect(ids('"fediverse"')).toEqual([]);
  expect(ids('"le federivers"')).toEqual([]);
  expect(ids('"et mastodon"')).toEqual(["c"]);
  expect(ids("type:entity")).toEqual(["c"]);
  expect(ids("constructor")).toEqual(["d"]);
  expect(ids("tostring")).toEqual(["d"]);
  expect(ids("hasownproperty")).toEqual([]);

  // ~3 000 pages de ~1 500 caractères : chaque requête doit rester instantanée
  const words = Array.from({ length: 4000 }, (_, i) => `mot${i.toString(36)}`);
  const big = Array.from({ length: 3000 }, (_, i) => doc(`p${i}`, `Page ${i}`, Array.from({ length: 200 }, (_, k) => words[(i * 7 + k * 13) % words.length]).join(" ")));
  const E = createEngine({ docs: big, terms: buildTerms(big), vocab: [] }, Fuse);
  rank(E, parseQuery("motzz"), () => false); // construit l'index flou une fois
  let worst = 0;
  for (const q of ["mot1a", "mot2 mot3b", "motab", "page 12", "mot1q mot2r mot3s"]) {
    const t = performance.now(); rank(E, parseQuery(q), () => false); worst = Math.max(worst, performance.now() - t);
  }
  expect(worst).toBeLessThan(50);
});

test("export : ancres de titres lisibles, uniques, sans collision avec les ids de l'interface", async () => {
  const { anchors } = await import("./export");
  const ids = (m: string) => [...anchors(Bun.markdown.html(m)).matchAll(/<h\d id="([^"]+)"/g)].map((x) => x[1]);
  expect(ids("## Où ça ? Détail\n\n## Où ça ? Détail\n\n## Où ça ? Détail")).toEqual(["ou-ca-detail", "ou-ca-detail-1", "ou-ca-detail-2"]);
  expect(ids("## Contenu principal\n\n## Src x\n\n## Fn y\n\n## H notes\n\n## ???\n\n### 日本語")).toEqual(["t-contenu-principal", "t-src-x", "t-fn-y", "t-h-notes", "titre", "日本語"]);
  expect(anchors("<h2 id=\"x\">Un <em>titre</em> &amp; un autre</h2>")).toBe('<h2 id="un-titre-un-autre">Un <em>titre</em> &amp; un autre</h2>');
});

test("export : encart « Note personnelle » (callout Obsidian)", async () => {
  const { noteCallouts } = await import("./export");
  const html = (m: string) => noteCallouts(Bun.markdown.html(m));
  expect(html("> [!note] Note personnelle\n> pourquoi *je* garde ça")).toBe('<aside class="note-perso" role="note"><p class="note-perso-titre">Note personnelle</p><p>pourquoi <em>je</em> garde ça</p>\n</aside>\n');
  expect(html("> [!note]\n> sans titre")).toContain('<p class="note-perso-titre">Note personnelle</p><p>sans titre');
  expect(html("> une citation ordinaire")).toContain("<blockquote>");
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

test("requête de recherche : filtres, guillemets, exclusions, accents", async () => {
  const { parseQuery, matches, removeToken, canonType, isEmpty } = await import("../site/src/lib/query");
  const p = parseQuery(`context  #Mémoire tag:LLM type:Synthèses status:draft is:fav "Phrase Exacte" -rot -#vieux -"à éviter" -type:source`);
  expect(p.words).toEqual(["context"]);
  expect(p.ops.map((o) => [o.key, o.value, o.neg])).toEqual([
    ["tag", "memoire", false], ["tag", "llm", false], ["type", "Synthesis", false], ["status", "draft", false], ["is", "fav", false],
    ["tag", "vieux", true], ["type", "Source", true],
  ]);
  expect(p.phrases.map((x) => x.text)).toEqual(["phrase exacte"]);
  expect(p.exclude.map((x) => x.text)).toEqual(["rot", "a eviter"]);
  expect(canonType("entités")).toBe("Entity");
  // clé inconnue = mot ordinaire ; tiret au milieu d'un mot ≠ exclusion ; requête vide
  expect(parseQuery("foo:bar chain-of-thought").words).toEqual(["foo", "bar", "chain", "of", "thought"]);
  expect(parseQuery("chain-of-thought").exclude).toEqual([]);
  expect(isEmpty(parseQuery("  "))).toBe(true);
  // guillemet non fermé : ne bloque rien
  expect(parseQuery('"jamais fermé').words).toEqual(["jamais", "ferme"]);
  // retrait d'une puce
  expect(removeToken("a #tag b", "#tag")).toBe("a b");

  const doc = { id: "concepts/a", title: "Mémoire vive", description: "RAM", type: "Concept", tags: ["Matériel", "ram"], status: "stable", verified: false, text: "La mémoire coûte cher en 2026." };
  const ok = (q: string, fav = false) => matches(doc, parseQuery(q), () => fav);
  expect(ok("#materiel type:concept status:stable")).toBe(true); // tag sans accent, type en minuscules
  expect(ok("type:source")).toBe(false);
  expect(ok("-type:source -#absent")).toBe(true);
  expect(ok("-#ram")).toBe(false);
  expect(ok("is:unverified")).toBe(true);
  expect(ok("is:fav")).toBe(false);
  expect(ok("is:favoris", true)).toBe(true);
  expect(ok('"coute cher"')).toBe(true); // phrase exacte, sans accents
  expect(ok('"cher coute"')).toBe(false);
  expect(ok("-cher")).toBe(false);
  expect(ok("-prix")).toBe(true);
});

test("export : site statique, liens réécrits, notes reliées, raw/ non publié, index de recherche", async () => {
  const { existsSync, readdirSync, readFileSync, statSync } = await import("node:fs");
  const { exportSite, checkOut } = await import("./export");
  const root = mkdtempSync(join(tmpdir(), "brain-"));
  const fm = (t: string, title: string, extra = "") => `---\ntype: ${t}\ntitle: ${title}\ndescription: Description de ${title}.\ntags: [alpha]\nstatus: stable\ngenerated: { by: test, at: 2026-11-04T10:00:00+01:00 }\n${extra}---\n`;
  const src = `sources:\n  - id: s1\n    resource: /raw/2026/11/20261104-abcd-x/source.md\n    title: "Source un"\n`;
  await Bun.write(join(root, "BRAIN.md"), "");
  await Bun.write(join(root, "raw/2026/11/20261104-abcd-x/source.md"), "---\ntype: RawSource\ntitle: Source un\nurl: https://exemple.org/article\nnote: n\nstatus: compiled\n---\nSECRET-DU-CORPS-RAW\n");
  await Bun.write(join(root, "wiki/concepts/a.md"), fm("Concept", "Alpha", src) + "Voir [Beta](/wiki/concepts/b.md#x) et [Gamma](/wiki/entities/c.md), [futur](/wiki/concepts/absent.md). Un fait.[^s1]\n\n## Première partie\n\nEncore un fait.[^s1] Et un autre.[^s1]\n\n### Détail\n\n## Première partie\n\n## Notes\n\n[^s1]: précision *utile*\n");
  await Bun.write(join(root, "wiki/concepts/b.md"), fm("Concept", "Béta") + "Retour vers [Alpha](/wiki/concepts/a.md).\n\n" + "Remplissage. ".repeat(600) + "Motlointain en fin de page.\n"); // ~7 800 caractères
  await Bun.write(join(root, "wiki/entities/c.md"), fm("Entity", "Gamma") + "Isolé. [Accueil](/wiki/index.md), [journal](/wiki/log.md).\n");
  await Bun.write(join(root, "wiki/sources/s.md"), fm("Source", "Source un", src) + "Résumé, voir [Alpha](/wiki/concepts/a.md).\n");
  await Bun.write(join(root, "wiki/index.md"), "# Index\n");
  await Bun.write(join(root, "wiki/log.md"), "# Log\n\n## 2026-11-04\n- **Ingest** x\n");

  expect(() => checkOut(root, root)).toThrow("refusé");
  expect(() => checkOut(root, join(root, "wiki"))).toThrow("refusé");
  await Bun.write(join(root, "documents/notes.txt"), "à ne jamais vider");
  expect(() => checkOut(root, join(root, "documents"))).toThrow("ne ressemble pas à un export"); // dossier non vide sans _app/
  const out = join(root, ".brain/site");
  await exportSite(root, out, () => {});

  const html = (p: string) => readFileSync(join(out, p), "utf8");
  for (const p of ["index.html", "graph/index.html", "log/index.html", "tags/index.html", "tags/alpha/index.html", "search/index.html", "wiki/concepts/a/index.html", "wiki/concepts/b/index.html", "wiki/entities/c/index.html", "wiki/sources/s/index.html"])
    expect(existsSync(join(out, p))).toBe(true);
  const a = html("wiki/concepts/a/index.html");
  expect(a).toContain('href="../b/#x"'); // lien réécrit, relatif
  expect(a).toContain('href="../../entities/c/"');
  expect(a).toContain('class="lien-manquant"'); // page absente : pas de lien mort
  expect(a).not.toMatch(/href="[^"]*\.md/);
  expect(a).toContain('href="#fn-s1"'); // note [^s1] numérotée, reliée à sources[]
  expect(a).toContain('id="fn-s1"');
  expect(a).toContain('href="#src-s1"');
  expect(a).toContain("<em>utile</em>");
  // note citée trois fois : une ancre par occurrence, et un retour ↩ vers chacune (pas seulement la première)
  for (const k of [1, 2, 3]) {
    expect(a).toContain(`id="fnref-s1-${k}"`);
    expect(a).toContain(`href="#fnref-s1-${k}"`);
  }
  expect(a).not.toContain('id="fnref-s1-4"');
  expect(a).toContain("Retour à l'occurrence 2 sur 3");
  expect(a).toContain('href="https://exemple.org/article"'); // source : URL d'origine, pas le chemin raw
  expect(a).not.toContain("/raw/");
  expect(a).toContain("Rétroliens");

  const c = html("wiki/entities/c/index.html");
  expect(c).toContain('href="../../../"'); // /wiki/index.md → accueil
  expect(c).toContain('href="../../../log/"'); // /wiki/log.md → journal
  const out2 = join(root, "site2");
  await exportSite(root, out2, () => {}); // reproductible : même wiki, même site
  const files = (d: string) => (readdirSync(d, { recursive: true }) as string[]).filter((f) => statSync(join(d, f)).isFile()).sort();
  expect(files(out2)).toEqual(files(out));
  for (const f of files(out)) expect(readFileSync(join(out2, f), "utf8")).toBe(readFileSync(join(out, f), "utf8"));

  const graph = JSON.parse(html("graph.json"));
  expect(graph.nodes.map((n: any) => n.id).sort()).toEqual(["concepts/a", "concepts/b", "entities/c", "sources/s"]);
  expect(graph.nodes.find((n: any) => n.id === "concepts/a")).toMatchObject({ type: "Concept", tags: ["alpha"], degree: 3 });
  expect(graph.links).toHaveLength(3); // a-b (liens dans les deux sens : une seule arête), a-c, s-a
  expect(graph.links.filter((l: any) => [l.source, l.target].sort().join() === "concepts/a,concepts/b")).toHaveLength(1);
  expect(graph.links.some((l: any) => l.target === "concepts/absent")).toBe(false);

  const idx = JSON.parse(html("search-index.json"));
  expect(idx.docs).toHaveLength(4);
  expect(idx.terms.motlointain).toEqual([idx.docs.findIndex((d: any) => d.id === "concepts/b")]); // index inversé sur tout le contenu
  expect(idx.vocab).toContain("alpha");
  expect(idx.docs.find((d: any) => d.id === "concepts/b").text).toContain("Motlointain"); // contenu complet indexé, pas un extrait

  // « Copier le Markdown » : le source de la page, frontmatter compris, chemin raw/ remplacé par l'URL d'origine
  const pageA = JSON.parse(readFileSync(join(root, ".brain/site-data/data.json"), "utf8")).pages.find((x: any) => x.id === "concepts/a");
  expect(pageA.md).toStartWith("---\ntype: Concept\ntitle: Alpha");
  expect(pageA.md).toContain("resource: https://exemple.org/article");
  expect(pageA.md).toContain("Voir [Beta](/wiki/concepts/b.md#x)");
  // sommaire : titres h2/h3 avec ancres stables (doublon suffixé), repris par les ids du HTML ; nombre d'occurrences par note
  expect(pageA.toc.map((t: any) => [t.level, t.id, t.text])).toEqual([[2, "premiere-partie", "Première partie"], [3, "detail", "Détail"], [2, "premiere-partie-1", "Première partie"], [2, "notes", "Notes"]]);
  for (const t of pageA.toc) expect(pageA.html).toContain(`id="${t.id}"`);
  expect(pageA.notes[0]).toMatchObject({ id: "s1", refs: 3 });
  expect(a).toContain('href="#premiere-partie-1"'); // quatre titres : le sommaire est affiché (seuil > 3)
  expect(JSON.parse(readFileSync(join(root, ".brain/site-data/data.json"), "utf8")).pages.find((x: any) => x.id === "entities/c").toc).toEqual([]);
  // aucune donnée de raw/ hors l'URL d'origine, nulle part dans le site
  const all = (readdirSync(out, { recursive: true }) as string[]).filter((f) => statSync(join(out, f)).isFile());
  for (const f of all) {
    const t = readFileSync(join(out, f), "utf8");
    expect(t).not.toContain("SECRET-DU-CORPS-RAW");
    expect(t).not.toContain("20261104-abcd-x");
  }
}, 120_000);
