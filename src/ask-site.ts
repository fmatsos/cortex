import { join } from "node:path";
import { z } from "zod";
import type { ExtraTool } from "./backends/backend";
import { openWiki } from "./context";
import { fromResource, pageId, toResource, type Page } from "./doc";
import { clip, judgeConfig, type JudgeConfig } from "./judge";
import { scorePages } from "./judge-scores";
import { LIMITS } from "./limits";
import { getFile, relatedForAgent } from "./mcp";
import { related } from "./lib";
import { isUnder } from "./paths";
import { prompt } from "./prompts";
import { search, searchSpaces } from "./search";
import { instanceRoot, spaceRoot } from "./lib";
import { parseSpacePath, spaceCite, spaceRoots } from "./ask-scope";
import { flattenBlocks } from "./answer-blocks";

// --- Site questions (cortex serve, POST /api/ask): the pages an answer rests on, chosen by code before the agent runs, and
// the conversation sent back with each question (the server keeps no state).

export type Turn = { role: "user" | "assistant"; text: string };
/** A judged page: `id` as the site knows it, `relevance` the judge's probability that it answers the question. */
export type PageRef = { id: string; path: string; title: string; relevance: number };
/**
 * `retained` and `related` are listed under the answer whatever its wording; `documents` are the retained pages given to
 * the agent in full, `unread` the retained ones past the reading budget, named only.
 */
export type Core = { retained: PageRef[]; related: PageRef[]; documents: (PageRef & { text: string })[]; unread: PageRef[] };

// "answers what is asked" vs "same topic": measured on Jev, a looser wording rated fifteen documents on the topic above 0.85
const RELEVANT = [
  "Decide whether `page` should be read to answer `request.question`.",
  "Judge what the question asks about, not only its topic: a page on the same subject that says nothing about what is asked is not relevant.",
  "`request.earlier`, when present, lists the earlier questions of the conversation, one per line, the most recent last.",
  "Yes: the page contains at least one statement that answers what the question asks.",
  "No: the page shares the topic or words of the question, but none of its statements answers what is asked.",
].join(" ");

/**
 * Each page judged in its own call (judge-scores.ts): one call for every page scored the same page 0.24 first and 0.75 last
 * (measured on Jev). The score depends on the question and the page only, so the same question retains the same pages, from
 * one serve process to the next (the scores are kept in `.cortex/judge.db`). A call that fails leaves that page without a score.
 */
const relevance = (root: string, jc: JudgeConfig, request: { question: string; earlier?: string }, pages: Page[]) =>
  scorePages(root, jc, {
    purpose: "ask", question: { type: "noul", instructions: RELEVANT }, request, key: [request.question, request.earlier ?? ""],
    pages: pages.map((p) => ({ path: p.path, page: { title: String(p.fm.title ?? p.path), description: String(p.fm.description ?? ""), text: clip(p.body, LIMITS.askJudgeChars) } })),
    what: (p) => `site question, « ${p.page.title} »`,
  });

/** Most relevant first; equal scores by path, so the order never depends on how the search ranked them. */
export function coreOf(judged: { page: Page; relevance: number }[], t: { retained: number; related: number }, budget: number = LIMITS.askReadingChars): Core {
  const ref = ({ page, relevance }: { page: Page; relevance: number }): PageRef =>
    ({ id: pageId(page.path), path: page.path, title: String(page.fm.title ?? page.path), relevance: Math.round(relevance * 100) / 100 });
  const ranked = [...judged].sort((a, b) => b.relevance - a.relevance || a.page.path.localeCompare(b.page.path));
  const retained = ranked.filter((j) => j.relevance >= t.retained);
  const core: Core = { retained: retained.map(ref), related: ranked.filter((j) => j.relevance >= t.related && j.relevance < t.retained).map(ref), documents: [], unread: [] };
  let spent = 0;
  for (const j of retained) {
    // the first page always goes in full: a long page is the one most worth reading
    if (core.documents.length && spent + j.page.body.length > budget) core.unread.push(ref(j));
    else { core.documents.push({ ...ref(j), text: j.page.body.trim() }); spent += j.page.body.length; }
  }
  return core;
}

/** The wiki pages an answer links to (`/wiki/x.md`), once each: what the history tells the agent, and what a follow-up may mean. */
const citedPages = (answer: string) => [...new Set([...flattenBlocks(answer).matchAll(/\]\((\/wiki\/[^)\s#]+\.md)/g)].map((m) => m[1]!))];

/**
 * The pages the answer rests on, judged against the question; undefined without a judge, or when no page could be judged (the
 * agent then works from the search hits, as before). A page whose call failed is left out, the judged ones count. `history`:
 * the earlier turns. A follow-up such as « et pour Bun ? » means nothing alone, and may refer to any exchange of the window:
 * the search takes the last earlier question too, the pages cited in the earlier answers are candidates beside its hits, and
 * the judge gets all the earlier questions.
 */
export async function relevantPages(root: string, question: string, history: readonly Turn[] = []): Promise<Core | undefined> {
  const jc = await judgeConfig(root);
  if (!jc) return;
  const asked = history.filter((t) => t.role === "user").map((t) => clip(t.text, LIMITS.askEarlierChars));
  const query = asked.length ? `${asked.at(-1)} ${question}` : question;
  // a question rarely has all its words in one page: any of them (BM25 weighs the rare ones). All of them left the lexical side
  // with 0 to 2 pages, so the semantic side filled the candidates alone, and the fallback to `any` never fired
  const hits = await search(root, query, { in: "wiki", limit: jc.askCandidates, any: true }).catch(() => []);
  const byPath = new Map((await openWiki(root).pages()).map((p) => [p.path, p]));
  // the most recent answers' pages first, as many as the search offers: the judge is paid per page
  const cited = history.filter((t) => t.role === "assistant").reverse().flatMap((t) => citedPages(t.text)).map((p) => p.slice(1));
  const pages = [...new Set([...hits.map((h) => h.path), ...[...new Set(cited)].slice(0, jc.askCandidates)])].map((p) => byPath.get(p)).filter((p): p is Page => !!p);
  const request = asked.length ? { question, earlier: asked.join("\n") } : { question };
  const scores = await relevance(root, jc, request, pages);
  const judged = pages.flatMap((page, i) => (scores[i] === undefined ? [] : [{ page, relevance: scores[i]! }]));
  if (pages.length && !judged.length) return;
  return coreOf(judged, { retained: jc.askRetained, related: Math.min(jc.askRelated, jc.askRetained) });
}

const list = (refs: PageRef[]) => refs.map((r) => `/${r.path} « ${r.title} »`).join("; ");

/** What the agent is given about the wiki: the retained pages in full, else the search hits (no judge). */
export function pagesPart(core: Core | undefined, hits: string[]): string {
  if (!core) return prompt("ask-site-hits", { hits: hits.length ? hits.join("; ") : "none" });
  if (!core.retained.length && !core.related.length) return prompt("ask-site-none", {});
  const docs = core.documents.map((d) => `### /${d.path} « ${d.title} » (relevance ${d.relevance})\n\n${d.text}`).join("\n\n");
  return [
    // nothing retained, only related pages: no "given in full" without documents, the agent reads and searches
    core.documents.length ? prompt("ask-site-core", {}) : prompt("ask-site-none-retained", {}),
    docs,
    core.unread.length ? `${prompt("ask-site-unread", {})} ${list(core.unread)}` : "",
    core.related.length ? `${prompt("ask-site-related", {})} ${list(core.related)}` : "",
  ].filter(Boolean).join("\n\n");
}

/**
 * An earlier answer as the history carries it: cut when long, saying so (a silent cut made an agent tell the person
 * their answer "was cut"), with every page it cited.
 */
export function compactAnswer(answer: string, max: number = LIMITS.askHistoryChars): string {
  const md = flattenBlocks(answer), cited = citedPages(answer);
  const kept = md.length > max ? `${md.slice(0, max)}\n[Rest of this answer left out of the history; the person received it whole.]` : md;
  return cited.length ? `${kept}\n[Pages cited in this answer: ${cited.join(", ")}]` : kept;
}

/** The last `exchanges` (a question and its answer) of the earlier turns, most recent last, before the new question; empty without history. */
export function historyPart(history: readonly Turn[], exchanges: number): string {
  const recent = history.slice(-2 * exchanges);
  if (!recent.length) return "";
  const lines = recent.map((t) => (t.role === "user" ? `User: ${t.text}` : `Assistant: ${compactAnswer(t.text)}`));
  return `${prompt("ask-site-history", {})}\n\n${lines.join("\n\n")}`;
}

/**
 * The only way the site's agent reads the wiki (the cortex tool pack is off for it): the MCP tools of mcp.ts, wiki only (never
 * raw/), on the same hybrid search. All three read, so `LIMITS.askToolRounds` counts them.
 */
export const wikiTools = (root: string): ExtraTool[] => [
  {
    name: "search", read: true,
    description: "Hybrid search in the wiki (words and meaning; one result per page, with the extract of its best section). Use 2 or 3 key terms, never the whole question.",
    schema: z.object({ q: z.string().describe("search terms"), limit: z.number().int().min(1).max(20).optional().describe("maximum number of results (default 8)") }),
    run: async ({ q, limit }: { q: string; limit?: number }) =>
      JSON.stringify((await search(root, q, { in: "wiki", limit: limit ?? 8 })).map((h) => ({ path: toResource(h.path), title: h.title, snippet: h.snippet })), null, 1),
  },
  {
    name: "get", read: true,
    description: "Reads the content of a wiki page, for example /wiki/concepts/x.md: a page found by search or related.",
    schema: z.object({ path: z.string().describe("path of the page, with or without a leading \"/\"") }),
    run: async ({ path }: { path: string }) => {
      if (!isUnder(root, "wiki", join(root, fromResource(path)))) throw new Error(`Path refused: ${path} (expected: a .md under wiki/)`);
      return getFile(root, path);
    },
  },
  {
    name: "related", read: true,
    description: "Wiki pages related to a page: outgoing links, backlinks, shared sources and tags, ranked by strength with the reason.",
    schema: z.object({ path: z.string().describe("wiki page, for example /wiki/concepts/x.md"), limit: z.number().int().min(1).max(20).optional().describe("maximum number of pages (default 8)") }),
    run: async ({ path, limit }: { path: string; limit?: number }) => JSON.stringify(relatedForAgent(related(await openWiki(root).pages(), path), limit ?? 8), null, 1),
  },
];

/**
 * The same three tools for a question that reads several spaces (`root`: any folder of the instance; `spaces`: the names the question may
 * read, fixed by the server, not by the arguments). A page is named by its citation link, `/s/<space>/wiki/x.md`, in what the tools return
 * and in what they take: a space outside the list is refused whatever the path says.
 */
export const spacesTools = (root: string, spaces: string[]): ExtraTool[] => {
  const instance = instanceRoot(root), inside = (path: string) => { const { space, file } = parseSpacePath(spaces, path); return { space, file, root: spaceRoot(instance, space) }; };
  return [
    {
      name: "search", read: true,
      description: "Hybrid search in the wiki of every space of this question at once (words and meaning; one ranking, one result per page, with the extract of its best section; each result names its space). Use 2 or 3 key terms, never the whole question.",
      schema: z.object({ q: z.string().describe("search terms"), limit: z.number().int().min(1).max(20).optional().describe("maximum number of results (default 8)") }),
      run: async ({ q, limit }: { q: string; limit?: number }) =>
        JSON.stringify((await searchSpaces(spaceRoots(instance, spaces), q, { in: "wiki", limit: limit ?? 8 })).map((h) => ({ space: h.space, path: spaceCite(h.space, h.path), title: h.title, snippet: h.snippet })), null, 1),
    },
    {
      name: "get", read: true,
      description: "Reads the content of a wiki page of one of the spaces, for example /s/<space>/wiki/concepts/x.md: a page found by search or related.",
      schema: z.object({ path: z.string().describe("path of the page, as search gives it: /s/<space>/wiki/….md") }),
      run: async ({ path }: { path: string }) => {
        const p = inside(path);
        if (!isUnder(p.root, "wiki", join(p.root, fromResource(p.file)))) throw new Error(`Path refused: ${path} (expected: a .md under wiki/)`);
        return getFile(p.root, p.file);
      },
    },
    {
      name: "related", read: true,
      description: "Wiki pages related to a page of one of the spaces: outgoing links, backlinks, shared sources and tags, ranked by strength with the reason.",
      schema: z.object({ path: z.string().describe("wiki page, for example /s/<space>/wiki/concepts/x.md"), limit: z.number().int().min(1).max(20).optional().describe("maximum number of pages (default 8)") }),
      run: async ({ path, limit }: { path: string; limit?: number }) => {
        const p = inside(path);
        return JSON.stringify(relatedForAgent(related(await openWiki(p.root).pages(), p.file), limit ?? 8).map((r) => ({ ...r, path: spaceCite(p.space, r.path) })), null, 1);
      },
    },
  ];
};
