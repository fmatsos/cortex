import { existsSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { isUnder } from "./paths";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { add } from "./add";
import { fromResource, toResource } from "./doc";
import { openWiki } from "./context";
import { related, type Related } from "./lib";
import { lint } from "./lint";
import { KINDS, lastDays, readLog, type LogEntry } from "./log";
import { openItems, QUEUE_KINDS, queueItems, readQueue } from "./queue";
import { search } from "./search";
import type { RelatedReason } from "../site/src/lib/types";
import { mcpInstructions } from "./prompts";
import { loadConfig } from "./config";
import pkg from "../package.json";

/** A structured related reason as the external agent reads it: the French text the CLI used to emit as data. */
export const reasonText = (r: RelatedReason): string =>
  r.kind === "out" ? "outgoing link" : r.kind === "in" ? "incoming link" : r.kind === "source" ? `shared source: ${r.value}` : r.kind === "semantic" ? "close in meaning" : `shared tag: ${r.value}`;

/** What the MCP `related` tool returns: the first `limit` related pages, root-relative paths as resources, reasons in French. */
export const relatedForAgent = (hits: Related[], limit = 10) =>
  hits.slice(0, limit).map((r) => ({ ...r, path: toResource(r.path), reasons: r.reasons.map(reasonText) }));

/** Content of a .md under wiki/ or raw/; refuses any path that leaves it once resolved (.., symbolic links). */
export async function getFile(root: string, path: string): Promise<string> {
  const file = join(root, fromResource(path));
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`File not found: ${path}`);
  const real = realpathSync(file);
  const inside = ["wiki", "raw"].some((d) => isUnder(root, d, file));
  if (!inside || !real.endsWith(".md")) throw new Error(`Path refused: ${path} (expected: a .md under wiki/ or raw/)`);
  return Bun.file(real).text();
}

/** Entries of the last `days` days of the journal (wiki/log.jsonl), most recent first, filtered by `kind`. */
export function lastLog(root: string, days: number, kind?: string): LogEntry[] {
  return lastDays(readLog(root).entries, days, kind);
}

/** Open entries of the queue (wiki/queue.jsonl), by kind then oldest first; `all` adds the closed ones. Pages as resources. */
export function queueForAgent(root: string, kind?: string, all = false) {
  const items = queueItems(readQueue(root).entries);
  return (all ? items.filter((i) => !kind || i.kind === kind) : openItems(items, kind)).map((i) => ({ ...i, pages: i.pages.map(toResource) }));
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 1));
/** An error becomes an `isError` tool result the agent can read, not a protocol break. */
const toolResult = <A>(fn: (a: A) => Promise<ReturnType<typeof text>>) => async (a: A) => {
  try { return await fn(a); }
  catch (e) { return { ...text(`Error: ${(e as Error).message}`), isError: true }; }
};

export function buildServer(root: string, language?: string): McpServer {
  const s = new McpServer({ name: "cortex", version: pkg.version }, {
    instructions: mcpInstructions(language),
  });
  const readOnly = { readOnlyHint: true };

  s.registerTool("search", {
    description: "Full-text search (BM25) in the wiki, then in raw/. Use it first for any question about the user's knowledge. A result found only in raw/ flags a gap to compile.",
    inputSchema: z.object({
      q: z.string().describe("search terms"),
      in: z.enum(["wiki", "raw"]).optional().describe("restrict to wiki or raw (default: both, wiki first)"),
      limit: z.number().int().min(1).max(50).optional().describe("maximum number of results (default 10)"),
    }),
    annotations: readOnly,
  }, toolResult(async ({ q, in: area, limit }) => {
    const hits = await search(root, q, { in: area, limit: limit ?? 10 });
    const gap = area !== "raw" && hits.length > 0 && hits.every((h) => h.area === "raw");
    return json({
      hits: hits.map((h) => ({ path: toResource(h.path), title: h.title, area: h.area, snippet: h.snippet })),
      ...(gap && { hint: "Found only in raw/: a gap to compile (cortex compile)." }),
    });
  }));

  s.registerTool("get", {
    description: "Reads the raw content of a .md page under wiki/ or raw/, for example /wiki/concepts/x.md. Use it to read a whole page after a search or a related.",
    inputSchema: z.object({ path: z.string().describe("path relative to the repository root, with or without a leading \"/\"") }),
    annotations: readOnly,
  }, toolResult(async ({ path }) => text(await getFile(root, path))));

  s.registerTool("related", {
    description: "Wiki pages related to a page: outgoing links, backlinks, shared raw sources and tags, ranked by strength with the reason. Use it to explore a page's neighborhood before answering or proposing an update.",
    inputSchema: z.object({
      path: z.string().describe("wiki page, for example /wiki/concepts/x.md"),
      limit: z.number().int().min(1).max(50).optional().describe("maximum number of pages (default 10)"),
    }),
    annotations: readOnly,
  }, toolResult(async ({ path, limit }) => json(relatedForAgent(related(await openWiki(root).pages(), path), limit))));

  s.registerTool("lint", {
    description: "Mechanical checks of the wiki: errors and warnings (broken links, orphans, pending sources, pages to review…). Contradictions between pages remain yours to find.",
    inputSchema: z.object({}),
    annotations: readOnly,
  }, toolResult(async () => {
    const issues = await lint(root);
    return json({ issues: issues.filter((i) => i.level !== "info"), neverReviewed: issues.filter((i) => i.level === "info").length });
  }));

  s.registerTool("add", {
    description: "Adds a source to raw/ (status pending; never touches the wiki): an http(s) URL or a text. No local file: an MCP client must not be able to copy a file of the machine into the repository.",
    inputSchema: z.object({
      input: z.string().optional().describe("http(s) URL"),
      text: z.string().optional().describe("text to add, instead of input"),
      note: z.string().optional().describe("why the user keeps this source (optional)"),
    }),
  }, toolResult(async ({ input, text: txt, note }) => {
    if ((input === undefined) === (txt === undefined) || input === "-") throw new Error("Give either input (URL or path) or text.");
    // no local path: an MCP client would copy any file of the machine (key, secret) into raw/, then into git
    if (input !== undefined && !/^https?:\/\//.test(input)) throw new Error("input must be an http(s) URL; for a local file, use cortex add or cortex inbox.");
    const r = await add(root, input ?? "-", { note, text: txt, publicOnly: true });
    return json({ id: r.id, duplicate: r.duplicate, ...(r.ex && { title: r.ex.title, partial: r.ex.partial }) });
  }));

  s.registerTool("log", {
    description: "Read-only: the structured journal entries (wiki/log.jsonl: at, kind, text, sources, pages) of the last days, newest first. The journal is not written through MCP.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(30).optional().describe("number of days (default 1)"),
      kind: z.enum(KINDS).optional().describe("keep only this kind of entry"),
    }),
    annotations: readOnly,
  }, toolResult(async ({ limit, kind }) => json(lastLog(root, limit ?? 1, kind))));

  s.registerTool("queue", {
    description: "Read-only: what needs a human decision (wiki/queue.jsonl: synthesis to write, merge, contradiction, split, review), open entries first by kind, with their number n, pages, sources and proposal. The queue is not written through MCP: the human closes entries with cortex queue done|dismiss <n>.",
    inputSchema: z.object({
      kind: z.enum(QUEUE_KINDS).optional().describe("keep only this kind of entry"),
      all: z.boolean().optional().describe("also return the closed entries (default: open only)"),
    }),
    annotations: readOnly,
  }, toolResult(async ({ kind, all }) => json(queueForAgent(root, kind, all))));

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
