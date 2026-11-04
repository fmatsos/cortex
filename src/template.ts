import { localIso, slugify } from "./lib";

/**
 * Pure part of the naming: placeholders, template validation, expansion, matching pattern.
 * No config access, so that config.ts (which validates the templates) and naming.ts (which reads them) both import it without a cycle.
 *
 * Naming and layout of raw sources and wiki pages: one template per kind, in config.json.
 * `raw_path` gives the folder of a source under raw/ (containing source.md), its last segment is the raw id;
 * `page_path` gives the path of a page under wiki/, without `.md`. `/` creates subfolders.
 * Only the CLI applies these templates (`cortex add`, `cortex new`): neither the agent nor the human invents a name.
 */
export const NAMING_DEFAULTS = { raw_path: "{yyyy}/{mm}/{uuid}", page_path: "{type}/{uuid}" } as const;
export type NamingKey = keyof typeof NAMING_DEFAULTS;

/** Folder of each wiki page type (placeholder `{type}`). */
export const TYPE_DIRS = { Source: "sources", Concept: "concepts", Entity: "entities", Synthesis: "syntheses" } as const;
export type PageType = keyof typeof TYPE_DIRS;

const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** Placeholders: value (at creation) and pattern (for lint). Dates in local time, like `fetched_at`. */
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
export type Vars = { at: Date; title: string; type?: PageType; kind?: string };

function rand4(): string {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  return [...crypto.getRandomValues(new Uint8Array(4))].map((b) => a[b % 36]).join("");
}

/** Allowed placeholders for a template, with their description (help and error messages). */
export const placeholders = (key: NamingKey) =>
  Object.entries(PLACEHOLDERS).filter(([, p]) => !p.for || p.for === key).map(([k, p]) => `{${k}} ${p.doc}`);

/** Valid template, otherwise the error message. */
export function checkTemplate(key: NamingKey, tpl: string): string | undefined {
  const allowed = Object.keys(PLACEHOLDERS).filter((k) => !PLACEHOLDERS[k].for || PLACEHOLDERS[k].for === key);
  const segs = tpl.split("/");
  if (segs.some((s) => !s || s === "." || s === "..")) return `${key} : segments vides, « . » et « .. » interdits (« ${tpl} »).`;
  for (const [, name] of tpl.matchAll(/\{([^}]*)\}/g)) if (!allowed.includes(name)) return `${key} : placeholder inconnu {${name}} (permis : ${allowed.map((a) => `{${a}}`).join(", ")}).`;
  if (/[^A-Za-z0-9._\/-]/.test(tpl.replace(/\{[a-z]+\}/g, ""))) return `${key} : hors placeholders, seuls lettres, chiffres, « . », « _ », « - » et « / » sont permis (« ${tpl} »).`;
  if (!/\{[a-z]+\}/.test(segs.at(-1)!)) return `${key} : le dernier segment doit contenir un placeholder (« ${tpl} »), sinon tous les noms seraient identiques.`;
}

/** Applies a template. */
export const expand = (tpl: string, v: Vars) => tpl.replace(/\{([a-z]+)\}/g, (_, k: string) => PLACEHOLDERS[k].value(v));

/** Pattern of a path produced by the template (including the `-2`, `-3`… suffix of a collision). */
export function pattern(tpl: string): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = tpl.split(/(\{[a-z]+\})/).map((p) => (/^\{[a-z]+\}$/.test(p) ? PLACEHOLDERS[p.slice(1, -1)].re : esc(p)));
  return new RegExp(`^${parts.join("")}(?:-\\d+)?$`);
}

