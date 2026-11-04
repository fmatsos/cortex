import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { localIso, RAW_ID, isReservedPage, rawPath, readDocs, slugify } from "./lib";

/**
 * Journal: wiki/log.jsonl (one entry per line, chronological order, append-only) is the source of truth;
 * wiki/log.md (OKF-reserved) is generated from it, like wiki/index.md.
 */
export const KINDS = ["add", "ingest", "query", "lint", "update"] as const;
export type Kind = (typeof KINDS)[number];
/** `sources`: raw ids; `pages`: `wiki/…md` paths. Empty fields omitted. */
export type LogEntry = { at: string; kind: Kind; text: string; sources?: string[]; pages?: string[] };

const LABEL: Record<Kind, string> = { add: "Add", ingest: "Ingest", query: "Query", lint: "Lint", update: "Update" };
export const kindLabel = (k: string) => LABEL[k as Kind] ?? k;

const AT = /^\d{4}-\d\d-\d\d(T\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d))?$/;
const KEYS = new Set(["at", "kind", "text", "sources", "pages"]);

/** Valid entry or error message (a single error per line: the first). */
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

/** Reads wiki/log.jsonl: valid entries (file order) and per-line errors. Missing file = empty journal. */
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
/** Most recent to oldest: days descending, and within a day the reverse of file order. */
export const newestFirst = (entries: LogEntry[]) =>
  entries.map((e, i) => [e, i] as const).sort(([a, i], [b, j]) => (day(a) === day(b) ? j - i : day(b).localeCompare(day(a)))).map(([e]) => e);

/** Entries of the `n` most recent days that have any (most recent first), filtered by `kind` if given. */
export function lastDays(entries: LogEntry[], n: number, kind?: string): LogEntry[] {
  const all = newestFirst(entries.filter((e) => !kind || e.kind === kind));
  const days = [...new Set(all.map(day))].slice(0, n);
  return all.filter((e) => days.includes(day(e)));
}

/** Title of each wiki page (path → title): pages are named by their title, not by their file name. */
export type Titles = Map<string, string>;
export const pageTitles = async (root: string): Promise<Titles> =>
  new Map((await readDocs(root, "wiki")).docs.filter((d) => d.fm.title).map((d) => [d.path, String(d.fm.title)]));

const words = (s: string) => `-${slugify(s, Infinity)}-`;
/** The text already names the page: its file name or its title, whole words, ignoring accents and case. */
const namesPage = (text: string, p: string, title?: string) =>
  text.includes(p.replace(/\.md$/, "").split("/").at(-1)!) || (!!title && words(text).includes(words(title)));
const namesId = (text: string, id: string) => text.includes(`\`${id}\``);

/** A line of log.md: the text, then the sources and pages that the text does not already name. */
function renderLine(e: LogEntry, titles: Titles): string {
  const src = (e.sources ?? []).filter((s) => !namesId(e.text, s)).map((s) => `\`${s}\``);
  const pages = (e.pages ?? []).filter((p) => !namesPage(e.text, p, titles.get(p))).map((p) => `[${titles.get(p) ?? p.replace(/^wiki\/|\.md$/g, "")}](/${p})`);
  const refs = [src.length && `sources : ${src.join(", ")}`, pages.length && `pages : ${pages.join(", ")}`].filter(Boolean).join(" ; ");
  return `- **${kindLabel(e.kind)}** ${e.text}${refs ? ` (${refs})` : ""}\n`;
}

/** wiki/log.md: the journal, sections by date (most recent first). Deterministic. */
export function renderLogMd(entries: LogEntry[], titles: Titles = new Map()): string {
  let out = "# Log\n\n> Généré depuis `wiki/log.jsonl` : ne pas éditer à la main (`cortex log add`, puis `cortex index`).\n";
  let cur = "";
  for (const e of newestFirst(entries)) {
    if (day(e) !== cur) out += `\n## ${(cur = day(e))}\n`;
    out += renderLine(e, titles);
  }
  return out;
}

export async function writeLogMd(root: string) {
  await Bun.write(join(root, "wiki/log.md"), renderLogMd(readLog(root).entries, await pageTitles(root)));
}

/** Appends a line to wiki/log.jsonl (a single append) then regenerates wiki/log.md. */
export async function appendLog(root: string, entry: Omit<LogEntry, "at">, d = new Date()) {
  const e: LogEntry = { at: localIso(d), kind: entry.kind, text: entry.text.replace(/\s*[\r\n]+\s*/g, " ").trim() };
  if (entry.sources?.length) e.sources = entry.sources;
  if (entry.pages?.length) e.pages = entry.pages;
  const bad = parseEntry(e);
  if (typeof bad === "string") throw new Error(`Entrée de journal invalide : ${bad}`);
  const f = join(root, "wiki/log.jsonl");
  mkdirSync(dirname(f), { recursive: true });
  // the file ends with a newline; otherwise (hand edit) the entry would stick to the previous one
  const prev = existsSync(f) ? readFileSync(f, "utf8") : "";
  await appendFile(f, `${prev && !prev.endsWith("\n") ? "\n" : ""}${JSON.stringify(e)}\n`);
  await writeLogMd(root);
}

/** `cortex log add`: validates references (existing pages under wiki/, existing raw ids) before writing. */
export async function logAdd(root: string, kind: string, text: string, sources: string[] = [], pages: string[] = [], d = new Date()): Promise<LogEntry> {
  if (!KINDS.includes(kind as Kind)) throw new Error(`kind inconnu : ${kind} (${KINDS.join(" | ")})`);
  if (!text.trim()) throw new Error("texte vide");
  const wiki = resolve(root, "wiki");
  const pp = pages.map((p) => {
    const rel = normalize(p.trim().replace(/^\/+/, ""));
    const abs = resolve(root, rel);
    if (!abs.startsWith(wiki + sep) || !rel.endsWith(".md") || isReservedPage(rel) || !existsSync(abs)) throw new Error(`page introuvable sous wiki/ : ${p}`);
    return rel.split(sep).join("/");
  });
  for (const s of sources)
    if (!rawPath(root, s)) throw new Error(`source raw introuvable : ${s}`);
  await appendLog(root, { kind: kind as Kind, text, sources: [...new Set(sources)], pages: [...new Set(pp)] }, d);
  return readLog(root).entries.at(-1)!;
}
