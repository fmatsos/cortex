import { existsSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { add } from "./add";
import { fromResource, toResource } from "./doc";
import { openWiki } from "./context";
import { related, type Related } from "./lib";
import { lint } from "./lint";
import { KINDS, lastDays, readLog, type LogEntry } from "./log";
import { search } from "./search";
import type { RelatedReason } from "../site/src/lib/types";
import { mcpInstructions } from "./prompts";
import { loadConfig } from "./config";

export { related };

/** A structured related reason as the external agent reads it: the French text the CLI used to emit as data. */
export const reasonText = (r: RelatedReason): string =>
  r.kind === "out" ? "lien sortant" : r.kind === "in" ? "lien entrant" : r.kind === "source" ? `source partagée : ${r.value}` : `tag partagé : ${r.value}`;

/** What the MCP `related` tool returns: the first `limit` related pages, root-relative paths as resources, reasons in French. */
export const relatedForAgent = (hits: Related[], limit = 10) =>
  hits.slice(0, limit).map((r) => ({ ...r, path: toResource(r.path), reasons: r.reasons.map(reasonText) }));

/** Content of a .md under wiki/ or raw/; refuses any path that leaves it once resolved (.., symbolic links). */
export async function getFile(root: string, path: string): Promise<string> {
  const file = join(root, fromResource(path));
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`Fichier introuvable : ${path}`);
  const real = realpathSync(file);
  const inside = ["wiki", "raw"].some((d) => existsSync(join(root, d)) && real.startsWith(realpathSync(join(root, d)) + sep));
  if (!inside || !real.endsWith(".md")) throw new Error(`Chemin refusé : ${path} (attendu : un .md sous wiki/ ou raw/)`);
  return Bun.file(real).text();
}

/** Entries of the last `days` days of the journal (wiki/log.jsonl), most recent first, filtered by `kind`. */
export function lastLog(root: string, days: number, kind?: string): LogEntry[] {
  return lastDays(readLog(root).entries, days, kind);
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 1));
/** An error becomes an `isError` tool result the agent can read, not a protocol break. */
const safe = <A>(fn: (a: A) => Promise<ReturnType<typeof text>>) => async (a: A) => {
  try { return await fn(a); }
  catch (e) { return { ...text(`Erreur : ${(e as Error).message}`), isError: true }; }
};

export function buildServer(root: string, language?: string): McpServer {
  const s = new McpServer({ name: "cortex", version: "0.1.0" }, {
    instructions: mcpInstructions(language),
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
      hits: hits.map((h) => ({ path: toResource(h.path), title: h.title, area: h.area, snippet: h.snippet })),
      ...(gap && { hint: "Trouvé seulement dans raw/ : un trou à compiler (cortex compile)." }),
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
  }, safe(async ({ path, limit }) => json(relatedForAgent(related(await openWiki(root).pages(), path), limit))));

  s.registerTool("lint", {
    description: "Contrôles mécaniques du wiki : erreurs et avertissements (liens cassés, orphelins, sources en attente, pages à relire…). Les contradictions entre pages restent à ta charge.",
    inputSchema: z.object({}),
    annotations: readOnly,
  }, safe(async () => {
    const issues = await lint(root);
    return json({ issues: issues.filter((i) => i.level !== "info"), pagesJamaisRelues: issues.filter((i) => i.level === "info").length });
  }));

  s.registerTool("add", {
    description: "Ajoute une source à raw/ (statut pending ; ne touche jamais au wiki) : une URL http(s) ou un texte. Pas de fichier local : un client MCP ne doit pas pouvoir copier un fichier du poste dans le dépôt.",
    inputSchema: z.object({
      input: z.string().optional().describe("URL http(s)"),
      text: z.string().optional().describe("texte à ajouter, à la place de input"),
      note: z.string().describe("pourquoi l'utilisateur garde cette source"),
    }),
  }, safe(async ({ input, text: txt, note }) => {
    if (!note.trim()) throw new Error("note obligatoire : dis pourquoi cette source est gardée.");
    if ((input === undefined) === (txt === undefined) || input === "-") throw new Error("Donne soit input (URL ou chemin), soit text.");
    // no local path: an MCP client would copy any file of the machine (key, secret) into raw/, then into git
    if (input !== undefined && !/^https?:\/\//.test(input)) throw new Error("input doit être une URL http(s) ; pour un fichier local, utilise cortex add ou cortex inbox.");
    const r = await add(root, input ?? "-", { note, text: txt, publicOnly: true });
    return json({ id: r.id, duplicate: r.duplicate, ...(r.ex && { title: r.ex.title, partial: r.ex.partial }) });
  }));

  s.registerTool("log", {
    description: "Lecture seule : les entrées structurées du journal (wiki/log.jsonl : at, kind, text, sources, pages) des derniers jours, plus récentes d'abord. Le journal ne s'écrit pas par MCP.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(30).optional().describe("nombre de jours (défaut 1)"),
      kind: z.enum(KINDS).optional().describe("ne garder que ce type d'entrée"),
    }),
    annotations: readOnly,
  }, safe(async ({ limit, kind }) => json(lastLog(root, limit ?? 1, kind))));

  return s;
}

/**
 * MCP stdio server. Stdout is reserved for the protocol. Domain code no longer prints (PRA-03), but the redirection stays
 * as a safety net for third-party code reachable from the tools (PDF/HTML extraction libraries may log warnings).
 */
export async function serveMcp(root: string) {
  console.log = console.error;
  const { language } = await loadConfig(root);
  serveStdio(() => buildServer(root, language));
}
