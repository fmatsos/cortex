import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fold } from "../site/src/lib/fold";
import { buildTerms } from "../site/src/lib/search-engine";
import type { GraphData, Link, LogEntryData, Note, PageData, SearchIndex, SiteData, SourceRef } from "../site/src/lib/types";
import { newestFirst, readLog } from "./log";
import { type Doc, isReservedPage, parseDoc, rawPath, readDocs, related, sha256, slugify, wikiLinks } from "./lib";
import { sanitizeHtml } from "./sanitize";
import { paint, warn } from "./style";

export const SITE_DIR = join(import.meta.dir, "../site");

const iso = (x: unknown) => (x == null ? undefined : x instanceof Date ? x.toISOString() : String(x));
const stamp = (x: any) => (x?.at ? { by: String(x.by ?? ""), at: iso(x.at)! } : undefined);
const route = (path: string) => `${path.replace(/\.md$/, "")}/`; // wiki/concepts/x.md → wiki/concepts/x/
const id = (path: string) => path.replace(/^wiki\//, "").replace(/\.md$/, "");

/** Relative link from one route to another (both « a/b/ »): the site works under any prefix. */
function rel(from: string, to: string): string {
  const a = from.split("/").filter(Boolean), b = to.split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const up = "../".repeat(a.length - i);
  return (up + b.slice(i).map((s) => `${s}/`).join("")) || "./";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
/** Markdown → sanitized HTML (whitelist, see sanitize.ts): the site injects it with `{@html}`, so nothing else comes out. */
export const md = (s: string) => sanitizeHtml(Bun.markdown.html(s, { tagFilter: true, headings: { ids: true }, autolinks: true }));
/** List sort: French alphabetical order of the visible titles, not path order. */
const collator = new Intl.Collator("fr");
export const byTitle = (a: { title: string; id?: string }, b: { title: string; id?: string }) => collator.compare(a.title, b.title) || collator.compare(a.id ?? "", b.id ?? "");
const inline = (s: string) => md(s).trim().replace(/^<p>([\s\S]*)<\/p>$/, "$1");
export const plain = (html: string) => unesc(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/**
 * Markdown body → HTML. `/wiki/x.md` links rewritten as relative links (a link to a missing page becomes a
 * `<span class="lien-manquant">`, never a 404; a link to `raw/` is not published); `[^id]` footnotes numbered.
 */
/**
 * A partial-content warning (paywall, preview) is written in the note callout, on a `⚠️ …` line.
 * Recognized here for the `partial` metadata; other warnings do not count.
 */
export const isPartialWarning = (text: string) => /\b(?:partiel(?:le)?s?|paywall|aper[cç]u public|tronqu[eé]e?s?)\b/i.test(text);

/** In a callout body: the line starting with ⚠️ (and those following it in the paragraph) comes out. */
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
 * Callouts: the Obsidian callout syntax `> [!note] Title` (optional title), rendered by Bun as a plain
 * quote, becomes an `<aside class="note-perso">`; `> [!warning] Title` (or caution, attention) an
 * `<aside class="callout-warning">`. In a note, a `⚠️ …` line leaves the callout to form, right after it, a separate
 * warning callout. Titles are in a `<p …-titre>`, outside the indexed text.
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
 * Stable heading anchors: the heading text without accents (Bun's slug strips them: « Détail » → « dtail »),
 * suffixed -1, -2… on duplicates. A slug that would look like a UI id (`fn-`, `fnref-`, `src-`, `h-`,
 * `contenu-principal`) is prefixed with `t-`.
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
 * Tables: each is wrapped in a `.table-wrap` container, the scrolling region (horizontally, and vertically
 * for a tall table). `tabindex="0"` makes it reachable and scrollable by keyboard, `role="region"` and `aria-label` name it
 * by the preceding heading. Added after sanitizing: author content can write neither these attributes nor this class.
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
    if (page === "wiki/index.md" || page === "wiki/log.md") return `<a href="${rel(from, page === "wiki/log.md" ? "log/" : "")}${frag && `#${frag}`}">${label}</a>`; // navigation pages of the site
    if (!pages.has(page)) return `<span class="lien-manquant" title="${page.startsWith("raw/") ? "source brute, non publiée" : "page à écrire"}">${label}</span>`;
    return `<a href="${rel(from, route(page))}${frag && `#${frag}`}">${label}</a>`;
  }));
  const notes: Note[] = order.map((k, i) => ({
    n: i + 1, id: k, refs: seen.get(k) ?? 1, // refs: number of occurrences in the text (one ↩ back-link per occurrence)
    html: defs.has(k) ? inline(defs.get(k)!) : "",
  }));
  const toc = [...html.matchAll(/<h([23]) id="([^"]+)">([\s\S]*?)<\/h\1>/g)].map((m) => ({ level: +m[1] as 2 | 3, id: m[2], text: plain(m[3]) }));
  const warnings = [...html.matchAll(/<aside class="callout-warning"[^>]*>([\s\S]*?)<\/aside>/g)].map((m) => plain(m[1].replace(/<p class="callout-warning-titre">[^<]*<\/p>/, "")));
  return { html, notes, toc, warnings };
}

/**
 * Page Markdown as it is in the wiki (frontmatter included), for the « Copier le Markdown » button.
 * raw/ is not published: each `/raw/…` path becomes the source's original URL, or disappears if it has none.
 */
function pageMarkdown(root: string, path: string): string {
  return readFileSync(join(root, path), "utf8")
    .replace(/\[([^\]]*)\]\((\/raw\/[^)\s]+)\)/g, (_, label: string, p: string) => { const u = originUrl(root, p); return u ? `[${label}](${u})` : label; })
    .replace(/\/raw\/[^\s)"'\]]+/g, (p) => originUrl(root, p) ?? "(source brute non publiée)");
}

/** Frontmatter of a raw source (read-only, confined to raw/). Only `url` and `partial` come out, never the body. */
function rawFm(root: string, resource: string): Record<string, any> | undefined {
  const f = join(root, resource);
  if (!existsSync(f) || !realpathSync(f).startsWith(realpathSync(join(root, "raw")) + sep)) return;
  return parseDoc(f, readFileSync(f, "utf8")).fm;
}

/** Original URL of a source: read from the raw frontmatter. Nothing else from raw/ is read or published. */
function originUrl(root: string, resource: string): string | undefined {
  const u = rawFm(root, resource)?.url;
  return /^https?:\/\//.test(String(u)) ? String(u) : undefined;
}

/** Partial extraction (`partial:` in the raw frontmatter, written by `cortex add` on a paywall). */
const rawPartial = (root: string, resource: string) => {
  const p = rawFm(root, resource)?.partial;
  return p != null && p !== false && String(p).trim() !== "" && !/^(false|no|non|0)$/i.test(String(p).trim());
};

/**
 * Journal: wiki/log.jsonl as structured entries (most recent first). The text is rendered as inline HTML; the cited
 * pages become links (missing page: ignored), the sources the wiki Source page that cites them (raw/ is not published).
 */
function renderLog(root: string, paths: Set<string>, byPath: Map<string, Doc>, sourcePage: Map<string, Doc>, link: (d: Doc) => Link): LogEntryData[] {
  return newestFirst(readLog(root).entries).map((e) => {
    const sources = (e.sources ?? []).map((id) => {
      const raw = rawPath(root, id), page = raw && sourcePage.get(`/${raw}`);
      return { id, ...(page && { page: link(page) }) };
    });
    let html = inline(render(e.text, "log/", paths).html);
    // a raw id cited in the text becomes a link to its Source page
    for (const s of sources) if (s.page) html = html.replaceAll(`<code>${s.id}</code>`, `<a href="${rel("log/", route(`wiki/${s.page.id}.md`))}"><code>${s.id}</code></a>`);
    const pages = (e.pages ?? []).filter((p) => byPath.has(p)).map((p) => link(byPath.get(p)!));
    return {
      at: e.at, kind: e.kind, html, pages,
      sources: sources.filter((s) => !e.text.includes(`\`${s.id}\``)), // an id already named in the text is not repeated under the entry
      // everything the entry displays, folded like the search (no accents, lowercase): the browser only has to fold the query
      search: fold([e.kind, plain(html), ...pages.map((p) => p.title), ...sources.map((s) => `${s.id} ${s.page?.title ?? ""}`)].join(" ")),
    };
  });
}

/**
 * Directed graph links. `directed`: « source\ttarget » (source = page containing the link). A reciprocal pair
 * (a → b and b → a) gives a single `mutual: true` link, oriented from the smaller id to the larger (stable order).
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

export async function buildSiteData(root: string, say: (m: string) => void = warn) {
  const read = await readDocs(root, "wiki");
  for (const e of read.errors) say(`page ignorée, frontmatter invalide : ${e.path} (${e.msg})`);
  const docs = read.docs.filter((d) => !isReservedPage(d.path)).sort((a, b) => a.path.localeCompare(b.path));
  const paths = new Set<string>(docs.map((d) => d.path));
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const link = (d: Doc): Link => ({ id: id(d.path), title: String(d.fm.title ?? id(d.path)), type: String(d.fm.type ?? "") });

  // directed edges: Markdown links between existing wiki pages (source = page containing the link, target = cited page)
  const directed = new Set<string>(), back = new Map<string, Doc[]>();
  for (const d of docs) for (const t of wikiLinks(d)) {
    if (t === d.path || !paths.has(t)) continue;
    directed.add(`${id(d.path)}\t${id(t)}`);
    back.set(t, [...(back.get(t) ?? []), d]);
  }
  const edges = graphLinks(directed);
  const resourcePage = new Map<string, Doc>(); // raw resource → wiki Source page that cites it
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
    // partial source: `partial:` extraction of a cited raw source (Source page only: a concept citing a
    // partial source is not itself partial), or partial-content warning callout in the body
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

  pages.sort(byTitle); // title in French collation (each collection's ids follow), not the path

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

/** Precomputed search index: inverted index over the full content (folded word → pages) + autocomplete vocabulary. */
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
 * Refuses an output folder that the build would wrongly empty: the root, the wiki, raw/, the CLI, HOME,
 * their parents, and any non-empty folder that does not look like a previous export (no `_app/`).
 */
export function checkOut(root: string, out: string) {
  const o = resolve(out), keep = [root, join(root, "wiki"), join(root, "raw"), dirname(SITE_DIR), homedir(), "/"].map((p) => resolve(p));
  if (keep.some((p) => p === o || p.startsWith(o + sep))) throw new Error(`--out ${o} : refusé, ce dossier est vidé à chaque export et contient (ou est) un dossier à garder.`);
  // Children of these folders are refused too: the build would write into them (raw/ is immutable, wiki/ is the agent's space).
  const inside = ["raw", "wiki", "inbox", ".git"].map((d) => resolve(root, d));
  if (inside.some((p) => p === o || o.startsWith(p + sep))) throw new Error(`--out ${o} : refusé, ce dossier est dans raw/, wiki/, inbox/ ou .git/, que l'export ne doit pas toucher.`);
  if (existsSync(o) && readdirSync(o).length && !existsSync(join(o, "_app"))) throw new Error(`--out ${o} : refusé, ce dossier n'est pas vide et ne ressemble pas à un export précédent (pas de _app/).`);
}

/**
 * Frontend fingerprint: site sources (src/), Vite config, manifests and dependency lockfile. It is
 * the fingerprint of the build inputs, not of the files it produces: the version is embedded in the client bundle
 * (`$app/env`), so the hashed name of Vite's assets depends on it (circular fingerprint). Any change to the CSS, a
 * component or a dependency changes the produced assets, and this fingerprint with them.
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
  const dataDir = join(root, ".cortex/site-data");
  const { data, graph, search } = await buildSiteData(root, say);
  mkdirSync(dataDir, { recursive: true });
  const parts: string[] = [];
  const size = async (name: string, v: unknown) => { const s = JSON.stringify(v); parts.push(s); await Bun.write(join(dataDir, name), s); return s.length; };
  await size("data.json", data);
  await size("graph.json", graph);
  const idxBytes = await size("search-index.json", search);
  // export date and time (SOURCE_DATE_EPOCH if provided, for a reproducible export): outside the cache version
  const at = process.env.SOURCE_DATE_EPOCH ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000) : new Date();
  await Bun.write(join(dataDir, "build.json"), JSON.stringify({ generatedAt: at.toISOString(), links: graph.links.length }));
  say(`${data.pages.length} pages, ${graph.links.length} liens, index de recherche ${(idxBytes / 1024).toFixed(0)} Ko`);

  // Vite and SvelteKit are only loaded here: the other commands stay as fast
  // version = fingerprint of the data AND the frontend: same wiki and same code, same site; either changes, the cache changes
  const vars = { CORTEX_SITE_DATA: dataDir, CORTEX_SITE_OUT: resolve(out), CORTEX_SITE_VERSION: sha256(parts.join("") + frontendFingerprint()).slice(0, 12) };
  // The build is process-global (env, cwd, console) and shares site/.svelte-kit: one at a time per machine.
  const unlock = lockBuild();
  // The build reads these from the environment (SvelteKit's forked workers reload vite.config.ts): set for the build only, then restored.
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const cwd = process.cwd(), log = console.log;
  Object.assign(process.env, vars);
  console.log = () => {}; // SvelteKit and the adapter are chatty (« npm run preview »…); errors go through console.error
  try {
    const { createBuilder } = await import("vite");
    rmSync(join(SITE_DIR, ".svelte-kit"), { recursive: true, force: true }); // no stale pieces from a previous export
    process.chdir(SITE_DIR); // SvelteKit resolves src/ and .svelte-kit from the current folder
    // build() only builds one environment: SvelteKit orchestrates client, server, prerender and adapter via buildApp
    await (await createBuilder({ root: SITE_DIR, logLevel: "warn" })).buildApp();
  } catch (e) {
    const m = (e as Error).message;
    if (/native binding/i.test(m)) throw new Error(`binding natif de Vite introuvable pour ${process.platform}-${process.arch} : réinstalle avec « bun install --omit optional » dans le dossier de Cortex (voir DESIGN §9).`);
    throw e;
  } finally {
    process.chdir(cwd); console.log = log;
    for (const [k, v] of Object.entries(prev)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    unlock();
  }
  say(`${paint.ok("✓")} Site écrit dans ${resolve(out)} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
}

/**
 * Lock file next to the build folder (`flag: "wx"`, holds the pid). The server bundle imports `@sveltejs/kit`, so
 * SvelteKit's output cannot leave the install tree (kit.outDir elsewhere fails to resolve it): the lock serializes
 * exports instead. A lock left by a dead process is taken over.
 */
function lockBuild(): () => void {
  const file = join(SITE_DIR, ".export.lock");
  for (let attempt = 0; ; attempt++) {
    try { writeFileSync(file, String(process.pid), { flag: "wx" }); break; } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const pid = Number(readFileSync(file, "utf8"));
      const alive = !(pid > 0) || (() => { try { return process.kill(pid, 0), true; } catch (err) { return (err as NodeJS.ErrnoException).code === "EPERM"; } })();
      if (alive || attempt) throw new Error("un export est déjà en cours (verrou : site/.export.lock).");
      rmSync(file, { force: true });
    }
  }
  return () => rmSync(file, { force: true });
}
