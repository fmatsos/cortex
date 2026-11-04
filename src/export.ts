import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fold } from "../site/src/lib/fold";
import { buildTerms } from "../site/src/lib/search-engine";
import type { GraphData, Link, LogEntryData, Note, PageData, SearchIndex, SiteData, SourceRef } from "../site/src/lib/types";
import { newestFirst, readLog } from "./log";
import { type Doc, parseDoc, readDocs, related, sha256, slugify, wikiLinks } from "./lib";
import { sanitizeHtml } from "./sanitize";

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
/** Markdown → HTML assaini (liste blanche, voir sanitize.ts) : le site l'injecte avec `{@html}`, donc rien d'autre n'en sort. */
export const md = (s: string) => sanitizeHtml(Bun.markdown.html(s, { tagFilter: true, headings: { ids: true }, autolinks: true }));
/** Tri des listes : ordre alphabétique français des titres visibles, pas l'ordre des chemins. */
const collator = new Intl.Collator("fr");
export const byTitle = (a: { title: string; id?: string }, b: { title: string; id?: string }) => collator.compare(a.title, b.title) || collator.compare(a.id ?? "", b.id ?? "");
const inline = (s: string) => md(s).trim().replace(/^<p>([\s\S]*)<\/p>$/, "$1");
export const plain = (html: string) => unesc(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/**
 * Corps Markdown → HTML. Liens `/wiki/x.md` réécrits en liens relatifs (un lien vers une page absente devient un
 * `<span class="lien-manquant">`, jamais un 404 ; un lien vers `raw/` n'est pas publié) ; notes `[^id]` numérotées.
 */
/**
 * Un avertissement de contenu partiel (paywall, aperçu) s'écrit dans l'encart de la note, sur une ligne `⚠️ …`.
 * Reconnu ici pour la métadonnée `partial` ; les autres avertissements ne comptent pas.
 */
export const isPartialWarning = (text: string) => /\b(?:partiel(?:le)?s?|paywall|aper[cç]u public|tronqu[eé]e?s?)\b/i.test(text);

/** Dans un corps d'encart : la ligne qui commence par ⚠️ (et celles qui la suivent dans le paragraphe) en sort. */
function splitWarnings(inner: string): { body: string; warnings: string[] } {
  const warnings: string[] = [];
  const body = inner.replace(/<p>([\s\S]*?)<\/p>/g, (all, text: string) => {
    const lines = text.split("\n"), at = lines.findIndex((l) => /^\s*⚠️?/.test(l));
    if (at < 0) return all;
    warnings.push(lines.slice(at).join("\n").replace(/^\s*⚠️?\s*/, "").trim());
    const keep = lines.slice(0, at).join("\n").trim();
    return keep ? `<p>${keep}</p>` : "";
  });
  return { body: warnings.length ? body.replace(/\n\s*\n/g, "\n") : body, warnings };
}
const warningAside = (title: string, inner: string) => `<aside class="callout-warning" role="note"><p class="callout-warning-titre">${title}</p>${inner}</aside>`;

/**
 * Encarts : la syntaxe de callout d'Obsidian `> [!note] Titre` (titre facultatif), rendue par Bun comme une simple
 * citation, devient un `<aside class="note-perso">` ; `> [!warning] Titre` (ou caution, attention) un
 * `<aside class="callout-warning">`. Dans une note, une ligne `⚠️ …` sort de l'encart pour former, à sa suite, un encart
 * d'avertissement distinct. Les titres sont dans un `<p …-titre>`, hors du texte indexé.
 */
export const noteCallouts = (html: string) =>
  html.replace(/<blockquote>\s*<p>\[!(note|warning|caution|attention)\][ \t]*([^\n<]*)(\n|<\/p>\s*)([\s\S]*?)<\/blockquote>/gi, (_, kind: string, title: string, sep: string, rest: string) => {
    const inner = (sep === "\n" ? "<p>" : "") + rest, t = title.trim();
    if (kind.toLowerCase() !== "note") return warningAside(t || "Avertissement", inner.replace(/^<p>\s*⚠️?\s*/, "<p>"));
    const { body, warnings } = splitWarnings(inner);
    return `<aside class="note-perso" role="note"><p class="note-perso-titre">${t || "Note personnelle"}</p>${body}</aside>` +
      (warnings.length ? warningAside("Avertissement", warnings.map((w) => `<p>${w}</p>`).join("")) : "");
  });

/**
 * Ancres stables des titres : le texte du titre sans accents (le slug de Bun les supprime : « Détail » → « dtail »),
 * suffixé -1, -2… en cas de doublon. Un slug qui ressemblerait à un id de l'interface (`fn-`, `fnref-`, `src-`, `h-`,
 * `contenu-principal`) est préfixé par `t-`.
 */
export function anchors(html: string): string {
  const seen = new Map<string, number>();
  return html.replace(/<h([1-6])(?: id="[^"]*")?>([\s\S]*?)<\/h\1>/g, (_, l: string, inner: string) => {
    let slug = fold(plain(inner)).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "titre";
    if (/^(fn|fnref|src|h)-|^contenu-principal$/.test(slug)) slug = `t-${slug}`;
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    return `<h${l} id="${n ? `${slug}-${n}` : slug}">${inner}</h${l}>`;
  });
}

/**
 * Tableaux : chacun est enveloppé dans un conteneur `.table-wrap`, la région qui défile (horizontalement, et verticalement
 * pour un tableau haut). `tabindex="0"` la rend atteignable et défilable au clavier, `role="region"` et `aria-label` la nomment
 * par le titre qui précède. Ajouté après l'assainissement : le contenu auteur ne peut ni écrire ces attributs ni cette classe.
 */
export function wrapTables(html: string): string {
  const total = (html.match(/<table[\s>]/g) ?? []).length;
  if (!total) return html;
  let n = 0, heading = "";
  return html.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>|<table[\s>][\s\S]*?<\/table>/g, (m, h?: string) => {
    if (h !== undefined) { heading = plain(h); return m; }
    n++;
    const name = `Tableau${total > 1 ? ` ${n} sur ${total}` : ""}${heading ? ` : ${heading}` : ""}`;
    return `<div class="table-wrap" role="region" tabindex="0" aria-label="${esc(name)}">${m}</div>`;
  });
}

export function render(body: string, from: string, pages: Set<string>) {
  const defs = new Map<string, string>();
  const text = body.replace(/^\[\^([\w-]+)\]:[ \t]*(.*(?:\n[ \t]+\S.*)*)$/gm, (_, k, v) => (defs.set(k, v.replace(/\n[ \t]+/g, " ").trim()), ""));
  const order: string[] = [], seen = new Map<string, number>();
  const withRefs = text.replace(/\[\^([\w-]+)\](?!:)/g, (_, k) => {
    if (!order.includes(k)) order.push(k);
    const n = order.indexOf(k) + 1, c = (seen.set(k, (seen.get(k) ?? 0) + 1), seen.get(k));
    return `<sup class="fn-ref"><a href="#fn-${k}" id="fnref-${k}-${c}" aria-label="Note ${n}">${n}</a></sup>`;
  });
  const html = wrapTables(anchors(noteCallouts(md(withRefs))).replace(/<a href="(\/(?:wiki|raw)\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_, href: string, label: string) => {
    const [path, frag = ""] = href.split("#");
    const page = path.replace(/^\//, "");
    if (page === "wiki/index.md" || page === "wiki/log.md") return `<a href="${rel(from, page === "wiki/log.md" ? "log/" : "")}${frag && `#${frag}`}">${label}</a>`; // pages de navigation du site
    if (!pages.has(page)) return `<span class="lien-manquant" title="${page.startsWith("raw/") ? "source brute, non publiée" : "page à écrire"}">${label}</span>`;
    return `<a href="${rel(from, route(page))}${frag && `#${frag}`}">${label}</a>`;
  }));
  const notes: Note[] = order.map((k, i) => ({
    n: i + 1, id: k, refs: seen.get(k) ?? 1, // refs : nombre d'occurrences dans le texte (un retour ↩ par occurrence)
    html: defs.has(k) ? inline(defs.get(k)!) : "",
  }));
  const toc = [...html.matchAll(/<h([23]) id="([^"]+)">([\s\S]*?)<\/h\1>/g)].map((m) => ({ level: +m[1] as 2 | 3, id: m[2], text: plain(m[3]) }));
  const warnings = [...html.matchAll(/<aside class="callout-warning"[^>]*>([\s\S]*?)<\/aside>/g)].map((m) => plain(m[1].replace(/<p class="callout-warning-titre">[^<]*<\/p>/, "")));
  return { html, notes, toc, warnings };
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

/** Frontmatter d'une source raw (lecture seule, confinée à raw/). Seuls `url` et `partial` en sortent, jamais le corps. */
function rawFm(root: string, resource: string): Record<string, any> | undefined {
  const f = join(root, resource);
  if (!existsSync(f) || !realpathSync(f).startsWith(realpathSync(join(root, "raw")) + sep)) return;
  return parseDoc(f, readFileSync(f, "utf8")).fm;
}

/** URL d'origine d'une source : lue dans le frontmatter raw. Rien d'autre de raw/ n'est lu ni publié. */
function originUrl(root: string, resource: string): string | undefined {
  const u = rawFm(root, resource)?.url;
  return /^https?:\/\//.test(String(u)) ? String(u) : undefined;
}

/** Extraction partielle (`partial:` dans le frontmatter raw, écrit par `brain add` en cas de paywall). */
const rawPartial = (root: string, resource: string) => {
  const p = rawFm(root, resource)?.partial;
  return p != null && p !== false && String(p).trim() !== "" && !/^(false|no|non|0)$/i.test(String(p).trim());
};

/**
 * Journal : wiki/log.jsonl en entrées structurées (plus récente d'abord). Le texte est rendu en HTML en ligne ; les pages
 * citées deviennent des liens (page absente : ignorée), les sources la page Source du wiki qui les cite (raw/ n'est pas publié).
 */
function renderLog(root: string, paths: Set<string>, byPath: Map<string, Doc>, sourcePage: Map<string, Doc>, link: (d: Doc) => Link): LogEntryData[] {
  return newestFirst(readLog(root).entries).map((e) => {
    const sources = (e.sources ?? []).map((id) => {
      const page = sourcePage.get(`/raw/${id.slice(0, 4)}/${id.slice(4, 6)}/${id}/source.md`);
      return { id, ...(page && { page: link(page) }) };
    });
    let html = inline(render(e.text, "log/", paths).html);
    // un id raw cité dans le texte devient un lien vers sa page Source
    for (const s of sources) if (s.page) html = html.replaceAll(`<code>${s.id}</code>`, `<a href="${rel("log/", route(`wiki/${s.page.id}.md`))}"><code>${s.id}</code></a>`);
    const pages = (e.pages ?? []).filter((p) => byPath.has(p)).map((p) => link(byPath.get(p)!));
    return {
      at: e.at, kind: e.kind, html, pages,
      sources: sources.filter((s) => !e.text.includes(`\`${s.id}\``)), // un id déjà nommé dans le texte n'est pas répété sous l'entrée
      // tout ce que l'entrée affiche, replié comme la recherche (sans accents, minuscules) : le navigateur n'a qu'à replier la requête
      search: fold([e.kind, plain(html), ...pages.map((p) => p.title), ...sources.map((s) => `${s.id} ${s.page?.title ?? ""}`)].join(" ")),
    };
  });
}

/**
 * Liens orientés du graphe. `directed` : « source\tcible » (source = page qui contient le lien). Une paire réciproque
 * (a → b et b → a) donne un seul lien `mutual: true`, orienté du plus petit id vers le plus grand (ordre stable).
 */
export function graphLinks(directed: Set<string>): GraphData["links"] {
  const out: GraphData["links"] = [];
  for (const e of [...directed].sort()) {
    const [source, target] = e.split("\t");
    if (!directed.has(`${target}\t${source}`)) out.push({ source, target });
    else if (source < target) out.push({ source, target, mutual: true });
  }
  return out;
}

export async function buildSiteData(root: string) {
  const docs = (await readDocs(root, "wiki")).filter(isWiki).sort((a, b) => a.path.localeCompare(b.path));
  const paths = new Set<string>(docs.map((d) => d.path));
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const link = (d: Doc): Link => ({ id: id(d.path), title: String(d.fm.title ?? id(d.path)), type: String(d.fm.type ?? "") });

  // arêtes orientées : liens Markdown entre pages wiki existantes (source = page qui contient le lien, cible = page citée)
  const directed = new Set<string>(), back = new Map<string, Doc[]>();
  for (const d of docs) for (const t of wikiLinks(d)) {
    if (t === d.path || !paths.has(t)) continue;
    directed.add(`${id(d.path)}\t${id(t)}`);
    back.set(t, [...(back.get(t) ?? []), d]);
  }
  const edges = graphLinks(directed);
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
        ...(s.resource && rawPartial(root, String(s.resource)) && { partial: true }),
      };
    });
    const g = Date.parse(iso(fm.generated?.at) ?? ""), v = Date.parse(iso(fm.verified?.at) ?? "");
    // source partielle : extraction `partial:` d'une source raw citée (page Source seulement : un concept qui cite une source
    // partielle n'est pas lui-même partiel), ou encart d'avertissement de contenu partiel dans le corps
    const partial = (fm.type === "Source" && (fm.sources ?? []).some((s: any) => s.resource && rawPartial(root, String(s.resource)))) || r.warnings.some(isPartialWarning);
    return {
      id: id(d.path), type: String(fm.type ?? ""), title: String(fm.title ?? id(d.path)),
      description: String(fm.description ?? ""), tags: (fm.tags ?? []).map(String),
      status: String(fm.status ?? "draft"), verified: stamp(fm.verified), generated: stamp(fm.generated),
      stale_after: iso(fm.stale_after), needsReview: !!fm.verified && g > v, partial,
      html: r.html, md: pageMarkdown(root, d.path), sources, notes: r.notes, toc: r.toc,
      backlinks: (back.get(d.path) ?? []).map(link).sort(byTitle),
      related: related(docs, d.path).slice(0, 8).map((x) => ({ ...link(byPath.get(x.path)!), reasons: x.reasons.map((r) => r.replace(/ : \/raw\/.*$/, "")) })),
    };
  });

  pages.sort(byTitle); // titre en collation française (les ids de chaque collection suivent), et non le chemin

  const tagMap = new Map<string, string[]>();
  for (const p of pages) for (const t of p.tags) tagMap.set(t, [...(tagMap.get(t) ?? []), p.id]);
  const tags = [...tagMap].map(([tag, ids]) => ({ tag, slug: slugify(tag), ids })).sort((a, b) => b.ids.length - a.ids.length || collator.compare(a.tag, b.tag));

  const degree = new Map<string, number>();
  for (const e of edges) for (const n of [e.source, e.target]) degree.set(n, (degree.get(n) ?? 0) + 1);
  const graph: GraphData = {
    nodes: pages.map((p) => ({ id: p.id, title: p.title, description: p.description, type: p.type, tags: p.tags, degree: degree.get(p.id) ?? 0 })),
    links: edges,
  };

  const data: SiteData = { pages, tags, log: renderLog(root, paths, byPath, resourcePage, link) };
  return { data, graph, search: buildSearch(pages) };
}

/** Index de recherche précalculé : index inversé sur le contenu complet (mot replié → pages) + vocabulaire d'autocomplétion. */
function buildSearch(pages: PageData[]): SearchIndex {
  const docs = pages.map((p) => ({ id: p.id, title: p.title, description: p.description, type: p.type, tags: p.tags, status: p.status, verified: !!p.verified, needsReview: p.needsReview, partial: p.partial, text: plain(p.html.replace(/<p class="(?:note-perso|callout-warning)-titre">[^<]*<\/p>/g, "")) }));
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

/**
 * Empreinte du frontend : sources du site (src/), configuration Vite, manifestes et verrou des dépendances. C'est
 * l'empreinte des entrées du build et non des fichiers qu'il produit : la version est incrustée dans le bundle client
 * (`$app/env`), donc le nom haché des ressources de Vite en dépend (empreinte circulaire). Toute modification du CSS, d'un
 * composant ou d'une dépendance change les ressources produites, et cette empreinte avec elles.
 */
export function frontendFingerprint(siteDir = SITE_DIR): string {
  const files = (readdirSync(join(siteDir, "src"), { recursive: true }) as string[]).map((f) => join("src", f))
    .concat("vite.config.ts", "package.json", "svelte.config.js", join("..", "package.json"), join("..", "bun.lock"))
    .filter((f) => existsSync(join(siteDir, f)) && statSync(join(siteDir, f)).isFile()).sort();
  const h = new Bun.CryptoHasher("sha256");
  for (const f of files) h.update(`${f}\0`).update(readFileSync(join(siteDir, f))).update("\0");
  return h.digest("hex");
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
  // version = empreinte des données ET du frontend : même wiki et même code, même site ; l'un ou l'autre change, le cache change
  Object.assign(process.env, { BRAIN_SITE_DATA: dataDir, BRAIN_SITE_OUT: resolve(out), BRAIN_SITE_VERSION: sha256(parts.join("") + frontendFingerprint()).slice(0, 12) });
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
