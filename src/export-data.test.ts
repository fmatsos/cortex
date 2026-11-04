import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSiteData, frontendFingerprint, graphLinks, isPartialWarning, md, noteCallouts, render } from "./export";
import { parseDoc, readDocs } from "./lib";
import { safeUrl, sanitizeHtml } from "./sanitize";

// Non-régression sur un vrai wiki : CORTEX_ROOT=<wiki> bun test (ignorés sans)
const ROOT = process.env.CORTEX_ROOT;
const bun = (s: string) => Bun.markdown.html(s, { tagFilter: true, headings: { ids: true }, autolinks: true });

test("assainissement : scripts, gestionnaires d'événements, iframes, styles et protocoles dangereux disparaissent", () => {
  const out = md([
    "<img src=x onerror=alert(1)>",
    '<a href="javascript:alert(1)">a</a>',
    "<script>alert(1)</script>",
    '<iframe src="https://evil.example"></iframe>',
    '<b style="width:expression(alert(1))">b</b>',
    '<a href=" JaVaScRiPt:alert(1)">c</a>',
    '<a href="jav\tascript:alert(1)">d</a>',
    '<a href="jav&#x61;script&colon;alert(1)">e</a>',
    '<a href="&#106;avascript:alert(1)">f</a>',
    '<a href="vbscript:msgbox(1)">g</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD4=">h</a>',
    '<img src="data:image/svg+xml;base64,PHN2Zz4=">',
    "<svg onload=alert(1)><script>1</script></svg>",
    '<a href="x"onclick="alert(1)">i</a>',
    '<details open ontoggle=alert(1)><summary>s</summary></details>',
    "<form action=x><button>b</button></form>",
    "[md](javascript:alert(1)) ![md](javascript:alert(1))",
    "<img src=x onerror=alert(1)",
  ].join("\n\n"));
  // le texte échappé (`&lt;script>`) est inerte et peut rester visible ; seul le balisage compte
  for (const bad of [/<script/i, /<iframe/i, /<svg/i, /<form/i, /<button/i, /javascript:/i, /vbscript:/i, /data:text/i, /image\/svg/i])
    expect(out).not.toMatch(bad);
  expect(out).not.toMatch(/<[a-z][^>]*\s(?:on\w+|style)\s*=/i); // aucune balise émise ne porte d'attribut dangereux
  expect(out).not.toMatch(/<[a-z][^>]*\sexpression/i);
  expect(out).toContain("<details open>");
  expect(out).toContain('<img src="x">'); // l'image reste, sans son gestionnaire
});

test("assainissement : protocoles en liste blanche, URL relatives et internes conservées", () => {
  for (const ok of ["https://exemple.org/a?b=1&c=2#d", "http://x.y", "mailto:a@b.c", "tel:+33123", "/wiki/concepts/a.md#x", "../b/#frag", "#fn-s1", "page.html", "?q=1", "//cdn.example/x"])
    expect(safeUrl(ok)).toBe(ok);
  for (const bad of ["javascript:1", "JAVASCRIPT:1", " \tjava\nscript:1", "java&Tab;script:1", "&#x6A;avascript:1", "jav&#97;script&colon;1", "vbscript:1", "data:text/html,x", "file:///etc/passwd", "blob:x", "foo&bar:1", "\u0001javascript:1"])
    expect(safeUrl(bad)).toBeUndefined();
  expect(safeUrl("data:image/png;base64,AAAA", true)).toBe("data:image/png;base64,AAAA");
  expect(safeUrl("data:image/png;base64,AAAA")).toBeUndefined(); // hors image : refusé
  expect(safeUrl("data:image/svg+xml;base64,AAAA", true)).toBeUndefined();
});

test("assainissement : ce que le site utilise reste intact (tableaux, code, tâches, notes, ancres, liens)", () => {
  const src = [
    "# Titre é", "| a | b |", "|:--|--:|", "| 1 | 2 |", "- [x] fait", "- [ ] à faire", "```ts\nconst a = 1 < 2 && b > 3;\n```",
    "**gras** *it* ~~del~~ `code` <kbd>k</kbd> [lien](https://exemple.org/a?x=1&y=2) [interne](/wiki/concepts/a.md#x) ![alt](https://exemple.org/i.png \"titre\")",
    "Ligne<br />suite\n\n---\n\n> citation\n\n1. un\n2. deux",
    'Note<sup class="fn-ref"><a href="#fn-a" id="fnref-a-1" aria-label="Note 1">1</a></sup>',
  ].join("\n\n");
  const raw = bun(src);
  expect(sanitizeHtml(raw)).toBe(raw);
});

test.skipIf(!ROOT)("assainissement : non-régression sur le rendu des pages réelles du wiki", async () => {
  const docs = (await readDocs(ROOT!, "wiki")).filter((d) => !/^wiki\/(index|log)\.md$/.test(d.path));
  expect(docs.length).toBeGreaterThan(5);
  const paths = new Set(docs.map((d) => d.path));
  for (const d of docs) {
    const raw = bun(d.body);
    expect(sanitizeHtml(raw)).toBe(raw); // le Markdown du wiki ne contient rien que la liste blanche retire
    const { html } = render(d.body, `${d.path.replace(/\.md$/, "")}/`, paths);
    expect(html).not.toMatch(/<script|\son\w+=|javascript:/i);
  }
});

test("encarts : l'avertissement de source partielle sort de la note personnelle", async () => {
  const html = noteCallouts(md("> [!note] Note personnelle\n> suivre la crise.\n>\n> ⚠️ Article partiel à cause du paywall : 30 % extrait.\n\nSuite."));
  expect(html).toBe(
    '<aside class="note-perso" role="note"><p class="note-perso-titre">Note personnelle</p><p>suivre la crise.</p>\n</aside>' +
    '<aside class="callout-warning" role="note"><p class="callout-warning-titre">Avertissement</p><p>Article partiel à cause du paywall : 30 % extrait.</p></aside>\n<p>Suite.</p>\n',
  );
  expect(html).not.toContain("⚠");
  // sans ligne vide, dans le même paragraphe
  const same = noteCallouts(md("> [!note] Note personnelle\n> pourquoi\n> ⚠️ Aperçu public seulement."));
  expect(same).toContain('<p>pourquoi</p>');
  expect(same).toContain('<p class="callout-warning-titre">Avertissement</p><p>Aperçu public seulement.</p>');
  // convention Markdown dédiée : > [!warning] Titre
  expect(noteCallouts(md("> [!warning]\n> Attention."))).toBe('<aside class="callout-warning" role="note"><p class="callout-warning-titre">Avertissement</p><p>Attention.</p>\n</aside>\n');
  expect(noteCallouts(md("> [!warning] Contenu tronqué\n> ⚠️ Texte."))).toContain('<p class="callout-warning-titre">Contenu tronqué</p><p>Texte.</p>');
  // une note sans avertissement ne change pas ; une citation ordinaire non plus
  expect(noteCallouts(md("> [!note]\n> sans titre"))).toContain('<aside class="note-perso" role="note"><p class="note-perso-titre">Note personnelle</p><p>sans titre');
  expect(noteCallouts(md("> ⚠️ une citation ordinaire"))).toContain("<blockquote>");

  // sur les pages réelles (si CORTEX_ROOT est défini)
  const real = ROOT ? (await readDocs(ROOT, "wiki/sources")).filter((d) => /^(Raspberry Pi 5 16 Go|How Codex is built)/.test(String(d.fm.title))) : [];
  if (ROOT) expect(real).toHaveLength(2);
  for (const d of real) {
    const r = render(d.body, `${d.path.replace(/\.md$/, "")}/`, new Set());
    expect(r.html.match(/class="callout-warning"/g)).toHaveLength(1);
    expect(r.html).toMatch(/<aside class="note-perso"[^]*?<\/aside><aside class="callout-warning"/);
    expect(r.html).not.toContain("⚠");
    expect(r.warnings.some(isPartialWarning)).toBe(true);
  }
  expect(isPartialWarning("La note v1 affirmait autre chose")).toBe(false);
});

test("graphe : liens orientés, un seul lien (mutual) pour une paire réciproque", () => {
  const links = graphLinks(new Set(["b\ta", "a\tb", "c\ta", "a\td"]));
  expect(links).toEqual([
    { source: "a", target: "b", mutual: true },
    { source: "a", target: "d" },
    { source: "c", target: "a" },
  ]);
  expect(graphLinks(new Set())).toEqual([]);
});

/** Racine jetable : une source raw partielle citée par une page Source, des titres à accents. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  const page = (path: string, type: string, title: string, extra: string, body: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), `---\ntype: ${type}\ntitle: ${title}\ndescription: D ${title}.\ntags: [t]\n${extra}---\n${body}\n`);
  };
  const raw = (id: string, partial: string) => {
    mkdirSync(join(root, `raw/2026/11/${id}`), { recursive: true });
    writeFileSync(join(root, `raw/2026/11/${id}/source.md`), `---\ntype: RawSource\ntitle: R\nurl: https://exemple.org/${id}\nnote: n\n${partial}status: compiled\n---\nSECRET\n`);
  };
  const src = (id: string) => `sources:\n  - id: s\n    resource: /raw/2026/11/${id}/source.md\n    title: S\n`;
  writeFileSync(join(root, "cortex.json"), "{}");
  raw("01a1a5c9-5e80-7075-ae13-aab03b0a8697", "partial: true  # paywall\n");
  raw("01a1a5c9-5e80-7075-ae13-aab03b0a8698", "");
  page("wiki/sources/zz-partiel.md", "Source", "Zèbre partiel", src("01a1a5c9-5e80-7075-ae13-aab03b0a8697"), "Résumé.[^s]\n\n[^s]: S.");
  page("wiki/sources/complet.md", "Source", "Complet", src("01a1a5c9-5e80-7075-ae13-aab03b0a8698"), "Résumé.[^s]\n\n[^s]: S.");
  page("wiki/concepts/avertie.md", "Concept", "Avertie", "", "> [!note] Note personnelle\n> n\n>\n> ⚠️ Aperçu public seulement.\n\nTexte avec `<b>` et <img src=x onerror=alert(1)> et [x](javascript:alert(1)).");
  page("wiki/concepts/etude.md", "Concept", "Étude", "", "Texte. [Zèbre](/wiki/sources/zz-partiel.md)");
  page("wiki/concepts/abeille.md", "Concept", "Abeille", "", "Texte. [Étude](/wiki/concepts/etude.md)");
  page("wiki/concepts/zebre.md", "Concept", "Zèbre", "", "Texte. [Abeille](/wiki/concepts/abeille.md) [Étude](/wiki/concepts/etude.md)");
  writeFileSync(join(root, "wiki/index.md"), "# Index\n");
  writeFileSync(join(root, "wiki/log.jsonl"), JSON.stringify({ at: "2026-11-04T10:00:00+01:00", kind: "ingest", text: "Compilé : [Étude](/wiki/concepts/etude.md) et `01a1a5c9-5e80-7075-ae13-aab03b0a8697`.", sources: ["01a1a5c9-5e80-7075-ae13-aab03b0a8697"], pages: ["wiki/concepts/abeille.md"] }) + "\n");
  return root;
}

test("export : partial, tri par titre (collation française), liens orientés, recherche du journal", async () => {
  const { data, graph, search } = await buildSiteData(fixture());
  // ordre : Abeille, Avertie, Complet, Étude, Zèbre, Zèbre partiel (É entre C et Z, pas après Z comme dans l'ordre des codes)
  expect(data.pages.map((p) => p.title)).toEqual(["Abeille", "Avertie", "Complet", "Étude", "Zèbre", "Zèbre partiel"]);
  expect(graph.nodes.map((n) => n.title)).toEqual(data.pages.map((p) => p.title));
  expect(search.docs.map((d) => d.id)).toEqual(data.pages.map((p) => p.id));
  expect(data.tags[0].ids).toEqual(data.pages.map((p) => p.id));
  const by = (id: string) => data.pages.find((p) => p.id === id)!;
  expect(by("concepts/etude").backlinks.map((b) => b.title)).toEqual(["Abeille", "Zèbre"]);

  // partial : source raw `partial:` (page Source seulement), ou encart d'avertissement de contenu partiel
  expect(Object.fromEntries(data.pages.map((p) => [p.id, p.partial]))).toEqual({
    "concepts/abeille": false, "concepts/avertie": true, "sources/complet": false, "concepts/etude": false, "concepts/zebre": false, "sources/zz-partiel": true,
  });
  expect(by("sources/zz-partiel").sources[0].partial).toBe(true);
  expect(by("sources/complet").sources[0].partial).toBeUndefined();
  expect(search.docs.find((d) => d.id === "concepts/avertie")!.partial).toBe(true);
  expect(search.docs.find((d) => d.id === "concepts/etude")!.partial).toBe(false);
  const avertie = by("concepts/avertie");
  expect(avertie.html).toContain('<p class="callout-warning-titre">Avertissement</p>');
  expect(search.docs.find((d) => d.id === "concepts/avertie")!.text).toContain("Aperçu public seulement"); // le texte de l'avertissement est cherchable…
  expect(search.docs.find((d) => d.id === "concepts/avertie")!.text).not.toContain("Avertissement"); // …pas son titre
  // HTML auteur assaini dans les données exportées
  expect(avertie.html).not.toMatch(/onerror|javascript:/i);
  expect(avertie.html).toContain("<code>&lt;b&gt;</code>");

  // graphe orienté : etude → zz-partiel ; abeille → etude ; zebre → abeille, etude
  expect(graph.links).toEqual([
    { source: "concepts/abeille", target: "concepts/etude" },
    { source: "concepts/etude", target: "sources/zz-partiel" },
    { source: "concepts/zebre", target: "concepts/abeille" },
    { source: "concepts/zebre", target: "concepts/etude" },
  ]);
  expect(graph.nodes.find((n) => n.id === "concepts/etude")!.degree).toBe(3);

  // journal : texte replié (sans accents, minuscules) pour la recherche locale, titres des pages et ids inclus
  const e = data.log[0];
  expect(e.search).toBe(e.search.toLowerCase());
  for (const t of ["ingest", "compile", "etude", "abeille", "01a1a5c9-5e80-7075-ae13-aab03b0a8697"]) expect(e.search).toContain(t);
  expect(e.search).not.toMatch(/[éè<>]/);
});

test("version du site : l'empreinte du frontend change avec le CSS ou un composant", () => {
  const dir = mkdtempSync(join(tmpdir(), "cortex-site-"));
  mkdirSync(join(dir, "src/lib"), { recursive: true });
  writeFileSync(join(dir, "src/app.css"), "a{color:red}");
  writeFileSync(join(dir, "src/lib/x.svelte"), "<p>x</p>");
  writeFileSync(join(dir, "vite.config.ts"), "export default {}");
  const a = frontendFingerprint(dir);
  expect(frontendFingerprint(dir)).toBe(a); // déterministe
  writeFileSync(join(dir, "src/app.css"), "a{color:blue}");
  const b = frontendFingerprint(dir);
  expect(b).not.toBe(a);
  writeFileSync(join(dir, "src/lib/x.svelte"), "<p>y</p>");
  expect(frontendFingerprint(dir)).not.toBe(b);
  expect(frontendFingerprint()).toMatch(/^[0-9a-f]{64}$/); // le vrai site
});
