import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The export test freezes SOURCE_DATE_EPOCH: put the environment back so later tests are unaffected.
const epoch0 = process.env.SOURCE_DATE_EPOCH;
afterEach(() => { if (epoch0 === undefined) delete process.env.SOURCE_DATE_EPOCH; else process.env.SOURCE_DATE_EPOCH = epoch0; });

test("export: readable unique heading anchors, no collision with UI ids", async () => {
  const { anchors } = await import("./export");
  const ids = (m: string) => [...anchors(Bun.markdown.html(m)).matchAll(/<h\d id="([^"]+)"/g)].map((x) => x[1]);
  expect(ids("## Où ça ? Détail\n\n## Où ça ? Détail\n\n## Où ça ? Détail")).toEqual(["ou-ca-detail", "ou-ca-detail-1", "ou-ca-detail-2"]);
  expect(ids("## Main content\n\n## Src x\n\n## Fn y\n\n## H notes\n\n## ???\n\n### 日本語")).toEqual(["t-main-content", "t-src-x", "t-fn-y", "t-h-notes", "section", "日本語"]);
  expect(anchors("<h2 id=\"x\">Un <em>titre</em> &amp; un autre</h2>")).toBe('<h2 id="un-titre-un-autre">Un <em>titre</em> &amp; un autre</h2>');
});

test("export: « Note personnelle » callout (Obsidian)", async () => {
  const { noteCallouts } = await import("./export");
  const html = (m: string) => noteCallouts(Bun.markdown.html(m));
  expect(html("> [!note] Note personnelle\n> pourquoi *je* garde ça")).toBe('<aside class="personal-note" role="note"><p class="personal-note-title">Note personnelle</p><p>pourquoi <em>je</em> garde ça</p>\n</aside>\n');
  expect(html("> [!note]\n> sans titre")).toContain('<p class="personal-note-title">Personal note</p><p>sans titre');
  expect(html("> une citation ordinaire")).toContain("<blockquote>");
});

test("export: static site, rewritten links, linked notes, raw/ not published, search index", async () => {
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
    { at: "2026-11-04T09:30:00+01:00", kind: "ingest", text: "`01a1a5c9-5e80-7075-ae13-aab03b0a8697` compiled.", sources: ["01a1a5c9-5e80-7075-ae13-aab03b0a8697"], pages: ["wiki/concepts/a.md", "wiki/concepts/absente.md"] },
    { at: "2026-11-04T11:00:00+01:00", kind: "add", text: "Ajout.", sources: ["01a1a5c9-5e80-7075-ae13-aab03b0a8697", "01a1a5c9-5e80-7075-ae13-0000000000ff"] },
  ].map((e) => JSON.stringify(e)).join("\n") + "\n");

  expect(() => checkOut(root, root)).toThrow("refused");
  expect(() => checkOut(root, join(root, "wiki"))).toThrow("refused");
  await Bun.write(join(root, "documents/notes.txt"), "à ne jamais vider");
  expect(() => checkOut(root, join(root, "documents"))).toThrow("does not look like a previous export"); // non-empty folder without _app/
  const out = join(root, ".cortex/site");
  process.env.SOURCE_DATE_EPOCH = "1793790000"; // export time frozen: two exports stay byte-identical
  await exportSite(root, out, () => {});

  const html = (p: string) => readFileSync(join(out, p), "utf8");
  for (const p of ["index.html", "graph/index.html", "log/index.html", "tags/index.html", "tags/alpha/index.html", "search/index.html", "wiki/concepts/a/index.html", "wiki/concepts/b/index.html", "wiki/entities/c/index.html", "wiki/sources/s/index.html"])
    expect(existsSync(join(out, p))).toBe(true);
  const a = html("wiki/concepts/a/index.html");
  expect(a).toContain('href="../b/#x"'); // link rewritten, relative
  expect(a).toContain('href="../../entities/c/"');
  expect(a).toContain('class="missing-link"'); // missing page: no dead link
  expect(a).not.toMatch(/href="[^"]*\.md/);
  expect(a).toContain('href="#fn-s1"'); // footnote [^s1] numbered, linked to sources[]
  expect(a).toContain('id="fn-s1"');
  expect(a).toContain('href="#src-s1"');
  expect(a).toContain("<em>utile</em>");
  // note cited three times: one anchor per occurrence, and a ↩ back-link to each (not only the first)
  for (const k of [1, 2, 3]) {
    expect(a).toContain(`id="fnref-s1-${k}"`);
    expect(a).toContain(`href="#fnref-s1-${k}"`);
  }
  expect(a).not.toContain('id="fnref-s1-4"');
  expect(a).toContain("Back to occurrence 2 of 3");
  expect(a).toContain('<html lang="en">');
  expect(a).toContain('href="https://exemple.org/article"'); // source: original URL, not the raw path
  expect(a).not.toContain("/raw/");
  expect(a).toContain("Backlinks");

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
  for (const t of ["Log", "Ajout.", "Alpha", "Source un", "01a1a5c9-5e80-7075-ae13-0000000000ff", "3 entries"]) expect(logPage).toContain(t);
  expect(logPage.indexOf("Ajout.")).toBeLessThan(logPage.indexOf("</code></a> compiled")); // the 11:00 add before the 09:30 ingest
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
  // related reasons are structured data; a shared source carries no value (raw/ is not published)
  for (const r of pageA.related) for (const x of r.reasons) { expect(["out", "in", "source", "tag"]).toContain(x.kind); if (x.kind === "source") expect(x.value).toBeUndefined(); }
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

test("export: a wiki with no tag, then with no page at all, still exports (tags are optional)", async () => {
  const { existsSync } = await import("node:fs");
  const { exportSite } = await import("./export");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  await exportSite(root, join(root, ".cortex/vide"), () => {});
  expect(existsSync(join(root, ".cortex/vide/index.html"))).toBe(true);
  await Bun.write(join(root, "wiki/concepts/a.md"), "---\ntype: Concept\ntitle: Sans tag\ndescription: Aucune étiquette.\n---\nCorps.\n");
  await exportSite(root, join(root, ".cortex/site"), () => {});
  expect(existsSync(join(root, ".cortex/site/wiki/concepts/a/index.html"))).toBe(true);
  expect(existsSync(join(root, ".cortex/site/tags/index.html"))).toBe(true);
}, 60_000);

test("export: the UI follows `language` (French), wiki content untouched, both dictionaries shipped", async () => {
  const { existsSync, readdirSync, readFileSync } = await import("node:fs");
  const { exportSite } = await import("./export");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ language: "Français" }));
  await Bun.write(join(root, "wiki/concepts/a.md"), "---\ntype: Concept\ntitle: Alpha\ndescription: Une page.\ntags: [x]\n---\n> [!note]\n> pourquoi\n\nVoir [b](/wiki/concepts/absent.md).\n");
  const out = join(root, ".cortex/site");
  const { setLocale } = await import("../site/src/lib/i18n/index");
  try { await exportSite(root, out, () => {}); } finally { setLocale("en"); } // the export sets the process-wide locale
  const a = readFileSync(join(out, "wiki/concepts/a/index.html"), "utf8");
  expect(a).toContain('<html lang="fr">');
  expect(a).toContain("Copier le Markdown"); // UI label in French
  expect(a).toContain('<p class="personal-note-title">Note personnelle</p>'); // texts the export writes into pages
  expect(a).toContain('class="missing-link" title="page à écrire"');
  expect(a).toContain("JavaScript est désactivé");
  expect(JSON.parse(readFileSync(join(root, ".cortex/site-data/data.json"), "utf8")).locale).toBe("fr");
  // both dictionaries ship (the visitor may switch): an English label is somewhere in the client bundle
  const js = (readdirSync(join(out, "_app"), { recursive: true }) as string[]).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(out, "_app", f), "utf8")).join("");
  expect(js).toContain("Copy the Markdown");
  expect(js).toContain("Copier le Markdown");
  expect(existsSync(join(out, "404.html"))).toBe(true);
}, 60_000);
