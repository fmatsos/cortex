import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Contrasts of the site theme (WCAG 2.2 AA), computed from the variables of cli/site/src/app.css:
 * the CSS stays the only source, the test fails as soon as a text/background pair drops below its threshold.
 * `CORTEX_CONTRAST_TABLE=1 bun test cli/src/theme.test.ts` prints the ratio table.
 */
const CSS = readFileSync(join(import.meta.dir, "../site/src/app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Body of the first block whose opening line is exactly `opening` (indentation included). */
function block(opening: string): string {
  const start = CSS.indexOf(`${opening} {`);
  if (start < 0) throw new Error(`bloc introuvable : ${opening}`);
  return CSS.slice(start + opening.length + 2, CSS.indexOf("}", start));
}
const vars = (body: string) => Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const LIGHT = vars(block(":root"));
const DARK_SYSTEM = vars(block('\t:root:not([data-theme="light"])'));
const DARK_FORCED = vars(block(':root[data-theme="dark"]'));
const THEMES: Record<string, Record<string, string>> = { clair: LIGHT, sombre: { ...LIGHT, ...DARK_FORCED } };

// --- WCAG computation ---
type Rgb = [number, number, number];
const toRgb = (hex: string): Rgb => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`couleur hexadécimale attendue : ${hex}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as Rgb;
};
const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: Rgb) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const contrast = (a: Rgb, b: Rgb) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** Alpha compositing in sRGB space, like the browser (`bg-destructive/10`, `color-mix(… transparent)`). */
const over = (fg: Rgb, alpha: number, bg: Rgb): Rgb => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha)) as Rgb;

test("contraste : valeurs de référence", () => {
  expect(contrast(toRgb("#000000"), toRgb("#ffffff"))).toBeCloseTo(21, 5);
  expect(contrast(toRgb("#767676"), toRgb("#ffffff"))).toBeCloseTo(4.54, 2); // known AA threshold
  expect(over(toRgb("#000000"), 0.5, toRgb("#ffffff")).map(Math.round)).toEqual([128, 128, 128]);
});

test("le bloc sombre est identique en mode système et en mode forcé", () => {
  expect(DARK_SYSTEM).toEqual(Object.fromEntries(Object.entries(DARK_FORCED).filter(([k]) => k in DARK_SYSTEM)));
  expect(Object.keys(DARK_SYSTEM).sort()).toEqual(Object.keys(DARK_FORCED).sort());
});

test("chaque variable de couleur claire a son pendant sombre", () => {
  const colors = Object.keys(LIGHT).filter((k) => /^#/.test(LIGHT[k]));
  expect(colors.length).toBeGreaterThan(30);
  for (const k of colors) expect(DARK_FORCED[k], k).toBeDefined();
  for (const k of ["--graph-edge", "--favorite", "--note-background", "--note-foreground", "--warning-background", "--warning-foreground", "--link-visited"]) expect(LIGHT[k], k).toBeDefined();
  expect(LIGHT["--radius"]).toBe("0.75rem");
});

test("l'impression force la palette claire (noir sur blanc) quel que soit le thème", () => {
  const print = vars(block('\t:root:not([data-theme="light"]),\n\t:root[data-theme="dark"],\n\t:root[data-theme="light"]'));
  const BW = new Set(["--background", "--foreground", "--card", "--muted", "--muted-foreground", "--border", "--link", "--link-visited", "--mark", "--note-background", "--note-foreground", "--warning-background", "--warning-foreground"]);
  for (const [k, v] of Object.entries(print)) if (!BW.has(k)) expect(v, `${k} en impression = palette claire`).toBe(LIGHT[k]);
  for (const k of ["--foreground", "--link"]) expect(contrast(toRgb(print[k]), toRgb(print["--background"]))).toBeGreaterThanOrEqual(7);
  expect(contrast(toRgb(print["--muted-foreground"]), toRgb(print["--background"]))).toBeGreaterThanOrEqual(7);
  // each theme color token is redefined for print (no dark theme leftovers)
  for (const k of Object.keys(LIGHT).filter((n) => /^#/.test(LIGHT[n]))) expect(print[k], `${k} défini en impression`).toBeDefined();
});

// --- measured pairs ---
type Spec = { name: string; fg: (t: Record<string, string>, dark: boolean) => Rgb; bg: (t: Record<string, string>, dark: boolean) => Rgb; min: number };
const tok = (name: string) => (t: Record<string, string>) => toRgb(t[name]);
const mix = (fg: string, light: number, dark: number, bg: string) => (t: Record<string, string>, d: boolean) => over(toRgb(t[fg]), d ? dark : light, toRgb(t[bg]));
const specs: Spec[] = [];
const text = (name: string, fg: Spec["fg"], bg: Spec["bg"], min = 4.5) => specs.push({ name, fg, bg, min });
const pair = (fg: string, bg: string, min = 4.5) => text(`${fg.slice(2)} / ${bg.slice(2)}`, tok(fg), tok(bg), min);

pair("--foreground", "--background");
pair("--foreground", "--card");
pair("--foreground", "--muted");
pair("--foreground", "--accent");
pair("--card-foreground", "--card");
pair("--popover-foreground", "--popover");
pair("--muted-foreground", "--background"); // secondary text
pair("--muted-foreground", "--card");
pair("--muted-foreground", "--muted");
pair("--primary-foreground", "--primary");
text("bouton primaire au survol (90 %)", tok("--primary-foreground"), mix("--primary", 0.9, 0.9, "--background"));
pair("--secondary-foreground", "--secondary");
pair("--accent-foreground", "--accent");
for (const bg of ["--background", "--card", "--muted", "--note-background", "--warning-background", "--mark"]) {
  pair("--link", bg);
  pair("--link-visited", bg); // visited link
}
for (const bg of ["--background", "--card"]) pair("--destructive", bg);
text("badge destructive (teinte 10 % / 20 %)", tok("--destructive"), mix("--destructive", 0.1, 0.2, "--background"));
text("badge destructive sur carte", tok("--destructive"), mix("--destructive", 0.1, 0.2, "--card"));
text("bouton destructive au survol", tok("--destructive"), mix("--destructive", 0.2, 0.3, "--background"));
pair("--foreground", "--mark"); // mark highlight and target of a note
pair("--note-foreground", "--note-background"); // « Note personnelle » title
pair("--foreground", "--note-background"); // body
pair("--warning-foreground", "--warning-background"); // « Avertissement » title and caution badge
pair("--foreground", "--warning-background");
for (const k of ["concept", "entity", "synthesis", "source", "other"]) for (const bg of ["--background", "--card", "--muted"]) pair(`--type-${k}`, bg); // page type, even as text
for (const k of ["add", "ingest", "query", "lint", "update"]) {
  for (const bg of ["--background", "--card", "--muted"]) pair(`--kind-${k}`, bg); // journal type, even as text
  text(`kind-${k} / pastille teintée 14 %`, tok(`--kind-${k}`), mix(`--kind-${k}`, 0.14, 0.14, "--card"));
  text(`texte du badge kind-${k}`, tok("--foreground"), mix(`--kind-${k}`, 0.14, 0.14, "--card"));
}
pair("--favorite", "--background");
pair("--favorite", "--card");
// graphical elements and borders that identify a control: 3:1
pair("--input", "--background", 3); // border of a field
pair("--input", "--card", 3);
pair("--graph-edge", "--background", 3); // graph relations
pair("--ring", "--background", 3); // focus ring
pair("--ring", "--card", 3);
pair("--link", "--background", 3);

const rows = Object.entries(THEMES).flatMap(([theme, t]) =>
  specs.map((s) => ({ thème: theme, paire: s.name, ratio: Math.round(contrast(s.fg(t, theme === "sombre"), s.bg(t, theme === "sombre")) * 100) / 100, seuil: s.min })),
);

test("contrastes WCAG 2.2 AA, thèmes clair et sombre", () => {
  if (process.env.CORTEX_CONTRAST_TABLE) console.table(rows);
  const failures = rows.filter((r) => r.ratio < r.seuil).map((r) => `${r.thème} · ${r.paire} : ${r.ratio} < ${r.seuil}`);
  expect(failures).toEqual([]);
  expect(rows.length).toBe(specs.length * 2);
});
