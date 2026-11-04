import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Racine du cerveau : $BRAIN_ROOT, sinon le premier dossier parent qui contient BRAIN.md. */
export function findRoot(from = process.cwd()): string {
  if (process.env.BRAIN_ROOT) return process.env.BRAIN_ROOT;
  for (let d = from; ; d = dirname(d)) {
    if (existsSync(join(d, "BRAIN.md"))) return d;
    if (dirname(d) === d) throw new Error("BRAIN.md introuvable : lance brain dans le dépôt ou définis BRAIN_ROOT.");
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

export function randomId4(): string {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  return [...crypto.getRandomValues(new Uint8Array(4))].map((b) => a[b % 36]).join("");
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

/** Ajoute une puce en tête de la section du jour de wiki/log.md (crée la section si besoin). */
export async function appendLog(root: string, line: string, d = new Date()) {
  const f = join(root, "wiki/log.md");
  const day = localIso(d).slice(0, 10);
  let txt = (await Bun.file(f).exists()) ? await Bun.file(f).text() : "# Log\n";
  const h = `## ${day}\n`;
  if (txt.includes(h)) txt = txt.replace(h, `${h}- ${line}\n`);
  else txt = txt.replace(/^# Log\n\n?/, `# Log\n\n${h}- ${line}\n\n`);
  await Bun.write(f, txt);
}
