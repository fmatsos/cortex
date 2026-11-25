import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "svelte/compiler";
import { parseHTML } from "linkedom";
import { ICON_NAMES, ICONS, SPRITE_ID, ensureSymbol, ensureSymbols, iconSvg, iconUse, referencedIcons, spriteMarkup, strokeFor, symbolId, symbolMarkup, type IconName } from "../site/src/lib/icons";
import { handle } from "../site/src/hooks.server";
import { md, noteCallouts } from "./export";
import { KINDS, TYPES, kindIcon, kindLabel, statusMeta, typeIcon } from "../site/src/lib/type-meta";
import { setLocale } from "../site/src/lib/i18n/index";

const SITE = join(import.meta.dir, "../site/src");

// The icons of the « Icon pack » section of the review: each name must exist.
const WANTED = `home search graph tags journal favorites concept entity synthesis source draft stable deprecated verified unverified needs-review stale star
copy-link copy-markdown success error sun moon system filter operator-tag operator-type operator-status operator-phrase operator-exclude recent clear toc
chevron-down back backlink related external-link note warning citation citation-return kind-add kind-ingest download generated assistant kind-query kind-lint kind-update zoom-in zoom-out
fit-view pause play close-selection list-view offline offline-ready retry new-tab language`.split(/\s+/);

test("le pack contient toutes les icônes demandées, et seulement elles", () => {
  expect([...(ICON_NAMES as readonly string[])].sort()).toEqual([...WANTED].sort());
  expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
});

// --- minimal reading of a `d` attribute: commands, argument count, absolute endpoints ---
const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
function endpoints(d: string): [number, number][] {
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  expect(toks.join("").length, "caractères inattendus dans d").toBeGreaterThan(0);
  expect(d.replace(/[a-zA-Z\s,]|-?(?:\d+\.?\d*|\.\d+)/g, ""), `reste inattendu dans d="${d}"`).toBe("");
  const pts: [number, number][] = [];
  let x = 0, y = 0, sx = 0, sy = 0, i = 0, cmd = "";
  const num = () => {
    const t = toks[i++];
    if (t === undefined || /[a-zA-Z]/.test(t)) throw new Error(`argument numérique attendu dans d="${d}"`);
    return Number(t);
  };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), c = cmd.toLowerCase();
    if (!(c in ARGS)) throw new Error(`commande inconnue ${cmd}`);
    if (c === "z") { x = sx; y = sy; continue; }
    if (i >= toks.length || /[a-zA-Z]/.test(toks[i])) throw new Error(`arguments manquants pour ${cmd} dans d="${d}"`);
    if (c === "a") {
      const [rx, ry] = [num(), num()]; num(); // rotation
      const [large, sweep] = [num(), num()];
      expect(rx > 0 && ry > 0, `rayon d'arc positif dans d="${d}"`).toBe(true);
      expect([0, 1].includes(large) && [0, 1].includes(sweep), `drapeaux d'arc dans d="${d}"`).toBe(true);
      const [ex, ey] = [num(), num()];
      x = rel ? x + ex : ex; y = rel ? y + ey : ey;
    } else if (c === "h") { const v = num(); x = rel ? x + v : v; }
    else if (c === "v") { const v = num(); y = rel ? y + v : v; }
    else {
      const a = Array.from({ length: ARGS[c] }, num);
      const [ex, ey] = [a[a.length - 2], a[a.length - 1]];
      x = rel ? x + ex : ex; y = rel ? y + ey : ey;
      if (c === "m") { sx = x; sy = y; cmd = rel ? "l" : "L"; }
    }
    pts.push([x, y]);
  }
  return pts;
}
test("lecteur de chemin : cas connus", () => {
  expect(endpoints("M4 4h16v16H4z")).toEqual([[4, 4], [20, 4], [20, 20], [4, 20]]);
  expect(endpoints("m5 12 4.8 4.8L19 7.5")[2]).toEqual([19, 7.5]);
  expect(() => endpoints("M4")).toThrow();
  expect(() => endpoints("M4 4X5 5")).toThrow();
});

const SHAPES = new Set(["path", "circle", "rect", "g"]);
const MARGIN = 1.5; // optical margin of 2, with the tolerance of mitered joins

test.each(ICON_NAMES)("l'icône %s produit un SVG valide", (name) => {
  const { document } = parseHTML(`<!doctype html><body>${iconSvg(name, { size: 20 })}`);
  const svg = document.querySelector("svg")!;
  expect(svg).toBeTruthy();
  expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
  expect(svg.getAttribute("fill")).toBe("none");
  expect(svg.getAttribute("stroke")).toBe("currentColor");
  expect(svg.getAttribute("stroke-width")).toBe("1.75");
  expect(svg.getAttribute("stroke-linecap")).toBe("butt");
  expect(svg.getAttribute("stroke-linejoin")).toBe("miter");
  expect(svg.getAttribute("stroke-miterlimit")).toBe("2");
  expect(svg.getAttribute("aria-hidden")).toBe("true"); // decorative by default
  expect(svg.getAttribute("role")).toBeNull();

  const shapes = [...svg.querySelectorAll("*")];
  expect(shapes.length).toBeGreaterThan(0);
  for (const el of shapes) {
    const tag = el.tagName.toLowerCase();
    expect(SHAPES.has(tag), `élément ${tag} non prévu`).toBe(true);
    // square language: no rounded rectangle, no `ry`
    expect(el.getAttribute("rx"), "rx interdit (angles droits)").toBeNull();
    expect(el.getAttribute("ry"), "ry interdit (angles droits)").toBeNull();
    if (el.getAttribute("fill") !== null) {
      // the only own fill: a dot, a real 2x2 square (a zero-length segment vanishes with butt ends)
      expect(tag, "seul un rect peut se remplir").toBe("rect");
      expect(el.getAttribute("fill")).toBe("currentColor");
      expect(el.getAttribute("stroke")).toBe("none");
      expect([el.getAttribute("width"), el.getAttribute("height")]).toEqual(["2", "2"]);
    } else expect(el.getAttribute("stroke"), "trait propre à une forme").toBeNull();
    if (tag === "g") continue; // transformed group (copy-link): extent computed after rotation, checked by eye
    const inside = !el.closest("g");
    if (tag === "path") {
      const d = el.getAttribute("d");
      expect(d, "path sans d").toBeTruthy();
      for (const [px, py] of endpoints(d!)) if (inside) for (const v of [px, py]) { expect(v).toBeGreaterThanOrEqual(MARGIN); expect(v).toBeLessThanOrEqual(24 - MARGIN); }
    } else if (tag === "circle") {
      const [cx, cy, r] = ["cx", "cy", "r"].map((a) => Number(el.getAttribute(a)));
      expect([cx, cy, r].every(Number.isFinite) && r > 0).toBe(true);
      for (const c of [cx, cy]) { expect(c - r).toBeGreaterThanOrEqual(MARGIN); expect(c + r).toBeLessThanOrEqual(24 - MARGIN); }
    } else {
      const [x, y, w, h] = ["x", "y", "width", "height"].map((a) => Number(el.getAttribute(a)));
      expect([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0).toBe(true);
      expect(x).toBeGreaterThanOrEqual(MARGIN); expect(y).toBeGreaterThanOrEqual(MARGIN);
      expect(x + w).toBeLessThanOrEqual(24 - MARGIN); expect(y + h).toBeLessThanOrEqual(24 - MARGIN);
    }
  }
});

test("contrat carré : aucun rx, aucun point h.01, aucun segment de longueur nulle", () => {
  for (const name of ICON_NAMES) {
    const body = ICONS[name];
    expect(body, `${name}: rx`).not.toMatch(/\brx=|\bry=/);
    expect(body, `${name}: point h.01`).not.toMatch(/[hv]\.0\d?(?![\d])/);
    expect(body, `${name}: segment nul`).not.toMatch(/[hv]0(?![\d.])/);
  }
  // dots exist where the old pack had them (list-view, fit-view, tags...)
  expect(ICONS["list-view"].match(/<rect /g)?.length).toBe(3);
  expect(ICONS["fit-view"]).toContain('fill="currentColor"');
});

test("iconSvg : étiquette, remplissage et trait optique", () => {
  const { document } = parseHTML(`<!doctype html><body>${iconSvg("star", { size: 16, filled: true, label: "Favori <ok>" })}`);
  const svg = document.querySelector("svg")!;
  expect(svg.getAttribute("fill")).toBe("currentColor");
  expect(svg.getAttribute("role")).toBe("img");
  expect(svg.getAttribute("aria-label")).toBe("Favori <ok>");
  expect(svg.getAttribute("aria-hidden")).toBeNull();
  expect(svg.getAttribute("width")).toBe("16");
  expect(svg.getAttribute("stroke-width")).toBe("2");
  expect(strokeFor(20)).toBe(1.75);
  expect(strokeFor(24)).toBe(1.75);
  expect(strokeFor(16)).toBe(2);
});

const strip = (h: string) => h.replace(/<!--.*?-->|\s+/g, "");

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
  return { icon: (props: Record<string, unknown>) => render(Icon, { props }).body };
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
  // the whole pack: every symbol present once, with the pack's content, and no stroke contract on the symbol
  const full = parseHTML(`<!doctype html><body>${spriteMarkup(ICON_NAMES)}`).document;
  const all = [...full.querySelectorAll("symbol")].map((s) => s.getAttribute("id")!);
  expect(new Set(all).size, "ids de symboles uniques").toBe(all.length);
  expect(all.sort()).toEqual(ICON_NAMES.map(symbolId).sort());
  for (const name of ICON_NAMES) {
    const sym = full.getElementById(symbolId(name))!;
    expect(sym.getAttribute("viewBox")).toBe("0 0 24 24");
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
  expect(symbolMarkup("note")).toBe(`<symbol id="cx-note" viewBox="0 0 24 24">${ICONS.note}</symbol>`);
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
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
    expect(svg.getAttribute("stroke-width")).toBe("1.75");
    expect(svg.getAttribute("stroke-linecap")).toBe("butt");
    expect(svg.getAttribute("stroke-linejoin")).toBe("miter");
    expect(svg.getAttribute("stroke-miterlimit")).toBe("2");
  }
  // no instance repeats any icon geometry: it is written once, in the sprite
  for (const body of Object.values(ICONS)) expect(all).not.toContain(body);
  const doc = (props: Record<string, unknown>) => parseHTML(`<!doctype html><body>${icon(props)}`).document.querySelector("svg")!;
  const labelled = doc({ name: "search", size: 24, label: "Rechercher" });
  expect(labelled.getAttribute("role")).toBe("img");
  expect(labelled.getAttribute("aria-label")).toBe("Rechercher");
  expect(labelled.getAttribute("aria-hidden")).toBeNull();
  expect(doc({ name: "star", filled: true }).getAttribute("fill")).toBe("currentColor");
  expect(doc({ name: "star", size: 16 }).getAttribute("stroke-width")).toBe("2");
});

test("iconUse : référence au sprite avec le contrat de trait sur l'instance", () => {
  const svg = parseHTML(`<!doctype html><body>${iconUse("note", { class: "callout-icon" })}`).document.querySelector("svg")!;
  expect(svg.getAttribute("class")).toBe("callout-icon");
  expect(svg.getAttribute("aria-hidden")).toBe("true");
  expect(svg.getAttribute("stroke-linecap")).toBe("butt");
  expect(svg.getAttribute("stroke-linejoin")).toBe("miter");
  expect(svg.querySelector("use")!.getAttribute("href")).toBe("#cx-note");
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
