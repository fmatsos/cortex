import { expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { add } from "./add";
import { renderIndex } from "./index";
import { localIso, newId, normUrl, rawPath, slugify, UUID } from "./lib";
import { ftsQuery, search } from "./search";

test("utilitaires", () => {
  expect(localIso(new Date())).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
  const ids = Array.from({ length: 1000 }, () => newId(new Date("2026-11-04T10:00:00Z")));
  expect(ids.every((id) => UUID.test(id))).toBe(true);
  expect(new Set(ids).size).toBe(1000); // same millisecond: always distinct
  expect(newId(new Date("2026-01-01")) < newId(new Date("2026-11-04"))).toBe(true); // creation order
  expect(UUID.test("20261104-abcd-x")).toBe(false);
  expect(slugify("Le C++26 refusé à l'ISO : une première")).toBe("le-c-26-refuse-a-l-iso-une-premiere");
  expect(normUrl("https://X.com/a/?utm_source=z&hl=en#f")).toBe(normUrl("https://x.com/a?hl=en"));
  expect(ftsQuery(`l'IA "spec"`)).toBe(`"l'IA" """spec"""`);
});

test("add → index → search, idempotent", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  await Bun.write(join(root, "wiki/log.jsonl"), '{"at":"2000-01-01","kind":"update","text":"ancien"}\n');
  await Bun.write(join(root, "wiki/concepts/x.md"), "---\ntype: Concept\ntitle: Relecture\ndescription: D.\n---\nCorps sur la relecture.\n");
  const note = join(root, "n.md");
  await Bun.write(note, "# Ma note\n\nUne idée sur l'hydroponie et la relecture.\n");

  const now = new Date("2026-11-04T10:00:00");
  const a = await add(root, note, { note: "test", now });
  expect(a.duplicate).toBe(false);
  expect((await add(root, note, { note: "test", now })).duplicate).toBe(true);
  const jsonl = (await Bun.file(join(root, "wiki/log.jsonl")).text()).trim().split("\n").map((l) => JSON.parse(l));
  expect(jsonl).toHaveLength(2); // the duplicate add writes nothing
  expect(UUID.test(a.id)).toBe(true);
  expect(rawPath(root, a.id)).toBe(`raw/2026/11/${a.id}/source.md`); // filed by month of addition
  expect(jsonl[1]).toMatchObject({ kind: "add", text: `\`${a.id}\`.`, sources: [a.id] });
  expect(jsonl[1].at).toMatch(/^2026-11-04T10:00:00[+-]\d\d:\d\d$/);
  const log = await Bun.file(join(root, "wiki/log.md")).text();
  expect(log).toContain(`## 2026-11-04\n- **Add** \`${a.id}\`.\n\n## 2000-01-01\n- **Update** ancien\n`); // without repeating the id already in the text

  expect(await renderIndex(root)).toContain("- [Relecture](/wiki/concepts/x.md) — D.");
  const hits = await search(root, "relecture");
  expect(hits.map((h) => h.area)).toEqual(["wiki", "raw"]); // wiki first
  expect((await search(root, "hydroponie", { in: "raw" }))[0].path).toContain(a.id);
});

test("cortex new : page nommée par UUID v7 par défaut, titre unique, lint des noms, journal nommé par titre", async () => {
  const { newPage } = await import("./naming");
  const { lint } = await import("./lint");
  const { logAdd } = await import("./log");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  const p = await newPage(root, "concept", "Context rot");
  expect(p).toMatch(/^wiki\/concepts\/[0-9a-f-]{36}\.md$/);
  expect(UUID.test(p.slice(14, -3))).toBe(true);
  expect(await Bun.file(join(root, p)).text()).toBe("---\ntype: Concept\ntitle: Context rot\nstatus: draft\n---\n");
  await expect(newPage(root, "Entity", "context  ROT")).rejects.toThrow(p); // same title: the existing page is named
  await expect(newPage(root, "Note", "x")).rejects.toThrow("type inconnu");
  expect((await newPage(root, "Synthesis", "Autre")).startsWith("wiki/syntheses/")).toBe(true);

  await Bun.write(join(root, "wiki/concepts/a-la-main.md"), "---\ntype: Concept\ntitle: Main\ndescription: D.\n---\nx\n");
  for (const d of ["2026/11/20261104-abcd-x", "2025/01/20261104-abcd-x"]) await Bun.write(join(root, `raw/${d}/source.md`), "---\ntype: RawSource\nnote: n\nstatus: compiled\n---\nx\n");
  const issues = (await lint(root)).map((i) => `${i.level} ${i.path} ${i.msg}`);
  expect(issues).toContain("warning wiki/concepts/a-la-main.md nom hors du modèle page_path « {type}/{uuid} » (les pages se créent par cortex new)");
  expect(issues).toContain("warning raw/2026/11/20261104-abcd-x/source.md chemin hors du modèle raw_path « {yyyy}/{mm}/{uuid} » (les sources s'ajoutent par cortex add)");
  expect(issues.filter((i) => i.includes("id raw en double : 20261104-abcd-x"))).toHaveLength(1);
  expect(issues.some((i) => i.includes(p) && i.includes("modèle"))).toBe(false);

  // log.md names pages by their title, and does not repeat them when the text already names them
  await logAdd(root, "ingest", "Créé context-rot.", [], [p, "wiki/concepts/a-la-main.md"]);
  expect(await Bun.file(join(root, "wiki/log.md")).text()).toContain("- **Ingest** Créé context-rot. (pages : [Main](/wiki/concepts/a-la-main.md))\n");
});

test("nommage configurable : modèles validés, placeholders, sous-dossiers, collisions", async () => {
  const { checkTemplate, expand, pattern, newPage } = await import("./naming");
  const { lintConfig } = await import("./backends/index");
  const { lint } = await import("./lint");
  const at = new Date("2026-11-04T09:05:07");
  // validation
  expect(checkTemplate("raw_path", "{yyyy}/{mm}/{uuid}")).toBeUndefined();
  expect(checkTemplate("page_path", "{type}/{yyyy}{mm}{dd}-{slug}")).toBeUndefined();
  expect(checkTemplate("raw_path", "{type}/{uuid}")).toContain("placeholder inconnu {type}"); // {type}: pages only
  expect(checkTemplate("page_path", "{kind}/{uuid}")).toContain("placeholder inconnu {kind}");
  expect(checkTemplate("page_path", "../{uuid}")).toContain("segments vides");
  expect(checkTemplate("page_path", "{type}//{uuid}")).toContain("segments vides");
  expect(checkTemplate("page_path", "{type}/a b{uuid}")).toContain("seuls lettres");
  expect(checkTemplate("page_path", "{uuid}/page")).toContain("dernier segment");
  expect(lintConfig({ page_path: "{oops}" })[0].msg).toContain("placeholder inconnu {oops}");
  expect(lintConfig({ raw_path: "{yyyy}/{rand}-{slug}", page_path: null })).toEqual([]);
  // values and patterns
  const v = { at, title: "Le C++26 refusé", type: "Concept", kind: "pdf" };
  expect(expand("{type}/{yyyy}{mm}{dd}-{hh}{mi}{ss}-{slug}", v)).toBe("concepts/20261104-090507-le-c-26-refuse");
  expect(expand("{kind}/{rand}", v)).toMatch(/^pdf\/[a-z0-9]{4}$/);
  for (const t of ["{type}/{uuid}", "{yyyy}/{mm}/{dd}-{rand}-{slug}", "{type}/{yyyy}{mm}{dd}-{slug}"]) {
    expect(pattern(t).test(expand(t, v))).toBe(true);
    expect(pattern(t).test(`${expand(t, v)}-2`)).toBe(true); // collision suffix
    expect(pattern(t).test(`x/${expand(t, v)}`)).toBe(false);
  }

  // a wiki with timestamped naming, no folder per type
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ raw_path: "{yyyy}{mm}{dd}-{rand}-{slug}", page_path: "{yyyy}/{slug}" }));
  const note = join(root, "n.md");
  await Bun.write(note, "# Ma note\n\nUne idée.\n");
  const a = await add(root, note, { note: "n", now: at });
  expect(a.id).toMatch(/^20261104-[a-z0-9]{4}-ma-note$/);
  expect(rawPath(root, a.id)).toBe(`raw/${a.id}/source.md`);
  expect(await newPage(root, "Concept", "Context rot", at)).toBe("wiki/2026/context-rot.md");
  await Bun.write(join(root, "wiki/2026/context-rot.md"), "---\ntype: Concept\ntitle: Autre titre\n---\n"); // the name is taken, not the title
  expect(await newPage(root, "Entity", "Context  rot!", at)).toBe("wiki/2026/context-rot-2.md");
  const issues = (await lint(root)).filter((i) => i.msg.includes("modèle"));
  expect(issues).toEqual([]);
});

test("schema: built-in file, written to CLAUDE.md or AGENTS.md at init, language and override from cortex.json", async () => {
  const { configCmd } = await import("./backends/index");
  const { schemaText, writeSchema, agentFile } = await import("./schema");
  const log = console.log; console.log = () => {};
  try {
    for (const [client, file] of [[undefined, "CLAUDE.md"], ["claude", "CLAUDE.md"], ["codex", "AGENTS.md"], ["opencode", "AGENTS.md"]] as const) {
      const root = mkdtempSync(join(tmpdir(), "cortex-"));
      expect(await configCmd(root, ["init", ...(client ? [client] : [])])).toBe(0);
      expect(agentFile(client)).toBe(file);
      const txt = await Bun.file(join(root, file)).text();
      expect(txt).toContain("## INGEST workflow");
      expect(txt).toContain("Wiki language: **English**");
      expect(existsSync(join(root, file === "CLAUDE.md" ? "AGENTS.md" : "CLAUDE.md"))).toBe(false);
    }
    const root = mkdtempSync(join(tmpdir(), "cortex-"));
    await Bun.write(join(root, "CLAUDE.md"), "mine");
    await configCmd(root, ["init"]);
    expect(await Bun.file(join(root, "CLAUDE.md")).text()).toBe("mine"); // an existing file is kept…
    await configCmd(root, ["set", "language", "French"]);
    await writeSchema(root, true); // …until cortex schema --write
    expect(await Bun.file(join(root, "CLAUDE.md")).text()).toContain("Wiki language: **French**");
    await Bun.write(join(root, "my-schema.md"), "Custom, in {{language}}.\n");
    await configCmd(root, ["set", "schema", "my-schema.md"]);
    expect(await schemaText(root)).toBe("Custom, in French.\n");
    await configCmd(root, ["set", "schema", "missing.md"]);
    await expect(schemaText(root)).rejects.toThrow("schéma introuvable");
  } finally { console.log = log; }
});

test("inbox : fichiers et urls.txt vidés, échecs conservés, idempotent", async () => {
  const { inbox } = await import("./inbox");
  const { existsSync, readdirSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  const page = `<html><head><title>Page de test</title></head><body><article><h1>Page de test</h1>${"<p>Un paragraphe de remplissage assez long pour que l'extraction dépasse le seuil de cinquante mots exigé par cortex add, sans réseau.</p>".repeat(4)}</article></body></html>`;
  const srv = Bun.serve({ port: 0, fetch: (req) => new URL(req.url).pathname === "/ok" ? new Response(page, { headers: { "content-type": "text/html" } }) : new Response("non", { status: 404 }) });
  const sources = () => (existsSync(join(root, "raw")) ? readdirSync(join(root, "raw"), { recursive: true }) : []).filter((f) => String(f).endsWith("source.md")).length;
  const urls = join(root, "inbox/urls.txt");
  const [ok, ko] = [`${srv.url}ok`, `${srv.url}ko`];
  const log = console.log, err = console.error; // CLI outputs: muted
  const out: string[] = [];
  console.log = (...a) => void out.push(a.join(" ")); console.error = (...a) => void out.push(a.join(" "));
  try {
    expect(await inbox(root)).toBe(0); // inbox absent
    expect(out.at(-1)).toBe("Inbox vide.");

    await Bun.write(urls, `# commentaire\n\n${ok} pourquoi je garde ça\n${ko}\n`);
    await Bun.write(join(root, "inbox/avec.md"), "# Avec note\n\nUne idée sur la fermentation lactique des légumes.\n");
    await Bun.write(join(root, "inbox/avec.md.note"), "ma note\n");
    await Bun.write(join(root, "inbox/sans.txt"), "# Sans note\n\nUne autre idée sur la lacto-fermentation, très différente.\n");
    await Bun.write(join(root, "inbox/.gitkeep"), "");

    // dry-run: nothing moves
    expect(await inbox(root, { dryRun: true })).toBe(1);
    expect(sources()).toBe(0);
    expect(await Bun.file(urls).text()).toContain(ok);
    expect(existsSync(join(root, "inbox/avec.md.note"))).toBe(true);

    // real run: 3 sources, the failure (404) stays, comments kept
    expect(await inbox(root)).toBe(1);
    expect(sources()).toBe(3);
    expect(await Bun.file(urls).text()).toBe(`# commentaire\n\n${ko}\n`);
    expect(readdirSync(join(root, "inbox")).sort()).toEqual([".gitkeep", "urls.txt"]);
    const raws = (await import("./lib")).readDocs(root, "raw");
    expect((await raws).map((d) => d.fm.note).sort()).toEqual(["", "ma note", "pourquoi je garde ça"]);
    expect(out.some((l) => l.startsWith(`✗ ${ko}`))).toBe(true);

    // second run: only the failure comes back, nothing new
    expect(await inbox(root)).toBe(1);
    expect(sources()).toBe(3);

    // the URL already present leaves the inbox without a new source
    await Bun.write(urls, `${ok}\n`);
    expect(await inbox(root)).toBe(0);
    expect(await Bun.file(urls).text()).toBe("");
    expect(sources()).toBe(3);
  } finally { console.log = log; console.error = err; srv.stop(true); }
});

test("lint : erreurs bloquantes et avertissements", async () => {
  const { lint } = await import("./lint");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "wiki/concepts/a.md"),
    "---\ntype: Concept\ntitle: A\ndescription: D.\ngenerated: { by: x, at: 2026-11-04T11:00:00+01:00 }\nverified: { by: y, at: 2026-11-04T10:00:00+01:00 }\n---\nVoir [B](/wiki/concepts/b.md). Fait.[^z]\n");
  await Bun.write(join(root, "raw/2026/01/019b76ff-c400-7000-8000-000000000001/source.md"), "---\ntype: RawSource\ntitle: X\nfetched_at: 2026-01-01T00:00:00+01:00\nnote: \"\"\nstatus: pending\n---\nx\n");
  const msgs = (await lint(root, new Date("2026-11-04T12:00:00+01:00"))).map((i) => `${i.level} ${i.msg}`);
  expect(msgs).toContain("error lien cassé : /wiki/concepts/b.md");
  expect(msgs).toContain("error note [^z] sans entrée sources[]");
  expect(msgs.some((m) => m.startsWith("warning modifiée depuis la relecture"))).toBe(true);
  expect(msgs).toContain("warning note manquante : à demander avant de compiler");
  expect(msgs).toContain("warning en attente depuis plus de 7 jours");
});

test("garde-fou : écritures limitées à wiki/, Bash limité à cortex", async () => {
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

test("journal : parse et sérialise une entrée, champs vides omis, entrées invalides refusées", async () => {
  const { parseEntry, readLog } = await import("./log");
  const ok: any = { at: "2026-11-04T10:00:00+01:00", kind: "ingest", text: "Fait.", sources: ["01a1a5c9-5e80-7075-ae13-aab03b0a8697"], pages: ["wiki/concepts/a.md"] };
  expect(parseEntry(ok)).toEqual(ok);
  expect(parseEntry({ at: "2026-11-04", kind: "lint", text: "0 erreur" })).toEqual({ at: "2026-11-04", kind: "lint", text: "0 erreur" });
  for (const bad of [null, [], { ...ok, kind: "creation" }, { ...ok, at: "hier" }, { ...ok, at: "2026-13-45" }, { ...ok, at: "2026-11-04T10:00:00" }, { ...ok, text: "" }, { ...ok, text: "a\nb" },
    { ...ok, extra: 1 }, { ...ok, sources: [] }, { ...ok, sources: ["../x"] }, { ...ok, sources: ["a b"] }, { ...ok, pages: ["concepts/a.md"] }, { ...ok, pages: "wiki/a.md" }, { at: "2026-11-04", kind: "add" }])
    expect(typeof parseEntry(bad)).toBe("string");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "wiki/log.jsonl"), `${JSON.stringify(ok)}\n\nn'importe quoi\n{"at":"2026-11-04","kind":"zz","text":"x"}\n`);
  const r = readLog(root);
  expect(r.entries).toEqual([ok]);
  expect(r.errors).toEqual([{ line: 3, msg: "JSON invalide" }, { line: 4, msg: expect.stringContaining("kind") }]);
});

test("journal : log.md généré, déterministe, plus récent d'abord, références non répétées", async () => {
  const { renderLogMd } = await import("./log");
  const entries: any[] = [
    { at: "2026-11-03", kind: "update", text: "Ancien." },
    { at: "2026-11-04T09:00:00+01:00", kind: "add", text: "`01a1a5c9-5e80-7075-ae13-aab03b0a8697`.", sources: ["01a1a5c9-5e80-7075-ae13-aab03b0a8697"] },
    { at: "2026-11-04T10:00:00+01:00", kind: "ingest", text: "Créé sources/x, concepts/{a, c}.", sources: ["01a1a5c9-5e80-7075-ae13-aab03b0a8697"], pages: ["wiki/sources/x.md", "wiki/concepts/a.md", "wiki/concepts/c.md", "wiki/entities/b.md"] },
  ];
  const md = renderLogMd([...entries]);
  expect(md).toBe(`# Log

> Généré depuis \`wiki/log.jsonl\` : ne pas éditer à la main (\`cortex log add\`, puis \`cortex index\`).

## 2026-11-04
- **Ingest** Créé sources/x, concepts/{a, c}. (sources : \`01a1a5c9-5e80-7075-ae13-aab03b0a8697\` ; pages : [entities/b](/wiki/entities/b.md))
- **Add** \`01a1a5c9-5e80-7075-ae13-aab03b0a8697\`.

## 2026-11-03
- **Update** Ancien.
`);
  expect(renderLogMd([...entries])).toBe(md);
  expect(renderLogMd([])).toStartWith("# Log\n");
});

test("cortex log add : valide kind, pages et sources, écrit une ligne, régénère log.md ; cortex log lit", async () => {
  const { logAdd, readLog } = await import("./log");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  await Bun.write(join(root, "raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md"), "---\ntype: RawSource\n---\nx\n");
  await Bun.write(join(root, "wiki/concepts/a.md"), "---\ntype: Concept\n---\n");
  await Bun.write(join(root, "wiki/log.md"), "à écraser");
  await expect(logAdd(root, "creation", "x")).rejects.toThrow("kind inconnu");
  await expect(logAdd(root, "update", "  ")).rejects.toThrow("texte vide");
  await expect(logAdd(root, "update", "x", [], ["wiki/concepts/nope.md"])).rejects.toThrow("page introuvable");
  await expect(logAdd(root, "update", "x", [], ["wiki/../cortex.json"])).rejects.toThrow("page introuvable");
  await expect(logAdd(root, "update", "x", [], ["wiki/log.md"])).rejects.toThrow("page introuvable");
  await expect(logAdd(root, "update", "x", ["01a1a5c9-5e80-7075-ae13-000000000000"])).rejects.toThrow("source raw introuvable");
  await expect(logAdd(root, "update", "x", ["../../etc"])).rejects.toThrow("source raw introuvable");
  expect(existsSync(join(root, "wiki/log.jsonl"))).toBe(false); // no refusal writes
  const d = new Date("2026-11-04T10:00:00");
  const e = await logAdd(root, "ingest", "Ligne un\n  suite.", ["01a1a5c9-5e80-7075-ae13-aab03b0a8697", "01a1a5c9-5e80-7075-ae13-aab03b0a8697"], ["/wiki/concepts/a.md", "wiki/concepts/a.md"], d);
  expect(e).toMatchObject({ kind: "ingest", text: "Ligne un suite.", sources: ["01a1a5c9-5e80-7075-ae13-aab03b0a8697"], pages: ["wiki/concepts/a.md"] });
  await logAdd(root, "lint", "0 erreur.", [], [], new Date("2026-11-04T11:00:00"));
  const raw = await Bun.file(join(root, "wiki/log.jsonl")).text();
  expect(raw.split("\n")).toHaveLength(3); // two complete lines + newline
  expect(JSON.parse(raw.split("\n")[1])).not.toHaveProperty("sources"); // empty fields omitted
  expect(readLog(root).errors).toEqual([]);
  const md = await Bun.file(join(root, "wiki/log.md")).text();
  expect(md).toContain("## 2026-11-04\n- **Lint** 0 erreur.\n- **Ingest** Ligne un suite. (sources : `01a1a5c9-5e80-7075-ae13-aab03b0a8697` ; pages : [concepts/a](/wiki/concepts/a.md))\n");
  // file edited without a trailing newline: the next entry does not stick to the previous one
  await Bun.write(join(root, "wiki/log.jsonl"), raw.trimEnd());
  await logAdd(root, "update", "suite", [], [], d);
  expect(readLog(root).errors).toEqual([]);
  expect(readLog(root).entries).toHaveLength(3);

  // CLI
  const run = (...a: string[]) => Bun.spawnSync(["bun", join(import.meta.dir, "cortex.ts"), ...a], { env: { ...process.env, CORTEX_ROOT: root } });
  expect(run("log", "add", "update", "via la CLI ; | >", "--source", "01a1a5c9-5e80-7075-ae13-aab03b0a8697", "--page", "wiki/concepts/a.md").exitCode).toBe(0);
  expect(run("log", "add", "update", "x", "--page", "wiki/concepts/nope.md").exitCode).toBe(1);
  expect(run("log", "add", "update").exitCode).toBe(1);
  // `add` is the subcommand only right after `log`: the (read-only) agent guards rely on this order
  const count = () => readLog(root).entries.length, before = count();
  for (const a of [["log", "--json", "add", "update", "x"], ["log", "--", "add", "update", "x"], ["log", "--kind", "lint", "add", "update", "x"]]) {
    expect(run(...a).exitCode).toBe(1);
    expect(count()).toBe(before);
  }
  const j = JSON.parse(run("log", "--json", "--limit", "2").stdout.toString());
  expect(j.map((x: any) => x.text)).toEqual(["via la CLI ; | >", "suite"]);
  expect(JSON.parse(run("log", "--json", "--kind", "lint").stdout.toString()).map((x: any) => x.text)).toEqual(["0 erreur."]);
  expect(run("log", "--kind", "zz").exitCode).toBe(1);
  await Bun.write(join(root, "wiki/log.md"), "édité");
  expect(run("index").exitCode).toBe(0);
  expect(await Bun.file(join(root, "wiki/log.md")).text()).toContain("via la CLI ; | >"); // cortex index also regenerates log.md
});

test("lint du journal : ligne invalide = erreur, log.md édité à la main = avertissement", async () => {
  const { lint } = await import("./lint");
  const { writeLogMd } = await import("./log");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  const msgs = async () => (await lint(root)).map((i) => `${i.level} ${i.path} ${i.msg}`);
  expect(await msgs()).toEqual([]); // no journal: nothing to say
  await Bun.write(join(root, "wiki/log.jsonl"), '{"at":"2026-11-04","kind":"add","text":"x"}\n');
  expect(await msgs()).toEqual([expect.stringContaining("warning wiki/log.md diffère")]); // never generated
  await writeLogMd(root);
  expect(await msgs()).toEqual([]);
  await Bun.write(join(root, "wiki/log.md"), (await Bun.file(join(root, "wiki/log.md")).text()) + "- à la main\n");
  expect(await msgs()).toEqual([expect.stringContaining("warning wiki/log.md diffère")]);
  await writeLogMd(root);
  await Bun.write(join(root, "wiki/log.jsonl"), '{"at":"2026-11-04","kind":"add","text":"x"}\n{pas du json\n{"at":"2026-11-04","kind":"zz","text":"x"}\n');
  const m = await msgs();
  expect(m).toContain("error wiki/log.jsonl:2 JSON invalide");
  expect(m.some((x) => x.startsWith("error wiki/log.jsonl:3 kind"))).toBe(true);
});

test("cortex.json : absent = agnostique, client inconnu = erreur", async () => {
  const { loadConfig, backendFor } = await import("./backends/index");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  expect(await loadConfig(root)).toEqual({});
  await Bun.write(join(root, "cortex.json"), '{"client":"gpt"}');
  expect(loadConfig(root)).rejects.toThrow("client inconnu");
  await Bun.write(join(root, "cortex.json"), '{"client":"opencode"}');
  expect((await backendFor(root)).interactive("p")).toEqual(["opencode", "--model", "opencode/big-pickle", "--prompt", "p"]);
  // effort: translated into each CLI's vocabulary
  const it = async (cfg: object) => { await Bun.write(join(root, "cortex.json"), JSON.stringify(cfg)); return (await backendFor(root)).interactive("p"); };
  expect(await it({ client: "opencode", effort: "high" })).toEqual(["opencode", "--model", "opencode/big-pickle#high", "--prompt", "p"]);
  expect(await it({ client: "claude", model: "opus", effort: "max" })).toEqual(["claude", "--model", "opus", "--effort", "max", "p"]);
  expect(await it({ client: "codex", effort: "low" })).toEqual(["codex", "-c", 'model_reasoning_effort="low"', "p"]);
  await Bun.write(join(root, "cortex.json"), "{}");
  expect((await backendFor(root)).interactive("p")).toEqual(["claude", "p"]);
});

test("cortex config : init, set, get, remove, lint", async () => {
  const { configCmd, lintConfig, loadConfig } = await import("./backends/index");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  const log = console.log; console.log = () => {};
  try {
    expect(await configCmd(root, ["init"])).toBe(0);
    expect(await loadConfig(root)).toEqual({}); // all-null skeleton: agnostic
    expect(configCmd(root, ["init"])).rejects.toThrow("existe déjà");
    await configCmd(root, ["set", "client", "codex"]);
    await configCmd(root, ["set", "effort", "low"]);
    expect(configCmd(root, ["set", "effort", "turbo"])).rejects.toThrow("invalide pour codex");
    expect(configCmd(root, ["set", "couleur", "x"])).rejects.toThrow("Propriété attendue");
    expect(await loadConfig(root)).toEqual({ client: "codex", effort: "low" });
    await configCmd(root, ["remove", "effort"]);
    expect(await loadConfig(root)).toEqual({ client: "codex" });
    await Bun.write(join(root, "cortex.json"), "{ pas du json");
    expect(await configCmd(root, ["lint"])).toBe(1);
  } finally { console.log = log; }
  expect(lintConfig({ client: "opencode", effort: "n'importe" })).toEqual([]); // model-specific variant
  expect(lintConfig({ effort: "high" })[0].level).toBe("warning");
  expect(lintConfig([])[0].level).toBe("error");
});

test("recherche : index inversé (exact, préfixe, faute), filtres, phrases, classement, instantanée à grande échelle", async () => {
  const { buildTerms, createEngine, expand, rank } = await import("../site/src/lib/search-engine");
  const { parseQuery } = await import("../site/src/lib/query");
  const Fuse = (await import("fuse.js")).default;
  const doc = (id: string, title: string, text: string, tags: string[] = [], type = "Concept") =>
    ({ id, title, description: "", type, tags, status: "stable", verified: true, text });
  const docs = [
    doc("a", "Context rot", "La fenêtre de contexte se dégrade."),
    doc("b", "Harnais", "Un long texte. ".repeat(2000) + "Le contexte compte aussi ici.", ["llm"]),
    doc("c", "Décentralisation", "Le fédivers et Mastodon.", ["reseau"], "Entity"),
    doc("d", "Constructor", "Le constructor et toString d'une classe."), // words that are also Object properties
  ];
  const e = createEngine({ docs, terms: buildTerms(docs), vocab: [] }, Fuse);
  const ids = (q: string) => rank(e, parseQuery(q), () => false).map((r) => r.doc.id);
  expect(ids("contexte")).toEqual(["a", "b"]); // word at the end of a long page found; « Context » in the title ranks a first
  expect(ids("conte")).toContain("b"); // prefix while typing
  expect(ids("contexet")).toContain("a"); // typo
  expect(ids("dégrade")).toEqual(["a"]); // known word: no fuzziness (« degrade » does not bring back an approximate neighbor)
  expect([...expand(e, "fenetre").keys()]).toEqual(["fenetre"]);
  expect(ids("decentralisation")).toEqual(["c"]); // accents ignored
  expect(ids("contexte #llm")).toEqual(["b"]);
  expect(ids("contexte -fenetre")).toEqual(["b"]);
  expect(ids('"fediverse"')).toEqual([]);
  expect(ids('"le federivers"')).toEqual([]);
  expect(ids('"et mastodon"')).toEqual(["c"]);
  expect(ids("type:entity")).toEqual(["c"]);
  expect(ids("constructor")).toEqual(["d"]);
  expect(ids("tostring")).toEqual(["d"]);
  expect(ids("hasownproperty")).toEqual([]);

  // ~3,000 pages of ~1,500 characters: each query must stay instantaneous
  const words = Array.from({ length: 4000 }, (_, i) => `mot${i.toString(36)}`);
  const big = Array.from({ length: 3000 }, (_, i) => doc(`p${i}`, `Page ${i}`, Array.from({ length: 200 }, (_, k) => words[(i * 7 + k * 13) % words.length]).join(" ")));
  const E = createEngine({ docs: big, terms: buildTerms(big), vocab: [] }, Fuse);
  rank(E, parseQuery("motzz"), () => false); // builds the fuzzy index once
  let worst = 0;
  for (const q of ["mot1a", "mot2 mot3b", "motab", "page 12", "mot1q mot2r mot3s"]) {
    const t = performance.now(); rank(E, parseQuery(q), () => false); worst = Math.max(worst, performance.now() - t);
  }
  expect(worst).toBeLessThan(200); // ~10 ms in practice; margin for a loaded machine (the old engine: ~900 ms)
});

test("export : ancres de titres lisibles, uniques, sans collision avec les ids de l'interface", async () => {
  const { anchors } = await import("./export");
  const ids = (m: string) => [...anchors(Bun.markdown.html(m)).matchAll(/<h\d id="([^"]+)"/g)].map((x) => x[1]);
  expect(ids("## Où ça ? Détail\n\n## Où ça ? Détail\n\n## Où ça ? Détail")).toEqual(["ou-ca-detail", "ou-ca-detail-1", "ou-ca-detail-2"]);
  expect(ids("## Contenu principal\n\n## Src x\n\n## Fn y\n\n## H notes\n\n## ???\n\n### 日本語")).toEqual(["t-contenu-principal", "t-src-x", "t-fn-y", "t-h-notes", "titre", "日本語"]);
  expect(anchors("<h2 id=\"x\">Un <em>titre</em> &amp; un autre</h2>")).toBe('<h2 id="un-titre-un-autre">Un <em>titre</em> &amp; un autre</h2>');
});

test("recherche : suggestions de titres et résultats obéissent aux mêmes conditions, total exact", async () => {
  const { buildTerms, createEngine, rank, search, suggest, suggestTitles } = await import("../site/src/lib/search-engine");
  const { parseQuery } = await import("../site/src/lib/query");
  const Fuse = (await import("fuse.js")).default;
  const doc = (id: string, title: string, tags: string[], type = "Concept", text = "") =>
    ({ id, title, description: "", type, tags, status: "stable", verified: true, text });
  const docs = [
    doc("a", "Harnais d'agent", ["llm"]),
    doc("b", "Hermes Agent", ["outil"], "Entity", "un agent qui apprend"),
    doc("c", "Harnais de test", ["llm"]),
    doc("d", "Agent Skills", ["llm"], "Concept", "le format open source des agents"),
    ...Array.from({ length: 120 }, (_, i) => doc(`p${i}`, `Page ${i}`, [], "Source", "bruit")),
  ];
  const e = createEngine({ docs, terms: buildTerms(docs), vocab: [] }, Fuse);
  const none = (_id: string) => false, fav = (id: string) => id === "d";
  const titles = (q: string, isFav = none) => suggestTitles(e, parseQuery(q), isFav).map((d) => d.id);
  const found = (q: string, isFav = none) => rank(e, parseQuery(q), isFav).map((r) => r.doc.id);

  expect(titles("har")).toEqual(["a", "c"]);
  expect(titles("har -agent")).toEqual(["c"]); // exclusion: no more « Harnais d'agent »
  expect(titles("-agent")).toEqual([]); // without a free word, no title
  expect(titles("#llm har")).toEqual(["a", "c"]);
  expect(titles("type:entity age")).toEqual(["b"]); // structured filter
  expect(titles('age "format open"')).toEqual(["d"]); // exact phrase
  expect(titles("age is:fav", fav)).toEqual(["d"]);
  expect(titles("age is:fav")).toEqual([]);
  // consistency: every suggested title appears among the results of the same query
  for (const q of ["har", "har -agent", "#llm har", "type:entity age", 'age "format open"', "-#llm age", "age -type:concept"])
    for (const id of titles(q)) expect(found(q)).toContain(id);
  expect(suggest(e, "har -agent", none).titles.map((d) => d.id)).toEqual(["c"]);

  // exact total beyond the limit, excerpts only up to the limit
  const r = search(e, "type:source", none, 50);
  expect([r.hits.length, r.total]).toEqual([50, 120]);
  expect(search(e, "  ", none, 50)).toEqual({ hits: [], total: 0 });
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
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "wiki/.keep"), "");
  await Bun.write(join(root, "raw/.keep"), "");
  const sh = (mode: "read" | "write", f: string) =>
    Bun.spawnSync(confine(root, ["sh", "-c", `touch ${join(root, f)}`], mode), { stderr: "pipe" }).exitCode;
  expect(sh("write", "wiki/ok.md")).toBe(0);
  expect(sh("write", "raw/non.md")).not.toBe(0);
  expect(sh("write", "cortex.json")).not.toBe(0);
  expect(sh("read", "wiki/non.md")).not.toBe(0);
});

/** Throwaway root: 3 wiki pages linked by links, tags and a shared source, plus a raw source. */
async function mcpRoot() {
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  const res = "/raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md";
  const page = (type: string, title: string, tags: string, body: string) =>
    `---\ntype: ${type}\ntitle: ${title}\ndescription: D ${title}.\ntags: [${tags}]\nsources:\n  - id: x\n    resource: ${res}\n    title: X\n---\n${body}\n`;
  await Bun.write(join(root, "cortex.json"), "{}");
  await Bun.write(join(root, "raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md"), "---\ntype: RawSource\ntitle: X\nnote: n\nstatus: compiled\n---\nUn texte sur le zythum.\n");
  await Bun.write(join(root, "wiki/concepts/a.md"), page("Concept", "Alpha", "llm, ctx", "Voir [B](/wiki/concepts/b.md)."));
  await Bun.write(join(root, "wiki/concepts/b.md"), page("Concept", "Beta", "ctx", "Rien."));
  await Bun.write(join(root, "wiki/entities/c.md"), page("Entity", "Gamma", "llm", "Voir [A](/wiki/concepts/a.md#x)."));
  await Bun.write(join(root, "wiki/index.md"), "# Index\n- [Alpha](/wiki/concepts/a.md)\n- [Beta](/wiki/concepts/b.md)\n- [Gamma](/wiki/entities/c.md)\n");
  await Bun.write(join(root, "wiki/log.jsonl"), '{"at":"2026-11-03","kind":"add","text":"y"}\n{"at":"2026-11-04T09:00:00+01:00","kind":"lint","text":"0 erreur"}\n{"at":"2026-11-04T10:00:00+01:00","kind":"add","text":"x","sources":["01a1a5c9-5e80-7075-ae13-aab03b0a8697"]}\n');
  return root;
}

test("related : liens, rétroliens, sources et tags, classés par force", async () => {
  const { related } = await import("./mcp");
  const { readDocs } = await import("./lib");
  const docs = await readDocs(await mcpRoot(), "wiki");
  const a = related(docs, "/wiki/concepts/a.md");
  // B: outgoing link 3 + source 2 + tag ctx 1 = 6; C: incoming link 3 + source 2 + tag llm 1 = 6; index.md excluded
  expect(a.map((r) => r.path)).toEqual(["wiki/concepts/b.md", "wiki/entities/c.md"]);
  expect(a[0]).toMatchObject({ score: 6, reasons: ["lien sortant", "source partagée : /raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md", "tag partagé : ctx"] });
  expect(a[1].reasons).toContain("lien entrant");
  // no direct link: only the shared source (B and C have no common tag)
  expect(related(docs, "wiki/concepts/b.md").map((r) => [r.path, r.score])).toEqual([["wiki/concepts/a.md", 6], ["wiki/entities/c.md", 2]]);
  expect(() => related(docs, "/wiki/concepts/nope.md")).toThrow("introuvable");
});

test("get : refuse tout chemin hors de wiki/ et raw/", async () => {
  const { getFile } = await import("./mcp");
  const { symlinkSync } = await import("node:fs");
  const root = await mcpRoot();
  await Bun.write(join(root, "secret.md"), "secret");
  symlinkSync("../secret.md", join(root, "wiki/piege.md")); // link that leaves wiki/
  expect(await getFile(root, "/wiki/concepts/b.md")).toContain("Beta");
  expect(await getFile(root, "wiki/concepts/b.md")).toContain("Beta");
  expect(await getFile(root, "raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md")).toContain("zythum");
  for (const p of ["cortex.json", "secret.md", "wiki/../secret.md", "/wiki/../secret.md", "wiki/piege.md", "/etc/passwd", "../x.md"])
    expect(getFile(root, p)).rejects.toThrow();
  expect(getFile(root, "wiki/concepts")).rejects.toThrow("introuvable"); // a folder is not a file
});

test("lastLog : entrées structurées des derniers jours, filtre par kind", async () => {
  const { lastLog } = await import("./mcp");
  const root = await mcpRoot();
  expect(lastLog(root, 1).map((e) => e.text)).toEqual(["x", "0 erreur"]); // most recent first
  expect(lastLog(root, 1)[0]).toMatchObject({ kind: "add", sources: ["01a1a5c9-5e80-7075-ae13-aab03b0a8697"] });
  expect(lastLog(root, 5).map((e) => e.text)).toEqual(["x", "0 erreur", "y"]);
  expect(lastLog(root, 5, "lint").map((e) => e.text)).toEqual(["0 erreur"]);
});

test("cortex mcp : initialize, tools/list, search, get, add sans réseau (JSON-RPC sur stdio)", async () => {
  const root = await mcpRoot();
  const proc = Bun.spawn(["bun", join(import.meta.dir, "cortex.ts"), "mcp"], {
    env: { ...process.env, CORTEX_ROOT: root }, stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  const send = (m: object) => { proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n"); proc.stdin.flush(); };
  const reader = proc.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  const recv = async (id: number) => {
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        const msg = JSON.parse(buf.slice(0, nl)); // a line outside the protocol on stdout would make this parse fail
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
    expect((await recv(1)).result.serverInfo.name).toBe("cortex");
    send({ method: "notifications/initialized" });

    send({ id: 2, method: "tools/list" });
    expect((await recv(2)).result.tools.map((t: any) => t.name).sort()).toEqual(["add", "get", "lint", "log", "related", "search"]);

    const s = await call(3, "search", { q: "zythum" });
    expect(JSON.parse(s.content[0].text).hits[0]).toMatchObject({ area: "raw", path: "/raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md" });
    expect(JSON.parse(s.content[0].text).hint).toContain("trou");
    expect((await call(4, "get", { path: "/wiki/concepts/b.md" })).content[0].text).toContain("Beta");
    expect((await call(5, "get", { path: "wiki/../cortex.json" })).isError).toBe(true);
    expect((await call(6, "add", { text: "# Idée\n\nUn texte qui parle de houblon.", note: "" })).isError).toBe(true);
    const added = JSON.parse((await call(7, "add", { text: "# Idée\n\nUn texte qui parle de houblon.", note: "test" })).content[0].text);
    expect(added).toMatchObject({ duplicate: false, title: "Idée" });
    expect(JSON.parse((await call(8, "add", { text: "# Idée\n\nUn texte qui parle de houblon.", note: "test" })).content[0].text).id).toBe(added.id);
    expect((await call(10, "add", { input: "/etc/hostname", note: "fuite" })).isError).toBe(true); // no local file via MCP
    const today = JSON.parse((await call(9, "log", { kind: "add" })).content[0].text);
    expect(today[0]).toMatchObject({ kind: "add", sources: [added.id] });
    expect(today.every((e: any) => e.kind === "add")).toBe(true);
    expect((await call(11, "log", { kind: "inconnu" })).isError).toBe(true);
    expect((await call(10, "related", { path: "/wiki/concepts/a.md" })).content[0].text).toContain("wiki/concepts/b.md");
  } finally { proc.stdin.end(); proc.kill(); }
});

test("requête de recherche : filtres, guillemets, exclusions, accents", async () => {
  const { parseQuery, matches, removeToken, canonType, isEmpty, chips, wantsFav } = await import("../site/src/lib/query");
  const p = parseQuery(`context  #Mémoire tag:LLM type:Synthèses status:draft is:fav "Phrase Exacte" -rot -#vieux -"à éviter" -type:source`);
  expect(p.words).toEqual(["context"]);
  expect(p.ops.map((o) => [o.key, o.value, o.neg])).toEqual([
    ["tag", "memoire", false], ["tag", "llm", false], ["type", "Synthesis", false], ["status", "draft", false], ["is", "fav", false],
    ["tag", "vieux", true], ["type", "Source", true],
  ]);
  expect(p.phrases.map((x) => x.text)).toEqual(["phrase exacte"]);
  expect(p.exclude.map((x) => x.text)).toEqual(["rot", "a eviter"]);
  expect(canonType("entités")).toBe("Entity");
  // unknown key = ordinary word; hyphen inside a word ≠ exclusion; empty query
  expect(parseQuery("foo:bar chain-of-thought").words).toEqual(["foo", "bar", "chain", "of", "thought"]);
  expect(parseQuery("chain-of-thought").exclude).toEqual([]);
  expect(isEmpty(parseQuery("  "))).toBe(true);
  // unclosed quote: blocks nothing
  expect(parseQuery('"jamais fermé').words).toEqual(["jamais", "ferme"]);
  // removal of a chip
  expect(removeToken("a #tag b", "#tag")).toBe("a b");
  // repeated filter: a single chip (unique key), which removes all its occurrences; removal by whole token
  const labels = (q: string) => chips(parseQuery(q)).map((c) => c.label);
  expect(labels("#llm #llm")).toEqual(["#llm"]);
  expect(labels("#llm tag:LLM")).toEqual(["#llm"]);
  expect(labels("-x -x type:source -type:source -#llm #llm")).toEqual(["type:Source", "sans type:Source", "sans #llm", "#llm", "sans x"]);
  expect(labels('"a b" "a b"')).toEqual(["« a b »"]);
  expect(chips(parseQuery("#llm x #llm"))[0].raws).toEqual(["#llm", "#llm"]);
  expect(removeToken("#llm x #llm", "#llm")).toBe("x");
  expect(removeToken("#llm2 #llm", "#llm")).toBe("#llm2");
  expect(removeToken('a "b c" d', '"b c"')).toBe("a d");
  expect(removeToken("a -x.y b", "-x.y")).toBe("a b");
  expect(wantsFav(parseQuery("x is:fav"))).toBe(true);
  expect(wantsFav(parseQuery("-is:fav"))).toBe(false);

  const doc = { id: "concepts/a", title: "Mémoire vive", description: "RAM", type: "Concept", tags: ["Matériel", "ram"], status: "stable", verified: false, text: "La mémoire coûte cher en 2026." };
  const ok = (q: string, fav = false) => matches(doc, parseQuery(q), () => fav);
  expect(ok("#materiel type:concept status:stable")).toBe(true); // tag without accent, type in lowercase
  expect(ok("type:source")).toBe(false);
  expect(ok("-type:source -#absent")).toBe(true);
  expect(ok("-#ram")).toBe(false);
  expect(ok("is:unverified")).toBe(true);
  expect(ok("is:fav")).toBe(false);
  expect(ok("is:favoris", true)).toBe(true);
  expect(ok('"coute cher"')).toBe(true); // exact phrase, without accents
  expect(ok('"cher coute"')).toBe(false);
  expect(ok("-cher")).toBe(false);
  expect(ok("-prix")).toBe(true);
});

test("export : site statique, liens réécrits, notes reliées, raw/ non publié, index de recherche", async () => {
  const { existsSync, readdirSync, readFileSync, statSync } = await import("node:fs");
  const { exportSite, checkOut } = await import("./export");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  const fm = (t: string, title: string, extra = "") => `---\ntype: ${t}\ntitle: ${title}\ndescription: Description de ${title}.\ntags: [alpha]\nstatus: stable\ngenerated: { by: test, at: 2026-11-04T10:00:00+01:00 }\n${extra}---\n`;
  const src = `sources:\n  - id: s1\n    resource: /raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md\n    title: "Source un"\n`;
  await Bun.write(join(root, "cortex.json"), "{}");
  await Bun.write(join(root, "raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md"), "---\ntype: RawSource\ntitle: Source un\nurl: https://exemple.org/article\nnote: n\nstatus: compiled\n---\nSECRET-DU-CORPS-RAW\n");
  await Bun.write(join(root, "wiki/concepts/a.md"), fm("Concept", "Alpha", src) + "Voir [Beta](/wiki/concepts/b.md#x) et [Gamma](/wiki/entities/c.md), [futur](/wiki/concepts/absent.md). Un fait.[^s1]\n\n## Première partie\n\nEncore un fait.[^s1] Et un autre.[^s1]\n\n### Détail\n\n## Première partie\n\n## Notes\n\n[^s1]: précision *utile*\n");
  await Bun.write(join(root, "wiki/concepts/b.md"), fm("Concept", "Béta") + "Retour vers [Alpha](/wiki/concepts/a.md).\n\n" + "Remplissage. ".repeat(600) + "Motlointain en fin de page.\n"); // ~7,800 characters
  await Bun.write(join(root, "wiki/entities/c.md"), fm("Entity", "Gamma") + "Isolé. [Accueil](/wiki/index.md), [journal](/wiki/log.md).\n");
  await Bun.write(join(root, "wiki/sources/s.md"), fm("Source", "Source un", src) + "> [!note] Note personnelle\n> pourquoi je garde ça\n\nRésumé, voir [Alpha](/wiki/concepts/a.md).\n");
  await Bun.write(join(root, "wiki/index.md"), "# Index\n");
  await Bun.write(join(root, "wiki/log.jsonl"), [
    { at: "2026-11-03", kind: "update", text: "Un [lien](/wiki/concepts/a.md) et **gras**." },
    { at: "2026-11-04T09:30:00+01:00", kind: "ingest", text: "`01a1a5c9-5e80-7075-ae13-aab03b0a8697` compilée.", sources: ["01a1a5c9-5e80-7075-ae13-aab03b0a8697"], pages: ["wiki/concepts/a.md", "wiki/concepts/absente.md"] },
    { at: "2026-11-04T11:00:00+01:00", kind: "add", text: "Ajout.", sources: ["01a1a5c9-5e80-7075-ae13-aab03b0a8697", "01a1a5c9-5e80-7075-ae13-0000000000ff"] },
  ].map((e) => JSON.stringify(e)).join("\n") + "\n");

  expect(() => checkOut(root, root)).toThrow("refusé");
  expect(() => checkOut(root, join(root, "wiki"))).toThrow("refusé");
  await Bun.write(join(root, "documents/notes.txt"), "à ne jamais vider");
  expect(() => checkOut(root, join(root, "documents"))).toThrow("ne ressemble pas à un export"); // non-empty folder without _app/
  const out = join(root, ".cortex/site");
  process.env.SOURCE_DATE_EPOCH = "1793790000"; // export time frozen: two exports stay byte-identical
  await exportSite(root, out, () => {});

  const html = (p: string) => readFileSync(join(out, p), "utf8");
  for (const p of ["index.html", "graph/index.html", "log/index.html", "tags/index.html", "tags/alpha/index.html", "search/index.html", "wiki/concepts/a/index.html", "wiki/concepts/b/index.html", "wiki/entities/c/index.html", "wiki/sources/s/index.html"])
    expect(existsSync(join(out, p))).toBe(true);
  const a = html("wiki/concepts/a/index.html");
  expect(a).toContain('href="../b/#x"'); // link rewritten, relative
  expect(a).toContain('href="../../entities/c/"');
  expect(a).toContain('class="lien-manquant"'); // missing page: no dead link
  expect(a).not.toMatch(/href="[^"]*\.md/);
  expect(a).toContain('href="#fn-s1"'); // note [^s1] numbered, linked to sources[]
  expect(a).toContain('id="fn-s1"');
  expect(a).toContain('href="#src-s1"');
  expect(a).toContain("<em>utile</em>");
  // note cited three times: one anchor per occurrence, and a ↩ back-link to each (not only the first)
  for (const k of [1, 2, 3]) {
    expect(a).toContain(`id="fnref-s1-${k}"`);
    expect(a).toContain(`href="#fnref-s1-${k}"`);
  }
  expect(a).not.toContain('id="fnref-s1-4"');
  expect(a).toContain("Retour à l'occurrence 2 sur 3");
  expect(a).toContain('href="https://exemple.org/article"'); // source: original URL, not the raw path
  expect(a).not.toContain("/raw/");
  expect(a).toContain("Rétroliens");

  const c = html("wiki/entities/c/index.html");
  expect(c).toContain('href="../../../"'); // /wiki/index.md → home
  expect(c).toContain('href="../../../log/"'); // /wiki/log.md → journal
  // journal: structured entries, most recent first; cited pages as links, source → wiki Source page, otherwise id as text
  const log = JSON.parse(readFileSync(join(root, ".cortex/site-data/data.json"), "utf8")).log;
  expect(log.map((e: any) => [e.at.slice(0, 10), e.kind])).toEqual([["2026-11-04", "add"], ["2026-11-04", "ingest"], ["2026-11-03", "update"]]);
  expect(log[1].pages).toEqual([{ id: "concepts/a", title: "Alpha", type: "Concept" }]); // the missing page is dropped
  expect(log[1].sources).toEqual([]); // the id is already named in the text
  expect(log[1].html).toContain('<a href="../wiki/sources/s/"><code>01a1a5c9-5e80-7075-ae13-aab03b0a8697</code></a>');
  expect(log[0].sources).toEqual([{ id: "01a1a5c9-5e80-7075-ae13-aab03b0a8697", page: { id: "sources/s", title: "Source un", type: "Source" } }, { id: "01a1a5c9-5e80-7075-ae13-0000000000ff" }]);
  expect(log[2].html).toBe('Un <a href="../wiki/concepts/a/">lien</a> et <strong>gras</strong>.');
  const logPage = html("log/index.html");
  for (const t of ["Journal", "Ajout.", "Alpha", "Source un", "01a1a5c9-5e80-7075-ae13-0000000000ff", "3 entrées"]) expect(logPage).toContain(t);
  expect(logPage.indexOf("Ajout.")).toBeLessThan(logPage.indexOf("</code></a> compilée")); // the 11:00 add before the 09:30 ingest
  const out2 = join(root, "site2");
  await exportSite(root, out2, () => {}); // reproducible: same wiki, same site
  const files = (d: string) => (readdirSync(d, { recursive: true }) as string[]).filter((f) => statSync(join(d, f)).isFile()).sort();
  expect(files(out2)).toEqual(files(out));
  for (const f of files(out)) expect(readFileSync(join(out2, f), "utf8")).toBe(readFileSync(join(out, f), "utf8"));

  // offline: the service worker precaches the pages, their data, the search index and the graph (compared above: reproducible)
  const sw = html("service-worker.js");
  for (const p of ["graph.json", "search-index.json", "wiki/concepts/a/", "wiki/concepts/a/__data.json", "_app/immutable/"]) expect(sw).toContain(p);

  const graph = JSON.parse(html("graph.json"));
  expect(graph.nodes.map((n: any) => n.id).sort()).toEqual(["concepts/a", "concepts/b", "entities/c", "sources/s"]);
  expect(graph.nodes.find((n: any) => n.id === "concepts/a")).toMatchObject({ type: "Concept", tags: ["alpha"], degree: 3 });
  expect(graph.links).toHaveLength(3); // a-b (links in both directions: a single edge), a-c, s-a
  expect(graph.links.filter((l: any) => [l.source, l.target].sort().join() === "concepts/a,concepts/b")).toHaveLength(1);
  expect(graph.links.some((l: any) => l.target === "concepts/absent")).toBe(false);

  const idx = JSON.parse(html("search-index.json"));
  const s = idx.docs.find((d: any) => d.id === "sources/s");
  expect(s.text).toContain("pourquoi je garde ça"); // content of the callout indexed…
  expect(s.text).not.toContain("Note personnelle"); // …but not its title
  expect(idx.docs).toHaveLength(4);
  expect(idx.terms.motlointain).toEqual([idx.docs.findIndex((d: any) => d.id === "concepts/b")]); // inverted index over the whole content
  expect(idx.vocab).toContain("alpha");
  expect(idx.docs.find((d: any) => d.id === "concepts/b").text).toContain("Motlointain"); // full content indexed, not an excerpt

  // « Copier le Markdown »: the page source, frontmatter included, raw/ path replaced by the original URL
  const pageA = JSON.parse(readFileSync(join(root, ".cortex/site-data/data.json"), "utf8")).pages.find((x: any) => x.id === "concepts/a");
  expect(pageA.md).toStartWith("---\ntype: Concept\ntitle: Alpha");
  expect(pageA.md).toContain("resource: https://exemple.org/article");
  expect(pageA.md).toContain("Voir [Beta](/wiki/concepts/b.md#x)");
  // table of contents: h2/h3 headings with stable anchors (duplicate suffixed), reused by the HTML ids; occurrence count per note
  expect(pageA.toc.map((t: any) => [t.level, t.id, t.text])).toEqual([[2, "premiere-partie", "Première partie"], [3, "detail", "Détail"], [2, "premiere-partie-1", "Première partie"], [2, "notes", "Notes"]]);
  for (const t of pageA.toc) expect(pageA.html).toContain(`id="${t.id}"`);
  expect(pageA.notes[0]).toMatchObject({ id: "s1", refs: 3 });
  expect(a).toContain('href="#premiere-partie-1"'); // four headings: the table of contents is shown (threshold > 3)
  expect(JSON.parse(readFileSync(join(root, ".cortex/site-data/data.json"), "utf8")).pages.find((x: any) => x.id === "entities/c").toc).toEqual([]);
  // no raw/ data beyond the original URL, anywhere in the site
  const all = (readdirSync(out, { recursive: true }) as string[]).filter((f) => statSync(join(out, f)).isFile());
  for (const f of all) {
    const t = readFileSync(join(out, f), "utf8");
    expect(t).not.toContain("SECRET-DU-CORPS-RAW");
    if (!f.startsWith("log/")) expect(t).not.toContain("01a1a5c9-5e80-7075-ae13-aab03b0a8697"); // the journal names raw ids in its text
  }
}, 120_000);

test("graphe : taille des nœuds bornée, libellés sans collision, hiérarchisés, rapides à 2 000 nœuds", async () => {
  const { labelBudget, placeLabels, screenRadius } = await import("../site/src/lib/graph-labels");
  for (const k of [0.05, 1, 12, 1000]) expect(screenRadius(30, k)).toBeLessThanOrEqual(14); // never huge, whatever the zoom
  expect(screenRadius(0, 0.01)).toBeGreaterThanOrEqual(2.5); // nor invisible
  expect(screenRadius(25, 0.01)).toBeGreaterThan(screenRadius(1, 0.01)); // degree stays readable when zoomed out
  expect(labelBudget(342, 590, 0.5)).toBeLessThan(labelBudget(1200, 700, 4)); // more labels on a large screen and when zooming in
  expect(labelBudget(4000, 4000, 100)).toBe(150);

  type T = { id: string; x: number; y: number; force?: boolean };
  const it = (id: string, x: number, y: number, force = false): T => ({ id, x, y, force });
  const rect = (t: T) => ({ x: t.x, y: t.y, w: 80, h: 16, force: t.force });
  const ids = (a: T[]) => a.map((t) => t.id);
  // priority: the first wins, the overlapping one is dropped, the distant neighbor is kept
  expect(ids(placeLabels([it("a", 0, 0), it("b", 40, 5), it("c", 200, 0)], rect, 10))).toEqual(["a", "c"]);
  expect(ids(placeLabels([it("a", 0, 0), it("c", 200, 0), it("d", 400, 0)], rect, 2))).toEqual(["a", "c"]); // cap
  expect(ids(placeLabels([it("a", 0, 0), it("f", 20, 0, true)], rect, 10))).toEqual(["a", "f"]); // `force` always kept
  expect(ids(placeLabels([it("a", 0, 0), it("b", 0, 40), it("h", -999, 0)], (t) => (t.id === "h" ? null : rect(t)), 10))).toEqual(["a", "b"]); // off-screen dropped
  expect(ids(placeLabels([it("a", -250, -40), it("b", -190, -30)], rect, 10))).toEqual(["a"]); // grid with negative coordinates: overlap detected
  // 2,000 nodes on a screen: no overlap, cap respected, a few milliseconds
  const many = Array.from({ length: 2000 }, (_, i) => it(`n${i}`, (i * 37) % 1200, (i * 91) % 700));
  const t0 = performance.now();
  const kept = placeLabels(many, rect, labelBudget(1200, 700, 1));
  expect(performance.now() - t0).toBeLessThan(20);
  expect(kept.length).toBeLessThanOrEqual(labelBudget(1200, 700, 1));
  for (const a of kept) for (const b of kept) if (a !== b) expect(a.x < b.x + 80 && b.x < a.x + 80 && a.y < b.y + 16 && b.y < a.y + 16).toBe(false);
});
