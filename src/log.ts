import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { localIso } from "./lib";

/**
 * Journal : wiki/log.jsonl (une entrée par ligne, ordre chronologique, append-only) est la source de vérité ;
 * wiki/log.md (réservé OKF) en est généré, comme wiki/index.md.
 */
export const KINDS = ["add", "ingest", "query", "lint", "update"] as const;
export type Kind = (typeof KINDS)[number];
/** `sources` : ids raw ; `pages` : chemins `wiki/…md`. Champs vides omis. */
export type LogEntry = { at: string; kind: Kind; text: string; sources?: string[]; pages?: string[] };

const LABEL: Record<Kind, string> = { add: "Add", ingest: "Ingest", query: "Query", lint: "Lint", update: "Update" };
export const kindLabel = (k: string) => LABEL[k as Kind] ?? k;

const AT = /^\d{4}-\d\d-\d\d(T\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d))?$/;
const RAW_ID = /^\d{8}-[a-z0-9]{4}-[a-z0-9-]+$/;
const KEYS = new Set(["at", "kind", "text", "sources", "pages"]);

/** Entrée valide ou message d'erreur (une seule erreur par ligne : la première). */
export function parseEntry(v: unknown): LogEntry | string {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "l'entrée doit être un objet JSON";
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!KEYS.has(k)) return `champ inconnu : ${k}`;
  if (typeof o.at !== "string" || !AT.test(o.at) || Number.isNaN(Date.parse(o.at))) return "at : ISO 8601 avec décalage, ou AAAA-MM-JJ";
  if (!KINDS.includes(o.kind as Kind)) return `kind : ${KINDS.join("|")}`;
  if (typeof o.text !== "string" || !o.text.trim() || /[\r\n]/.test(o.text)) return "text : une ligne non vide";
  for (const [k, ok] of [["sources", (s: string) => RAW_ID.test(s)], ["pages", (s: string) => /^wiki\/.+\.md$/.test(s)]] as const) {
    if (o[k] === undefined) continue;
    const a = o[k];
    if (!Array.isArray(a) || !a.length || a.some((s) => typeof s !== "string" || !ok(s))) return `${k} : liste non vide ${k === "sources" ? "d'ids raw" : "de chemins wiki/….md"} (champ omis s'il est vide)`;
  }
  return o as LogEntry;
}

/** Lit wiki/log.jsonl : entrées valides (ordre du fichier) et erreurs par ligne. Fichier absent = journal vide. */
export function readLog(root: string): { entries: LogEntry[]; errors: { line: number; msg: string }[] } {
  const f = join(root, "wiki/log.jsonl");
  const entries: LogEntry[] = [], errors: { line: number; msg: string }[] = [];
  if (!existsSync(f)) return { entries, errors };
  readFileSync(f, "utf8").split("\n").forEach((l, i) => {
    if (!l.trim()) return;
    let v: unknown;
    try { v = JSON.parse(l); } catch { errors.push({ line: i + 1, msg: "JSON invalide" }); return; }
    const e = parseEntry(v);
    if (typeof e === "string") errors.push({ line: i + 1, msg: e }); else entries.push(e);
  });
  return { entries, errors };
}

const day = (e: LogEntry) => e.at.slice(0, 10);
/** Du plus récent au plus ancien : jours décroissants, et dans un jour l'ordre inverse du fichier. */
export const newestFirst = (entries: LogEntry[]) =>
  entries.map((e, i) => [e, i] as const).sort(([a, i], [b, j]) => (day(a) === day(b) ? j - i : day(b).localeCompare(day(a)))).map(([e]) => e);

/** Entrées des `n` jours les plus récents qui en ont (plus récent d'abord), filtrées par `kind` si donné. */
export function lastDays(entries: LogEntry[], n: number, kind?: string): LogEntry[] {
  const all = newestFirst(entries.filter((e) => !kind || e.kind === kind));
  const days = [...new Set(all.map(day))].slice(0, n);
  return all.filter((e) => days.includes(day(e)));
}

/** Le texte nomme déjà la page par son slug (mot entier : `concepts/{a, b}` nomme `a` et `b`). */
const namesPage = (text: string, p: string) =>
  new RegExp(`(?<![\\w-])${p.replace(/\.md$/, "").split("/").at(-1)!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(text);
/** Le texte nomme déjà l'id raw, en entier ou abrégé (`AAAAMMJJ-xxxx`, `xxxx`). */
const namesId = (text: string, id: string) => [id, id.slice(0, 13), id.split("-")[1]].some((f) => text.includes(`\`${f}\``));

/** Une ligne de log.md : le texte, puis les sources et pages que le texte ne nomme pas déjà. */
function renderLine(e: LogEntry): string {
  const src = (e.sources ?? []).filter((s) => !namesId(e.text, s)).map((s) => `\`${s}\``);
  const pages = (e.pages ?? []).filter((p) => !namesPage(e.text, p)).map((p) => `[${p.replace(/^wiki\/|\.md$/g, "")}](/${p})`);
  const refs = [src.length && `sources : ${src.join(", ")}`, pages.length && `pages : ${pages.join(", ")}`].filter(Boolean).join(" ; ");
  return `- **${kindLabel(e.kind)}** ${e.text}${refs ? ` (${refs})` : ""}\n`;
}

/** wiki/log.md : le journal, sections par date (la plus récente d'abord). Déterministe. */
export function renderLogMd(entries: LogEntry[]): string {
  let out = "# Log\n\n> Généré depuis `wiki/log.jsonl` : ne pas éditer à la main (`brain log add`, puis `brain index`).\n";
  let cur = "";
  for (const e of newestFirst(entries)) {
    if (day(e) !== cur) out += `\n## ${(cur = day(e))}\n`;
    out += renderLine(e);
  }
  return out;
}

export async function writeLogMd(root: string) {
  await Bun.write(join(root, "wiki/log.md"), renderLogMd(readLog(root).entries));
}

/** Ajoute une ligne à wiki/log.jsonl (un seul append) puis régénère wiki/log.md. */
export async function appendLog(root: string, entry: Omit<LogEntry, "at">, d = new Date()) {
  const e: LogEntry = { at: localIso(d), kind: entry.kind, text: entry.text.replace(/\s*[\r\n]+\s*/g, " ").trim() };
  if (entry.sources?.length) e.sources = entry.sources;
  if (entry.pages?.length) e.pages = entry.pages;
  const bad = parseEntry(e);
  if (typeof bad === "string") throw new Error(`Entrée de journal invalide : ${bad}`);
  const f = join(root, "wiki/log.jsonl");
  mkdirSync(dirname(f), { recursive: true });
  // le fichier se termine par une fin de ligne ; sinon (édition à la main) l'entrée se collerait à la précédente
  const prev = existsSync(f) ? readFileSync(f, "utf8") : "";
  await appendFile(f, `${prev && !prev.endsWith("\n") ? "\n" : ""}${JSON.stringify(e)}\n`);
  await writeLogMd(root);
}

/** `brain log add` : valide les références (pages existantes sous wiki/, ids raw existants) avant d'écrire. */
export async function logAdd(root: string, kind: string, text: string, sources: string[] = [], pages: string[] = [], d = new Date()): Promise<LogEntry> {
  if (!KINDS.includes(kind as Kind)) throw new Error(`kind inconnu : ${kind} (${KINDS.join(" | ")})`);
  if (!text.trim()) throw new Error("texte vide");
  const wiki = resolve(root, "wiki");
  const pp = pages.map((p) => {
    const rel = normalize(p.trim().replace(/^\/+/, ""));
    const abs = resolve(root, rel);
    if (!abs.startsWith(wiki + sep) || !rel.endsWith(".md") || /^wiki\/(index|log)\.md$/.test(rel) || !existsSync(abs)) throw new Error(`page introuvable sous wiki/ : ${p}`);
    return rel.split(sep).join("/");
  });
  for (const s of sources)
    if (!RAW_ID.test(s) || !existsSync(join(root, "raw", s.slice(0, 4), s.slice(4, 6), s, "source.md"))) throw new Error(`source raw introuvable : ${s}`);
  await appendLog(root, { kind: kind as Kind, text, sources: [...new Set(sources)], pages: [...new Set(pp)] }, d);
  return readLog(root).entries.at(-1)!;
}
