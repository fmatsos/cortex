import { existsSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { add } from "./add";
import { type Doc, readDocs } from "./lib";
import { lint } from "./lint";
import { search } from "./search";

export type Related = { path: string; title: string; score: number; reasons: string[] };

const norm = (p: string) => p.trim().replace(/^\/+/, "");
const wikiLinks = (d: Doc) => new Set([...d.body.matchAll(/\]\((\/wiki\/[^)#\s]+)/g)].map((m) => norm(m[1])));
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

/** Contenu d'un .md sous wiki/ ou raw/ ; refuse tout chemin qui en sort une fois résolu (.., liens symboliques). */
export async function getFile(root: string, path: string): Promise<string> {
  const file = join(root, norm(path));
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`Fichier introuvable : ${path}`);
  const real = realpathSync(file);
  const inside = ["wiki", "raw"].some((d) => existsSync(join(root, d)) && real.startsWith(realpathSync(join(root, d)) + sep));
  if (!inside || !real.endsWith(".md")) throw new Error(`Chemin refusé : ${path} (attendu : un .md sous wiki/ ou raw/)`);
  return Bun.file(real).text();
}

/** Les `limit` dernières sections datées (## AAAA-MM-JJ) de wiki/log.md. */
export async function lastLog(root: string, limit: number): Promise<string> {
  const f = Bun.file(join(root, "wiki/log.md"));
  if (!(await f.exists())) return "";
  return (await f.text()).split(/^(?=## )/m).filter((s) => s.startsWith("## ")).slice(0, limit).join("").trim();
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 1));
/** Une erreur devient un résultat d'outil `isError` que l'agent peut lire, pas une rupture du protocole. */
const safe = <A>(fn: (a: A) => Promise<ReturnType<typeof text>>) => async (a: A) => {
  try { return await fn(a); }
  catch (e) { return { ...text(`Erreur : ${(e as Error).message}`), isError: true }; }
};

export function buildServer(root: string): McpServer {
  const s = new McpServer({ name: "brain", version: "0.1.0" }, {
    instructions: "Second cerveau : wiki en français sous wiki/, sources brutes sous raw/. Cherche dans le wiki d'abord ; une réponse trouvée seulement dans raw/ est un trou à compiler.",
  });
  const readOnly = { readOnlyHint: true };

  s.registerTool("search", {
    description: "Recherche plein texte (BM25) dans le wiki, puis dans raw/. À utiliser en premier pour toute question sur les connaissances de l'utilisateur. Un résultat seulement dans raw/ signale un trou à compiler.",
    inputSchema: z.object({
      q: z.string().describe("termes de recherche"),
      in: z.enum(["wiki", "raw"]).optional().describe("limiter à wiki ou raw (défaut : les deux, wiki d'abord)"),
      limit: z.number().int().min(1).max(50).optional().describe("nombre maximal de résultats (défaut 10)"),
    }),
    annotations: readOnly,
  }, safe(async ({ q, in: area, limit }) => {
    const hits = await search(root, q, { in: area, limit: limit ?? 10 });
    const gap = area !== "raw" && hits.length > 0 && hits.every((h) => h.area === "raw");
    return json({
      hits: hits.map((h) => ({ path: `/${h.path}`, title: h.title, area: h.area, snippet: h.snippet })),
      ...(gap && { hint: "Trouvé seulement dans raw/ : un trou à compiler (brain compile)." }),
    });
  }));

  s.registerTool("get", {
    description: "Lit le contenu brut d'une page .md sous wiki/ ou raw/, par exemple /wiki/concepts/x.md. À utiliser pour lire une page entière après un search ou un related.",
    inputSchema: z.object({ path: z.string().describe("chemin relatif à la racine du dépôt, avec ou sans « / » initial") }),
    annotations: readOnly,
  }, safe(async ({ path }) => text(await getFile(root, path))));

  s.registerTool("related", {
    description: "Pages wiki liées à une page : liens sortants, rétroliens, sources raw et tags partagés, classées par force avec la raison. À utiliser pour explorer le voisinage d'une page avant de répondre ou de proposer une mise à jour.",
    inputSchema: z.object({
      path: z.string().describe("page wiki, par exemple /wiki/concepts/x.md"),
      limit: z.number().int().min(1).max(50).optional().describe("nombre maximal de pages (défaut 10)"),
    }),
    annotations: readOnly,
  }, safe(async ({ path, limit }) => json(related(await readDocs(root, "wiki"), path).slice(0, limit ?? 10).map((r) => ({ ...r, path: `/${r.path}` })))));

  s.registerTool("lint", {
    description: "Contrôles mécaniques du wiki : erreurs et avertissements (liens cassés, orphelins, sources en attente, pages à relire…). Les contradictions entre pages restent à ta charge.",
    inputSchema: z.object({}),
    annotations: readOnly,
  }, safe(async () => {
    const issues = await lint(root);
    return json({ issues: issues.filter((i) => i.level !== "info"), pagesJamaisRelues: issues.filter((i) => i.level === "info").length });
  }));

  s.registerTool("add", {
    description: "Ajoute une source à raw/ (statut pending ; ne touche jamais au wiki) : une URL, un chemin local (.md, .txt, .pdf) ou un texte. Idempotent : une source déjà présente renvoie son id. La note, qui dit pourquoi l'utilisateur garde la source, est obligatoire. Ne compile pas : l'ingest reste à faire.",
    inputSchema: z.object({
      input: z.string().optional().describe("URL ou chemin de fichier local"),
      text: z.string().optional().describe("texte à ajouter, à la place de input"),
      note: z.string().describe("pourquoi l'utilisateur garde cette source"),
    }),
  }, safe(async ({ input, text: txt, note }) => {
    if (!note.trim()) throw new Error("note obligatoire : dis pourquoi cette source est gardée.");
    if ((input === undefined) === (txt === undefined) || input === "-") throw new Error("Donne soit input (URL ou chemin), soit text.");
    const r = await add(root, input ?? "-", { note, text: txt });
    return json({ id: r.id, duplicate: r.duplicate, ...(r.ex && { title: r.ex.title, partial: r.ex.partial }) });
  }));

  s.registerTool("log", {
    description: "Lecture seule : les dernières sections datées de wiki/log.md (ingests, ajouts, lint récents). Le journal ne s'écrit pas par MCP.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(30).optional().describe("nombre de jours (défaut 1)") }),
    annotations: readOnly,
  }, safe(async ({ limit }) => text(await lastLog(root, limit ?? 1))));

  return s;
}

/** Serveur MCP stdio. Stdout est réservé au protocole : tout console.log perdu part sur stderr. */
export function serveMcp(root: string) {
  console.log = console.error;
  serveStdio(() => buildServer(root));
}
