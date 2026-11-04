import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Wiki root: $CORTEX_ROOT, otherwise the nearest parent directory holding cortex.json. */
export function findRoot(from = process.cwd()): string {
  if (process.env.CORTEX_ROOT) return process.env.CORTEX_ROOT;
  for (let d = from; ; d = dirname(d)) {
    if (existsSync(join(d, "cortex.json"))) return d;
    if (dirname(d) === d) throw new Error("cortex.json introuvable : lance cortex dans le wiki (cortex config init le crée) ou définis CORTEX_ROOT.");
  }
}

export type Doc = { path: string; fm: Record<string, any>; body: string };

export function parseDoc(path: string, txt: string): Doc {
  const m = txt.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { path, fm: {}, body: txt };
  return { path, fm: (Bun.YAML.parse(m[1]) as any) ?? {}, body: txt.slice(m[0].length) };
}

/** Fichiers .md sous `dir` (relatif à root), chemins renvoyés relatifs à root. */
export async function readDocs(root: string, dir: string): Promise<Doc[]> {
  const out: Doc[] = [];
  if (!existsSync(join(root, dir))) return out;
  for (const f of new Bun.Glob("**/*.md").scanSync(join(root, dir))) {
    const path = `${dir}/${f}`;
    out.push(parseDoc(path, await Bun.file(join(root, path)).text()));
  }
  return out;
}

/** Horodatage ISO local avec le vrai décalage horaire (gère l'heure d'été). */
export function localIso(d = new Date()): string {
  const off = -d.getTimezoneOffset();
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19);
  return `${local}${off >= 0 ? "+" : "-"}${p(off / 60)}:${p(off % 60)}`;
}

export function slugify(s: string, max = 50): string {
  const words = s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let out = "";
  for (const w of words) if ((out + "-" + w).length <= max + 1) out += "-" + w; else break;
  return out.slice(1) || "source";
}

/** UUID v7 : horodaté puis aléatoire, trié dans l'ordre de création (nommage par défaut, voir naming.ts). */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const newId = (at = new Date()) => Bun.randomUUIDv7("hex", at);

/** Id raw : le dernier segment du dossier d'une source (unique sous raw/). */
export const RAW_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Chemin (relatif à root) de la source raw `id`, où que le nommage l'ait rangée sous raw/ ; undefined si absente. */
export function rawPath(root: string, id: string): string | undefined {
  if (!RAW_ID.test(id) || !existsSync(join(root, "raw"))) return;
  for (const f of new Bun.Glob(`**/${id}/source.md`).scanSync(join(root, "raw"))) return `raw/${f}`;
}

export const sha256 = (s: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

/** URL comparable : sans fragment, sans paramètres de tracking, sans / final, hôte en minuscules. */
export function normUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|source$)/.test(k)) x.searchParams.delete(k);
    return (x.origin.toLowerCase() + x.pathname.replace(/\/+$/, "") + x.search);
  } catch { return u; }
}

const norm = (p: string) => p.trim().replace(/^\/+/, "");
export type Related = { path: string; title: string; score: number; reasons: string[] };

export const wikiLinks = (d: Doc) => new Set([...d.body.matchAll(/\]\((\/wiki\/[^)#\s]+)/g)].map((m) => norm(m[1])));
const resources = (d: Doc) => new Set<string>((d.fm.sources ?? []).map((s: any) => s.resource));

/**
 * Pages wiki liées à `path`, par force décroissante : lien sortant ou entrant (3 chacun), source raw partagée (2),
 * tag partagé (1). Pure : travaille sur les pages déjà lues (index.md et log.md exclus).
 */
export function related(docs: Doc[], path: string): Related[] {
  const pages = docs.filter((d) => !/^wiki\/(index|log)\.md$/.test(d.path));
  const me = pages.find((d) => d.path === norm(path));
  if (!me) throw new Error(`Page wiki introuvable : ${path}`);
  const out = wikiLinks(me), mine = resources(me), tags = new Set<string>(me.fm.tags ?? []);
  const hits: Related[] = [];
  for (const d of pages) {
    if (d === me) continue;
    const reasons: string[] = [];
    let score = 0;
    const plus = (n: number, why: string) => { score += n; reasons.push(why); };
    if (out.has(d.path)) plus(3, "lien sortant");
    if (wikiLinks(d).has(me.path)) plus(3, "lien entrant");
    for (const r of resources(d)) if (mine.has(r)) plus(2, `source partagée : ${r}`);
    for (const t of d.fm.tags ?? []) if (tags.has(t)) plus(1, `tag partagé : ${t}`);
    if (score) hits.push({ path: d.path, title: String(d.fm.title ?? ""), score, reasons });
  }
  return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

