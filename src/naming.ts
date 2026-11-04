import { existsSync } from "node:fs";
import { join } from "node:path";
import { localIso, readDocs, slugify } from "./lib";
import { loadConfig } from "./backends/index";

/**
 * Nommage et arborescence des sources raw et des pages wiki : un modèle par genre, dans config.json.
 * `raw_path` donne le dossier d'une source sous raw/ (qui contient source.md), son dernier segment est l'id raw ;
 * `page_path` donne le chemin d'une page sous wiki/, sans `.md`. `/` crée des sous-dossiers.
 * Seul le CLI applique ces modèles (`cortex add`, `cortex new`) : ni l'agent ni l'humain n'inventent un nom.
 */
export const NAMING_DEFAULTS = { raw_path: "{yyyy}/{mm}/{uuid}", page_path: "{type}/{uuid}" } as const;
export type NamingKey = keyof typeof NAMING_DEFAULTS;

/** Dossier de chaque type de page wiki (placeholder `{type}`). */
export const TYPE_DIRS: Record<string, string> = { Source: "sources", Concept: "concepts", Entity: "entities", Synthesis: "syntheses" };

const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** Placeholders : valeur (à la création) et motif (pour le lint). Dates en heure locale, comme `fetched_at`. */
const PLACEHOLDERS: Record<string, { for?: NamingKey; re: string; value: (v: Vars) => string; doc: string }> = {
  uuid: { re: UUID_RE, value: (v) => Bun.randomUUIDv7("hex", v.at), doc: "UUID v7 (horodaté, unique)" },
  yyyy: { re: "\\d{4}", value: (v) => localIso(v.at).slice(0, 4), doc: "année" },
  mm: { re: "\\d{2}", value: (v) => localIso(v.at).slice(5, 7), doc: "mois" },
  dd: { re: "\\d{2}", value: (v) => localIso(v.at).slice(8, 10), doc: "jour" },
  hh: { re: "\\d{2}", value: (v) => localIso(v.at).slice(11, 13), doc: "heure" },
  mi: { re: "\\d{2}", value: (v) => localIso(v.at).slice(14, 16), doc: "minute" },
  ss: { re: "\\d{2}", value: (v) => localIso(v.at).slice(17, 19), doc: "seconde" },
  slug: { re: "[a-z0-9]+(?:-[a-z0-9]+)*", value: (v) => slugify(v.title), doc: "titre en minuscules et tirets (50 caractères au plus)" },
  rand: { re: "[a-z0-9]{4}", value: () => rand4(), doc: "4 caractères aléatoires [a-z0-9]" },
  type: { for: "page_path", re: `(?:${Object.values(TYPE_DIRS).join("|")})`, value: (v) => TYPE_DIRS[v.type!], doc: "dossier du type : sources, concepts, entities, syntheses" },
  kind: { for: "raw_path", re: "[a-z]+", value: (v) => v.kind!, doc: "nature de la source : article, pdf, note…" },
};
export type Vars = { at: Date; title: string; type?: string; kind?: string };

function rand4(): string {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  return [...crypto.getRandomValues(new Uint8Array(4))].map((b) => a[b % 36]).join("");
}

/** Placeholders permis pour un modèle, avec leur description (aide et messages d'erreur). */
export const placeholders = (key: NamingKey) =>
  Object.entries(PLACEHOLDERS).filter(([, p]) => !p.for || p.for === key).map(([k, p]) => `{${k}} ${p.doc}`);

/** Modèle valide, sinon le message d'erreur. */
export function checkTemplate(key: NamingKey, tpl: string): string | undefined {
  const allowed = Object.keys(PLACEHOLDERS).filter((k) => !PLACEHOLDERS[k].for || PLACEHOLDERS[k].for === key);
  const segs = tpl.split("/");
  if (segs.some((s) => !s || s === "." || s === "..")) return `${key} : segments vides, « . » et « .. » interdits (« ${tpl} »).`;
  for (const [, name] of tpl.matchAll(/\{([^}]*)\}/g)) if (!allowed.includes(name)) return `${key} : placeholder inconnu {${name}} (permis : ${allowed.map((a) => `{${a}}`).join(", ")}).`;
  if (/[^A-Za-z0-9._\/-]/.test(tpl.replace(/\{[a-z]+\}/g, ""))) return `${key} : hors placeholders, seuls lettres, chiffres, « . », « _ », « - » et « / » sont permis (« ${tpl} »).`;
  if (!/\{[a-z]+\}/.test(segs.at(-1)!)) return `${key} : le dernier segment doit contenir un placeholder (« ${tpl} »), sinon tous les noms seraient identiques.`;
}

/** Applique un modèle. */
export const expand = (tpl: string, v: Vars) => tpl.replace(/\{([a-z]+)\}/g, (_, k: string) => PLACEHOLDERS[k].value(v));

/** Motif d'un chemin produit par le modèle (suffixe `-2`, `-3`… d'une collision compris). */
export function pattern(tpl: string): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = tpl.split(/(\{[a-z]+\})/).map((p) => (/^\{[a-z]+\}$/.test(p) ? PLACEHOLDERS[p.slice(1, -1)].re : esc(p)));
  return new RegExp(`^${parts.join("")}(?:-\\d+)?$`);
}

/** Modèles en vigueur : config.json, sinon les valeurs par défaut (UUID v7). */
export async function naming(root: string): Promise<Record<NamingKey, string>> {
  const c = await loadConfig(root);
  return { raw_path: c.raw_path ?? NAMING_DEFAULTS.raw_path, page_path: c.page_path ?? NAMING_DEFAULTS.page_path };
}

/** Premier chemin libre : `p`, sinon `p-2`, `p-3`… (le suffixe va au dernier segment). */
export function free(p: string, taken: (p: string) => boolean): string {
  if (!taken(p)) return p;
  for (let n = 2; ; n++) if (!taken(`${p}-${n}`)) return `${p}-${n}`;
}

/** Id raw (dernier segment de son dossier) déjà pris quelque part sous raw/ ? Il doit être unique : le journal ne cite que lui. */
export const rawIdTaken = (root: string, id: string) =>
  existsSync(join(root, "raw")) && new Bun.Glob(`**/${id}/source.md`).scanSync(join(root, "raw")).next().done === false;

/**
 * `cortex new` : crée la page (frontmatter minimal, status: draft) au chemin donné par `page_path`, et renvoie ce chemin.
 * Refuse un titre déjà pris (mettre à jour avant de créer) en nommant la page existante.
 */
export async function newPage(root: string, type: string, title: string, at = new Date()): Promise<string> {
  const t = Object.keys(TYPE_DIRS).find((k) => k.toLowerCase() === type.toLowerCase());
  if (!t) throw new Error(`type inconnu : ${type} (${Object.keys(TYPE_DIRS).join(" | ")})`);
  if (!title.trim()) throw new Error("titre vide");
  const same = (await readDocs(root, "wiki")).find((d) => d.fm.title && slugify(String(d.fm.title)) === slugify(title));
  if (same) throw new Error(`une page porte déjà ce titre : ${same.path} (mets-la à jour plutôt que d'en créer une autre)`);
  const base = `wiki/${expand((await naming(root)).page_path, { at, title, type: t })}`;
  const path = `${free(base, (p) => existsSync(join(root, `${p}.md`)))}.md`;
  await Bun.write(join(root, path), `---\n${Bun.YAML.stringify({ type: t, title: title.trim(), status: "draft" }, null, 2)}\n---\n`);
  return path;
}
