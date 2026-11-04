import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fold } from "../site/src/lib/fold";
import { buildTerms } from "../site/src/lib/search-engine";
import type { GraphData, Link, Note, PageData, SearchIndex, SiteData, SourceRef } from "../site/src/lib/types";
import { type Doc, parseDoc, readDocs, related, sha256, slugify, wikiLinks } from "./lib";

export const SITE_DIR = join(import.meta.dir, "../site");

const iso = (x: unknown) => (x == null ? undefined : x instanceof Date ? x.toISOString() : String(x));
const stamp = (x: any) => (x?.at ? { by: String(x.by ?? ""), at: iso(x.at)! } : undefined);
const isWiki = (d: Doc) => !/^wiki\/(index|log)\.md$/.test(d.path);
const route = (path: string) => `${path.replace(/\.md$/, "")}/`; // wiki/concepts/x.md → wiki/concepts/x/
const id = (path: string) => path.replace(/^wiki\//, "").replace(/\.md$/, "");

/** Lien relatif d'une route à une autre (toutes deux « a/b/ ») : le site fonctionne sous n'importe quel préfixe. */
function rel(from: string, to: string): string {
  const a = from.split("/").filter(Boolean), b = to.split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const up = "../".repeat(a.length - i);
  return (up + b.slice(i).map((s) => `${s}/`).join("")) || "./";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const md = (s: string) => Bun.markdown.html(s, { tagFilter: true, headings: { ids: true }, autolinks: true });
const inline = (s: string) => md(s).trim().replace(/^<p>([\s\S]*)<\/p>$/, "$1");
export const plain = (html: string) => unesc(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/**
 * Corps Markdown → HTML. Liens `/wiki/x.md` réécrits en liens relatifs (un lien vers une page absente devient un
 * `<span class="lien-manquant">`, jamais un 404 ; un lien vers `raw/` n'est pas publié) ; notes `[^id]` numérotées.
 */
/**
 * Encart « Note personnelle » : la syntaxe de callout d'Obsidian `> [!note] Titre` (titre facultatif), rendue par Bun
 * comme une simple citation, devient un `<aside>` distinctif.
 */
export const noteCallouts = (html: string) =>
  html.replace(/<blockquote>\s*<p>\[!note\][ \t]*([^\n<]*)(\n|<\/p>\s*)([\s\S]*?)<\/blockquote>/gi, (_, title: string, sep: string, rest: string) =>
    `<aside class="note-perso" role="note"><p class="note-perso-titre">${title.trim() || "Note personnelle"}</p>${sep === "\n" ? "<p>" : ""}${rest}</aside>`);

function render(body: string, from: string, pages: Set<string>) {
  const defs = new Map<string, string>();
  const text = body.replace(/^\[\^([\w-]+)\]:[ \t]*(.*(?:\n[ \t]+\S.*)*)$/gm, (_, k, v) => (defs.set(k, v.replace(/\n[ \t]+/g, " ").trim()), ""));
  const order: string[] = [], seen = new Map<string, number>();
  const withRefs = text.replace(/\[\^([\w-]+)\](?!:)/g, (_, k) => {
    if (!order.includes(k)) order.push(k);
    const n = order.indexOf(k) + 1, c = (seen.set(k, (seen.get(k) ?? 0) + 1), seen.get(k));
    return `<sup class="fn-ref"><a href="#fn-${k}" id="fnref-${k}-${c}" aria-label="Note ${n}">${n}</a></sup>`;
  });
  const html = noteCallouts(md(withRefs)).replace(/<a href="(\/(?:wiki|raw)\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_, href: string, label: string) => {
    const [path, frag = ""] = href.split("#");
    const page = path.replace(/^\//, "");
    if (page === "wiki/index.md" || page === "wiki/log.md") return `<a href="${rel(from, page === "wiki/log.md" ? "log/" : "")}${frag && `#${frag}`}">${label}</a>`; // pages de navigation du site
    if (!pages.has(page)) return `<span class="lien-manquant" title="${page.startsWith("raw/") ? "source brute, non publiée" : "page à écrire"}">${label}</span>`;
    return `<a href="${rel(from, route(page))}${frag && `#${frag}`}">${label}</a>`;
  });
  const notes: Note[] = order.map((k, i) => ({
    n: i + 1, id: k,
    html: defs.has(k) ? inline(defs.get(k)!) : "",
  }));
  return { html, notes };
}

/**
 * Markdown de la page tel qu'il est dans le wiki (frontmatter compris), pour le bouton « Copier le Markdown ».
 * raw/ n'est pas publié : chaque chemin `/raw/…` devient l'URL d'origine de la source, ou disparaît si elle n'en a pas.
 */
function pageMarkdown(root: string, path: string): string {
  return readFileSync(join(root, path), "utf8")
    .replace(/\[([^\]]*)\]\((\/raw\/[^)\s]+)\)/g, (_, label: string, p: string) => { const u = originUrl(root, p); return u ? `[${label}](${u})` : label; })
    .replace(/\/raw\/[^\s)"'\]]+/g, (p) => originUrl(root, p) ?? "(source brute non publiée)");
}

/** URL d'origine d'une source : lue dans le frontmatter raw. Rien d'autre de raw/ n'est lu ni publié. */
function originUrl(root: string, resource: string): string | undefined {
  const f = join(root, resource);
  if (!existsSync(f) || !realpathSync(f).startsWith(realpathSync(join(root, "raw")) + sep)) return;
  const u = parseDoc(f, readFileSync(f, "utf8")).fm.url;
  return /^https?:\/\//.test(String(u)) ? String(u) : undefined;
}

/** Journal : wiki/log.md rendu en HTML. Seul endroit qui connaît le format du log (à remplacer si le journal change de format). */
async function renderLog(root: string, paths: Set<string>): Promise<string> {
  const f = join(root, "wiki/log.md");
  return existsSync(f) ? render(parseDoc("log", await Bun.file(f).text()).body, "log/", paths).html : "";
}

export async function buildSiteData(root: string) {
  const docs = (await readDocs(root, "wiki")).filter(isWiki).sort((a, b) => a.path.localeCompare(b.path));
  const paths = new Set<string>(docs.map((d) => d.path));
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const link = (d: Doc): Link => ({ id: id(d.path), title: String(d.fm.title ?? id(d.path)), type: String(d.fm.type ?? "") });

  // arêtes : liens Markdown entre pages wiki existantes
  const edges = new Map<string, string>(), back = new Map<string, Doc[]>();
  for (const d of docs) for (const t of wikiLinks(d)) {
    if (t === d.path || !paths.has(t)) continue;
    const pair = [id(d.path), id(t)];
    edges.set([...pair].sort().join("\t"), pair.join("\t")); // une arête par paire de pages, même si les liens vont dans les deux sens
    back.set(t, [...(back.get(t) ?? []), d]);
  }
  const resourcePage = new Map<string, Doc>(); // ressource raw → page Source du wiki qui la cite
  for (const d of docs) if (d.fm.type === "Source") for (const s of d.fm.sources ?? []) resourcePage.set(s.resource, d);

  const pages: PageData[] = docs.map((d) => {
    const { fm } = d;
    const r = render(d.body, route(d.path), paths);
    const sources: SourceRef[] = (fm.sources ?? []).map((s: any) => {
      const page = resourcePage.get(s.resource);
      return {
        id: String(s.id), title: String(s.title ?? s.id), url: originUrl(root, String(s.resource)),
        ...(page && page !== d && { page: link(page) }),
      };
    });
    const g = Date.parse(iso(fm.generated?.at) ?? ""), v = Date.parse(iso(fm.verified?.at) ?? "");
    return {
      id: id(d.path), type: String(fm.type ?? ""), title: String(fm.title ?? id(d.path)),
      description: String(fm.description ?? ""), tags: (fm.tags ?? []).map(String),
      status: String(fm.status ?? "draft"), verified: stamp(fm.verified), generated: stamp(fm.generated),
      stale_after: iso(fm.stale_after), needsReview: !!fm.verified && g > v,
      html: r.html, md: pageMarkdown(root, d.path), sources, notes: r.notes,
      backlinks: (back.get(d.path) ?? []).map(link).sort((a, b) => a.title.localeCompare(b.title)),
      related: related(docs, d.path).slice(0, 8).map((x) => ({ ...link(byPath.get(x.path)!), reasons: x.reasons.map((r) => r.replace(/ : \/raw\/.*$/, "")) })),
    };
  });

  const tagMap = new Map<string, string[]>();
  for (const p of pages) for (const t of p.tags) tagMap.set(t, [...(tagMap.get(t) ?? []), p.id]);
  const tags = [...tagMap].map(([tag, ids]) => ({ tag, slug: slugify(tag), ids })).sort((a, b) => b.ids.length - a.ids.length || a.tag.localeCompare(b.tag));

  const degree = new Map<string, number>();
  for (const e of edges.values()) for (const n of e.split("\t")) degree.set(n, (degree.get(n) ?? 0) + 1);
  const graph: GraphData = {
    nodes: pages.map((p) => ({ id: p.id, title: p.title, type: p.type, tags: p.tags, degree: degree.get(p.id) ?? 0 })),
    links: [...edges.values()].map((e) => { const [source, target] = e.split("\t"); return { source, target }; }),
  };

  const data: SiteData = { pages, tags, log: await renderLog(root, paths) };
  return { data, graph, search: buildSearch(pages) };
}

/** Index de recherche précalculé : index inversé sur le contenu complet (mot replié → pages) + vocabulaire d'autocomplétion. */
function buildSearch(pages: PageData[]): SearchIndex {
  const docs = pages.map((p) => ({ id: p.id, title: p.title, description: p.description, type: p.type, tags: p.tags, status: p.status, verified: !!p.verified, text: plain(p.html) }));
  const terms = buildTerms(docs);

  const freq = new Map<string, number>(), keep = new Set<string>();
  const words = (s: string) => fold(s).match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  pages.forEach((p) => {
    for (const w of words(`${p.title} ${p.tags.join(" ")}`)) keep.add(w);
    for (const w of words(`${p.title} ${p.description} ${p.tags.join(" ")} ${plain(p.html)}`)) freq.set(w, (freq.get(w) ?? 0) + 1);
  });
  const vocab = [...freq].filter(([w, n]) => keep.has(w) || (w.length >= 4 && n >= 2))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([w]) => w);
  return { docs, terms, vocab };
}

/**
 * Refuse un dossier de sortie que la construction viderait à tort : la racine, le wiki, raw/, le CLI, le HOME,
 * leurs parents, et tout dossier non vide qui ne ressemble pas à un export précédent (pas de `_app/`).
 */
export function checkOut(root: string, out: string) {
  const o = resolve(out), keep = [root, join(root, "wiki"), join(root, "raw"), dirname(SITE_DIR), homedir(), "/"].map((p) => resolve(p));
  if (keep.some((p) => p === o || p.startsWith(o + sep))) throw new Error(`--out ${o} : refusé, ce dossier est vidé à chaque export et contient (ou est) un dossier à garder.`);
  if (existsSync(o) && readdirSync(o).length && !existsSync(join(o, "_app"))) throw new Error(`--out ${o} : refusé, ce dossier n'est pas vide et ne ressemble pas à un export précédent (pas de _app/).`);
}

export async function exportSite(root: string, out: string, say: (m: string) => void = console.log) {
  checkOut(root, out);
  const t0 = performance.now();
  const dataDir = join(root, ".brain/site-data");
  const { data, graph, search } = await buildSiteData(root);
  mkdirSync(dataDir, { recursive: true });
  const parts: string[] = [];
  const size = async (name: string, v: unknown) => { const s = JSON.stringify(v); parts.push(s); await Bun.write(join(dataDir, name), s); return s.length; };
  await size("data.json", data);
  await size("graph.json", graph);
  const idxBytes = await size("search-index.json", search);
  say(`${data.pages.length} pages, ${graph.links.length} liens, index de recherche ${(idxBytes / 1024).toFixed(0)} Ko`);

  // Vite et SvelteKit ne se chargent qu'ici : les autres commandes restent aussi rapides
  Object.assign(process.env, { BRAIN_SITE_DATA: dataDir, BRAIN_SITE_OUT: resolve(out), BRAIN_SITE_VERSION: sha256(parts.join("")).slice(0, 12) }); // version = empreinte des données : même wiki, même site
  const cwd = process.cwd(), log = console.log;
  console.log = () => {}; // SvelteKit et l'adapter bavardent (« npm run preview »…) ; les erreurs passent par console.error
  try {
    const { createBuilder } = await import("vite");
    rmSync(join(SITE_DIR, ".svelte-kit"), { recursive: true, force: true }); // pas de morceaux périmés d'un export précédent
    process.chdir(SITE_DIR); // SvelteKit résout src/ et .svelte-kit depuis le dossier courant
    // build() ne construit qu'un environnement : SvelteKit orchestre client, serveur, prérendu et adapter via buildApp
    await (await createBuilder({ root: SITE_DIR, logLevel: "warn" })).buildApp();
  } catch (e) {
    const m = (e as Error).message;
    if (/native binding/i.test(m)) throw new Error(`binding natif de Vite introuvable pour ${process.platform}-${process.arch} : réinstalle avec « bun install --cwd cli --omit optional » (voir DESIGN §9).`);
    throw e;
  } finally { process.chdir(cwd); console.log = log; }
  say(`Site écrit dans ${resolve(out)} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
}
