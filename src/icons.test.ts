import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "svelte/compiler";
import { parseHTML } from "linkedom";
import { ICON_NAMES, ICONS, iconMask, iconSvg, strokeFor, type IconName } from "../site/src/lib/icons";
import { KINDS, TYPES, kindIcon, kindLabel, statusMeta, typeIcon } from "../site/src/lib/type-meta";

const SITE = join(import.meta.dir, "../site/src");

// Les icônes de la section « Icon pack » de la revue : chaque nom doit exister.
const WANTED = `home search graph tags journal favorites concept entity synthesis source draft stable deprecated verified unverified needs-review stale star
copy-link copy-markdown success error sun moon system filter operator-tag operator-type operator-status operator-phrase operator-exclude recent clear toc
chevron-down back backlink related external-link note warning citation citation-return kind-add kind-ingest download kind-query kind-lint kind-update zoom-in zoom-out
fit-view pause play close-selection list-view offline offline-ready retry new-tab`.split(/\s+/);

test("le pack contient toutes les icônes demandées, et seulement elles", () => {
  expect([...ICON_NAMES].sort()).toEqual([...WANTED].sort());
  expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
});

// --- lecture minimale d'un attribut `d` : commandes, nombre d'arguments, extrémités absolues ---
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
const MARGIN = 1.5; // marge optique de 2, avec la tolérance des extrémités arrondies

test.each(ICON_NAMES)("l'icône %s produit un SVG valide", (name) => {
  const { document } = parseHTML(`<!doctype html><body>${iconSvg(name, { size: 20 })}`);
  const svg = document.querySelector("svg")!;
  expect(svg).toBeTruthy();
  expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
  expect(svg.getAttribute("fill")).toBe("none");
  expect(svg.getAttribute("stroke")).toBe("currentColor");
  expect(svg.getAttribute("stroke-width")).toBe("1.75");
  expect(svg.getAttribute("stroke-linecap")).toBe("round");
  expect(svg.getAttribute("stroke-linejoin")).toBe("round");
  expect(svg.getAttribute("aria-hidden")).toBe("true"); // décorative par défaut
  expect(svg.getAttribute("role")).toBeNull();

  const shapes = [...svg.querySelectorAll("*")];
  expect(shapes.length).toBeGreaterThan(0);
  for (const el of shapes) {
    const tag = el.tagName.toLowerCase();
    expect(SHAPES.has(tag), `élément ${tag} non prévu`).toBe(true);
    expect(el.getAttribute("fill"), "pas de remplissage propre à une forme").toBeNull();
    if (tag === "g") continue; // groupe transformé (copy-link) : étendue calculée après rotation, vérifiée à l'œil
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

test("le composant Icon rend le même SVG (décorative par défaut, étiquetée sur demande)", async () => {
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
  const html = (props: Record<string, unknown>) => render(Icon, { props }).body;

  for (const name of ICON_NAMES) {
    const out = parseHTML(`<!doctype html><body>${html({ name })}`).document.querySelector("svg")!;
    const ref = parseHTML(`<!doctype html><body>${iconSvg(name, { size: 20 })}`).document.querySelector("svg")!;
    expect(out.innerHTML.replace(/<!--.*?-->|\s+/g, ""), name).toBe(ref.innerHTML.replace(/\s+/g, ""));
    expect(out.getAttribute("width")).toBe("20");
    expect(out.getAttribute("aria-hidden")).toBe("true");
    expect(out.getAttribute("role")).toBeNull();
    expect(out.getAttribute("stroke-width")).toBe("1.75");
  }
  const labelled = parseHTML(`<!doctype html><body>${html({ name: "search", size: 24, label: "Rechercher" })}`).document.querySelector("svg")!;
  expect(labelled.getAttribute("role")).toBe("img");
  expect(labelled.getAttribute("aria-label")).toBe("Rechercher");
  expect(labelled.getAttribute("aria-hidden")).toBeNull();
  const star = parseHTML(`<!doctype html><body>${html({ name: "star", filled: true })}`).document.querySelector("svg")!;
  expect(star.getAttribute("fill")).toBe("currentColor");
});

test("les motifs CSS des encarts suivent les icônes du pack", () => {
  const css = readFileSync(join(SITE, "app.css"), "utf8");
  expect(css).toContain(`--callout-icon: ${iconMask("note")};`);
  expect(css).toContain(`--callout-icon: ${iconMask("warning")};`);
  expect(iconMask("note")).toMatch(/^url\("data:image\/svg\+xml,%3Csvg /);
  expect(iconMask("note")).not.toMatch(/[<>#]/);
});

test("type-meta : libellés français du journal, identifiants techniques inchangés", () => {
  expect(KINDS.map((k) => k.kind)).toEqual(["add", "ingest", "query", "lint", "update"]);
  expect(KINDS.map((k) => k.label)).toEqual(["Ajout", "Compilation", "Question", "Contrôle", "Mise à jour"]);
  for (const k of KINDS) {
    expect(k.description.length).toBeGreaterThan(20);
    expect(k.description.endsWith(".")).toBe(true);
    expect(ICON_NAMES).toContain(k.icon);
    expect(k.icon).toBe(`kind-${k.kind}`);
  }
  expect(kindLabel("ingest")).toBe("Compilation");
  expect(kindLabel("inconnu")).toBe("inconnu"); // un identifiant inconnu s'affiche tel quel
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
