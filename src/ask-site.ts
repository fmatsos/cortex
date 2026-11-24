import { createHash } from "node:crypto";
import { openWiki } from "./context";
import { pageId, type Page } from "./doc";
import { clip, judge, judgeConfig, type JudgeConfig } from "./judge";
import { LIMITS } from "./limits";
import { prompt } from "./prompts";
import { search } from "./search";
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
  "`request.earlier`, when present, is the previous question of the conversation.",
  "Yes: the page contains at least one statement that answers what the question asks.",
  "No: the page shares the topic or words of the question, but none of its statements answers what is asked.",
].join(" ");

// ponytail: kept for the life of the serve process, never evicted; an LRU if the wiki and its questions grow large
const scores = new Map<string, number>();

/**
 * Each page judged in its own call, all in parallel: one call for every page scored the same page 0.24 first and 0.75 last
 * (measured on Jev). The score depends on the question and the page only, so the same question retains the same pages.
 */
async function relevance(root: string, jc: JudgeConfig, request: { question: string; earlier?: string }, p: Page): Promise<number | undefined> {
  const page = { title: String(p.fm.title ?? p.path), description: String(p.fm.description ?? ""), text: clip(p.body, LIMITS.askJudgeChars) };
  const key = createHash("sha256").update(JSON.stringify([jc.model, request.question.trim().toLowerCase(), request.earlier?.trim().toLowerCase() ?? "", p.path, page])).digest("hex");
  const known = scores.get(key);
  if (known !== undefined) return known;
  const a = (await judge(root, { request, page }, { relevant: { type: "noul", instructions: RELEVANT } }, undefined, `site question, « ${page.title} »`))?.relevant;
  if (a?.type !== "noul") return;
  scores.set(key, a.noul);
  return a.noul;
}

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

/** The previous question of the conversation: a follow-up such as « et pour Bun ? » means nothing without it. */
export const lastQuestion = (history: readonly Turn[]) => history.findLast((t) => t.role === "user")?.text;

/**
 * The pages the answer rests on, judged against the question; undefined without a judge, or when one call fails (the agent
 * then works from the search hits, as before). The search takes the earlier question too, the judge keeps them apart.
 */
export async function relevantPages(root: string, question: string, earlier?: string): Promise<Core | undefined> {
  const jc = await judgeConfig(root);
  if (!jc) return;
  const query = earlier ? `${earlier} ${question}` : question;
  // a question rarely has all its words in one page: then any of them
  const find = (any: boolean) => search(root, query, { in: "wiki", limit: jc.askCandidates, any }).catch(() => []);
  const all = await find(false);
  const hits = all.length ? all : await find(true);
  const byPath = new Map((await openWiki(root).pages()).map((p) => [p.path, p]));
  const pages = hits.map((h) => byPath.get(h.path)).filter((p): p is Page => !!p);
  const request = earlier ? { question, earlier } : { question };
  const judged = await Promise.all(pages.map((page) => relevance(root, jc, request, page)));
  if (judged.some((r) => r === undefined)) return;
  return coreOf(pages.map((page, i) => ({ page, relevance: judged[i]! })), { retained: jc.askRetained, related: Math.min(jc.askRelated, jc.askRetained) });
}

const list = (refs: PageRef[]) => refs.map((r) => `/${r.path} « ${r.title} »`).join("; ");

/** What the agent is given about the wiki: the retained pages in full, else the search hits (no judge). */
export function pagesPart(core: Core | undefined, hits: string[]): string {
  if (!core) return prompt("ask-site-hits", { hits: hits.length ? hits.join("; ") : "none" });
  if (!core.retained.length && !core.related.length) return prompt("ask-site-none", {});
  const docs = core.documents.map((d) => `### /${d.path} « ${d.title} » (relevance ${d.relevance})\n\n${d.text}`).join("\n\n");
  return [
    prompt("ask-site-core", {}),
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
  const md = flattenBlocks(answer);
  const cited = [...new Set([...md.matchAll(/\]\((\/wiki\/[^)\s#]+\.md)/g)].map((m) => m[1]))];
  const kept = md.length > max ? `${md.slice(0, max)}\n[Rest of this answer left out of the history; the person received it whole.]` : md;
  return cited.length ? `${kept}\n[Pages cited in this answer: ${cited.join(", ")}]` : kept;
}

/** The earlier turns, most recent last, before the new question; empty without history. */
export function historyPart(history: readonly Turn[]): string {
  const recent = history.slice(-LIMITS.askHistoryTurns);
  if (!recent.length) return "";
  const lines = recent.map((t) => (t.role === "user" ? `User: ${t.text}` : `Assistant: ${compactAnswer(t.text)}`));
  return `${prompt("ask-site-history", {})}\n\n${lines.join("\n\n")}`;
}
