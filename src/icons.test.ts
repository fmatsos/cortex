import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComponentProps } from "svelte";
import { compile } from "svelte/compiler";
import { parseHTML } from "linkedom";
import { ICON_NAMES, ICONS, SPRITE_ID, VIEW_BOX, ensureSymbol, ensureSymbols, iconKey, iconSvg, iconUse, referencedIcons, spriteMarkup, symbolId, symbolMarkup, type IconName } from "../site/src/lib/icons";
import { existsSync } from "node:fs";
import { buildBlock, isStale, loadMap, phosphorFile } from "../scripts/build-icons";
import { handle } from "../site/src/hooks.server";
import { md, noteCallouts } from "./export";
import { KINDS, TYPES, kindIcon, kindLabel, statusMeta, typeIcon } from "../site/src/lib/type-meta";
import { setLocale } from "../site/src/lib/i18n/index";

const SITE = join(import.meta.dir, "../site/src");

// The icons of the « Icon pack » section of the review: each name must exist (the names are the public API).
const WANTED = `home search graph map journey tags journal favorites concept entity synthesis source draft stable deprecated verified unverified needs-review stale star
copy-link copy-markdown success error sun moon system filter operator-tag operator-type operator-status operator-phrase operator-exclude recent clear toc
chevron-down back backlink related external-link note warning citation citation-return kind-add kind-ingest download generated assistant kind-query help kind-lint kind-update zoom-in zoom-out
fit-view pause play close-selection list-view offline offline-ready retry new-tab language account space sign-in sign-out trash rename conversation save export-markdown new-conversation star-filled send send-filled`.split(/\s+/);

const MAP = loadMap();

test("le pack contient toutes les icônes demandées, et seulement elles", () => {
  expect([...(ICON_NAMES as readonly string[])].sort()).toEqual([...WANTED].sort());
  expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
});

test("design/icons.json : chaque nom pointe vers un fichier Phosphor existant (Light, ou Fill pour les variantes pleines)", () => {
  expect(Object.keys(MAP.icons).length).toBeGreaterThan(0);
  expect(Object.keys({ ...MAP.icons, ...MAP.filled }).sort()).toEqual([...WANTED].sort());
  for (const [name, phosphor] of Object.entries(MAP.icons)) expect(existsSync(phosphorFile(phosphor, "light")), `${name} -> ${phosphor}-light.svg`).toBe(true);
  for (const [name, phosphor] of Object.entries(MAP.filled)) {
    expect(existsSync(phosphorFile(phosphor, "fill")), `${name} -> ${phosphor}-fill.svg`).toBe(true);
    expect(name.endsWith("-filled") && Object.hasOwn(MAP.icons, name.slice(0, -"-filled".length)), `${name}: a filled variant belongs to an existing icon`).toBe(true);
  }
});

test("deux sens différents n'ont jamais la même icône Phosphor (hors les paires de même sens)", () => {
  const SAME_MEANING = [["favorites", "star"], ["clear", "close-selection"]];
  const byGlyph = new Map<string, string[]>();
  for (const [name, phosphor] of Object.entries(MAP.icons)) byGlyph.set(phosphor, [...(byGlyph.get(phosphor) ?? []), name]);
  const shared = [...byGlyph.values()].filter((names) => names.length > 1).map((names) => names.sort());
  expect(shared).toEqual(SAME_MEANING.map((p) => [...p].sort()));
});

test("le générateur : le bloc d'icons.ts est à jour avec design/icons.json et Phosphor (--check)", () => {
  expect(isStale()).toBe(false);
  const out = Bun.spawnSync(["bun", join(import.meta.dir, "../scripts/build-icons.ts"), "--check"]);
  expect(out.exitCode, new TextDecoder().decode(out.stderr)).toBe(0);
  const block = buildBlock(MAP);
  for (const name of ICON_NAMES) expect(block, name).toContain(ICONS[name]);
});

const strip = (h: string) => h.replace(/<!--.*?-->|\s+/g, "");

const SHAPES = new Set(["path"]);

test.each(ICON_NAMES)("l'icône %s produit un SVG valide : grille 256, currentColor, aucun trait", (name) => {
  const { document } = parseHTML(`<!doctype html><body>${iconSvg(name, { size: 20 })}`);
  const svg = document.querySelector("svg")!;
  expect(svg).toBeTruthy();
  expect(svg.getAttribute("viewBox")).toBe("0 0 256 256");
  expect(VIEW_BOX).toBe("0 0 256 256");
  expect(svg.getAttribute("fill")).toBe("currentColor");
  for (const a of ["stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit"]) expect(svg.getAttribute(a), `${name}: ${a}`).toBeNull();
  expect(svg.getAttribute("aria-hidden")).toBe("true"); // decorative by default
  expect(svg.getAttribute("role")).toBeNull();

  const shapes = [...svg.querySelectorAll("*")];
  expect(shapes.length).toBeGreaterThan(0);
  for (const el of shapes) {
    const tag = el.tagName.toLowerCase();
    expect(SHAPES.has(tag), `élément ${tag} non prévu`).toBe(true);
    for (const a of ["stroke", "stroke-width", "fill", "style", "transform"]) expect(el.getAttribute(a), `${name}: ${a} sur <${tag}>`).toBeNull();
    expect(el.getAttribute("d"), "path sans d").toBeTruthy();
  }
  expect(ICONS[name], `${name}: markup brut sans stroke`).not.toMatch(/stroke/);
});

test("iconSvg : étiquette et variante pleine", () => {
  const { document } = parseHTML(`<!doctype html><body>${iconSvg("star", { size: 16, filled: true, label: "Favori <ok>" })}`);
  const svg = document.querySelector("svg")!;
  expect(svg.getAttribute("fill")).toBe("currentColor");
  expect(svg.getAttribute("role")).toBe("img");
  expect(svg.getAttribute("aria-label")).toBe("Favori <ok>");
  expect(svg.getAttribute("aria-hidden")).toBeNull();
  expect(svg.getAttribute("width")).toBe("16");
  expect(svg.getAttribute("stroke-width")).toBeNull();
  expect(strip(svg.innerHTML)).toBe(strip(ICONS["star-filled"]));
  expect(iconSvg("star")).toContain(ICONS.star);
  expect(ICONS["star-filled"]).not.toBe(ICONS.star);
  // an icon without a Fill variant is drawn as is
  expect(iconKey("search", true)).toBe("search");
  expect(iconKey("star", true)).toBe("star-filled");
  expect(iconKey("star")).toBe("star");
});

type IconProps = ComponentProps<typeof import("../site/src/lib/components/icon.svelte").default>;

// Compiles the Svelte components for server rendering, once for the whole file.
async function ssr() {
  Bun.plugin({
    name: "svelte-ssr",
    setup(build) {
      build.onLoad({ filter: /\.svelte$/ }, ({ path }) => ({
        contents: compile(readFileSync(path, "utf8"), { generate: "server", filename: path, css: "external" }).js.code,
        loader: "js",
      }));
    },
  });
  const { render } = await import("svelte/server");
  const { default: Icon } = await import("../site/src/lib/components/icon.svelte");
  return { icon: (props: ComponentProps<typeof Icon>) => render(Icon, { props }).body };
}

// The sprite is per page: only the symbols a document references, from one markup function shared by build and client.
test("referencedIcons : exactement les noms référencés, inconnus ignorés, ordre du pack", () => {
  const html = `<svg><use href="#cx-warning"/></svg><svg><use href='#cx-search'/></svg><use href="#cx-warning"/><use href="#cx-nope"/><use href="#other"/><use href="#cx-"/>`
    + `<script>{"html":"<use href=\\"#cx-note\\"/>"}</script>`;
  expect(referencedIcons(html)).toEqual(["search", "warning"]);
  expect(referencedIcons("")).toEqual([]);
  expect(referencedIcons('<use href="#cx-constructor"/><use href="#cx-__proto__"/>')).toEqual([]);
});

test("spriteMarkup : un symbole par nom demandé, ids uniques, contenu du pack, hors flux et de taille nulle", () => {
  expect(spriteMarkup([])).toBe("");
  expect(spriteMarkup(["nope", "constructor"])).toBe("");
  const html = spriteMarkup(["warning", "search", "search", "nope"]);
  const { document } = parseHTML(`<!doctype html><body>${html}`);
  const root = document.querySelector("svg")!;
  expect(root.getAttribute("id")).toBe(SPRITE_ID);
  expect(root.getAttribute("aria-hidden")).toBe("true");
  const style = root.getAttribute("style") ?? "";
  expect(style).toMatch(/position:\s*absolute/);
  expect(style).toMatch(/width:\s*0/);
  expect(style).toMatch(/height:\s*0/);
  expect(style, "display:none breaks <use> in some browsers").not.toMatch(/display\s*:\s*none/);
  const ids = [...document.querySelectorAll("symbol")].map((s) => s.getAttribute("id")!);
  expect(ids).toEqual(["cx-search", "cx-warning"]);
  // the whole pack: every symbol present once, with the pack's content, and no paint attributes on the symbol (the instance carries currentColor)
  const full = parseHTML(`<!doctype html><body>${spriteMarkup(ICON_NAMES)}`).document;
  const all = [...full.querySelectorAll("symbol")].map((s) => s.getAttribute("id")!);
  expect(new Set(all).size, "ids de symboles uniques").toBe(all.length);
  expect(all.sort()).toEqual(ICON_NAMES.map(symbolId).sort());
  for (const name of ICON_NAMES) {
    const sym = full.getElementById(symbolId(name))!;
    expect(sym.getAttribute("viewBox")).toBe("0 0 256 256");
    expect(strip(sym.innerHTML), name).toBe(strip(ICONS[name]));
    for (const a of ["stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill"]) expect(sym.getAttribute(a), `${name}: ${a} sur le symbole`).toBeNull();
  }
});

test("le crochet de build : le sprite suit <body> et ne contient que les symboles de la page", async () => {
  const page = (body: string) => `<!doctype html><html><head></head><body data-x="1"><noscript><p>x</p></noscript><div style="display: contents">${body}</div></body></html>`;
  const run = async (html: string, done = true) => {
    let out = "";
    await handle({ event: {}, resolve: (_e, o) => { out = o.transformPageChunk({ html, done }); return out; } });
    return out;
  };
  const used = await run(page('<svg><use href="#cx-note"/></svg><svg><use href="#cx-search"/></svg>'));
  const { document } = parseHTML(used);
  const body = document.querySelector("body")!;
  expect(body.firstElementChild?.getAttribute("id"), "the sprite is the first thing in <body>").toBe(SPRITE_ID);
  expect([...document.querySelectorAll("symbol")].map((s) => s.id)).toEqual(["cx-search", "cx-note"]);
  expect(document.querySelectorAll(`#${SPRITE_ID}`).length).toBe(1);
  expect(used.indexOf(`id="${SPRITE_ID}"`)).toBeGreaterThan(used.indexOf("<body"));
  expect(used.indexOf(`id="${SPRITE_ID}"`)).toBeLessThan(used.indexOf("<noscript>"));
  // a page without any icon gets no sprite at all; a chunk without <body> is left alone
  expect(await run(page("<p>none</p>"))).not.toContain("<symbol");
  expect(await run("<p>chunk <use href=\"#cx-note\"/></p>", false)).not.toContain("<symbol");
});

test("le client et le build produisent le même symbole ; ensureSymbols ne complète que ce qui manque", () => {
  // linkedom parses insertAdjacentHTML as HTML (it nests <path/>): record the markup the client writes instead of
  // comparing a re-parsed tree; the real browser parse is covered by tests/ui/icons.spec.ts
  const doc = () => parseHTML(`<!doctype html><html><body><svg><use href="#cx-note"/></svg><svg><use href="#cx-warning"/></svg><svg><use href="#cx-nope"/></svg></body></html>`).document;
  const record = (el: Element) => { const w: string[] = []; el.insertAdjacentHTML = (_pos: string, h: string) => { w.push(h); }; return w; };

  // no sprite yet: the client writes the same sprite the hook would, for the first missing name
  const d1 = parseHTML(`<!doctype html><html><body><svg><use href="#cx-note"/></svg></body></html>`).document;
  const first = record(d1.body);
  ensureSymbols(d1);
  expect(first).toEqual([spriteMarkup(["note"])]);

  // a sprite exists: each missing symbol is appended once, with the shared symbol markup, nothing else
  const d2 = doc();
  d2.body.insertAdjacentHTML("afterbegin", `<svg id="${SPRITE_ID}"><symbol id="cx-note"></symbol></svg>`);
  const writes = record(d2.getElementById(SPRITE_ID)!);
  ensureSymbols(d2);
  ensureSymbol("search", d2);
  ensureSymbol("constructor", d2);
  expect(writes).toEqual([symbolMarkup("warning"), symbolMarkup("search")]);
  expect(symbolMarkup("note")).toBe(`<symbol id="cx-note" viewBox="0 0 256 256">${ICONS.note}</symbol>`);
  expect(spriteMarkup(["note"])).toContain(symbolMarkup("note"));
});

test("le composant Icon : un <use> du sprite, sans géométrie ; décorative par défaut, étiquetée sur demande", async () => {
  const { icon } = await ssr();
  let all = "";
  for (const name of ICON_NAMES) {
    const out = icon({ name });
    all += out;
    const svg = parseHTML(`<!doctype html><body>${out}`).document.querySelector("svg")!;
    const uses = [...svg.querySelectorAll("*")];
    expect(uses.map((e) => e.tagName.toLowerCase()), name).toEqual(["use"]);
    expect(uses[0].getAttribute("href")).toBe(`#cx-${name}`);
    expect(out, `${name}: no geometry per use`).not.toMatch(/<(path|circle|rect|g)[\s>]/);
    expect(out, `${name}: no path data per use`).not.toMatch(/\bd="/);
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("viewBox")).toBe("0 0 256 256");
    expect(svg.getAttribute("fill")).toBe("currentColor");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
    for (const a of ["stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit"]) expect(svg.getAttribute(a), `${name}: ${a}`).toBeNull();
  }
  // no instance repeats any icon geometry: it is written once, in the sprite
  for (const body of Object.values(ICONS)) expect(all).not.toContain(body);
  const doc = (props: IconProps) => parseHTML(`<!doctype html><body>${icon(props)}`).document.querySelector("svg")!;
  const labelled = doc({ name: "search", size: 24, label: "Rechercher" });
  expect(labelled.getAttribute("role")).toBe("img");
  expect(labelled.getAttribute("aria-label")).toBe("Rechercher");
  expect(labelled.getAttribute("aria-hidden")).toBeNull();
  // `filled` swaps the symbol for the Fill weight; an icon without one is unchanged
  expect(doc({ name: "star", filled: true }).querySelector("use")!.getAttribute("href")).toBe("#cx-star-filled");
  expect(doc({ name: "star" }).querySelector("use")!.getAttribute("href")).toBe("#cx-star");
  expect(doc({ name: "search", filled: true }).querySelector("use")!.getAttribute("href")).toBe("#cx-search");
});

test("iconUse : référence au sprite, currentColor sur l'instance, aucun trait", () => {
  const svg = parseHTML(`<!doctype html><body>${iconUse("note", { class: "callout-icon" })}`).document.querySelector("svg")!;
  expect(svg.getAttribute("class")).toBe("callout-icon");
  expect(svg.getAttribute("aria-hidden")).toBe("true");
  expect(svg.getAttribute("viewBox")).toBe("0 0 256 256");
  expect(svg.getAttribute("fill")).toBe("currentColor");
  expect(svg.getAttribute("stroke")).toBeNull();
  expect(svg.querySelector("use")!.getAttribute("href")).toBe("#cx-note");
  expect(iconUse("star", { filled: true })).toContain('href="#cx-star-filled"');
});

test("les encarts exportés référencent le sprite ; plus aucun masque CSS dupliqué", () => {
  const css = readFileSync(join(SITE, "app.css"), "utf8");
  expect(css).not.toContain("--callout-icon");
  expect(css).not.toMatch(/data:image\/svg/);
  expect(css).not.toMatch(/mask:/);
  const note = noteCallouts(md("> [!note] Titre\n> corps"));
  expect(note).toContain('<use href="#cx-note"/>');
  expect(note).toContain('class="callout-icon"');
  const warn = noteCallouts(md("> [!warning] Titre\n> corps"));
  expect(warn).toContain('<use href="#cx-warning"/>');
  expect(note + warn).not.toMatch(/<(path|circle|rect)[\s>]|\bd="|data:image/);
  // the icon is generated chrome, added after sanitizing: author content still cannot write svg or use
  const hostile = md('<svg onload="x"><use href="#cx-note"/></svg><p>texte</p>');
  expect(hostile).not.toMatch(/<svg|<use/i);
});

test("type-meta: log labels follow the locale, technical identifiers unchanged", () => {
  expect(KINDS.map((k) => k.kind)).toEqual(["add", "ingest", "query", "lint", "update"]);
  expect(KINDS.map((k) => k.label)).toEqual(["Added", "Compiled", "Question", "Check", "Update"]);
  setLocale("fr");
  try { expect(KINDS.map((k) => k.label)).toEqual(["Ajout", "Compilation", "Question", "Contrôle", "Mise à jour"]); } finally { setLocale("en"); }
  for (const k of KINDS) {
    expect(k.description.length).toBeGreaterThan(20);
    expect(k.description.endsWith(".")).toBe(true);
    expect(ICON_NAMES).toContain(k.icon);
    expect(k.icon).toBe(`kind-${k.kind}`);
  }
  expect(kindLabel("ingest")).toBe("Compiled");
  expect(kindLabel("inconnu")).toBe("inconnu"); // an unknown identifier is displayed as is
  expect(kindIcon("inconnu")).toBe("note");
  for (const t of TYPES) expect(ICON_NAMES).toContain(t.icon);
  expect(typeIcon("Concept")).toBe("concept");
  expect(typeIcon("Autre")).toBe("source");
  expect(statusMeta("stable")?.variant).toBe("stable");
  expect(statusMeta("draft")?.variant).toBe("caution");
  expect(statusMeta("deprecated")?.icon).toBe("deprecated");
  expect(statusMeta("?")).toBeUndefined();
  for (const n of Object.keys(ICONS) as IconName[]) expect(typeof ICONS[n]).toBe("string");
});
