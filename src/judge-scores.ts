import "./sqlite-lib"; // before any Database: it chooses the SQLite library
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { judge, type JudgeConfig, type Question } from "./judge";
import { sha256 } from "./lib";
import { LIMITS } from "./limits";

/**
 * Relevance scores of the judge for a list of pages, shared by the site's questions (ask-site.ts) and the site's search
 * (search-api.ts). Each page is judged in its own call (one call for several pages scored the same page 0.24 first and 0.75
 * last: measured on Jev), at most `concurrency` calls at a time. A score depends on the model, the wording of the question,
 * the normalized query, the page and the text the judge reads of it, so it is kept in `.cortex/judge.db` under the hash of
 * these (a page edited, or a question reworded in this code, is judged again). Every score is written as soon as its call
 * returns: a request that fails or is abandoned halfway keeps what it paid for. A page whose call fails has no score
 * (`undefined`); the others are not affected.
 */
export type JudgedPage = { path: string; /** what the judge reads of the page: its title, description and a clipped text */ page: { title: string; description: string; text: string } };
export type ScoreRequest = {
  /** Tells the cache entries of one use from another (`search`, `ask`). */
  purpose: string;
  /** The yes/no question the judge answers about `state`. */
  question: Extract<Question, { type: "noul" }>;
  /** What is asked, as the judge reads it (`{ query }`, `{ question, earlier }`): sent with each page. */
  request: Record<string, string>;
  /** The same, as the cache keys it: see `normalizeQuery`. */
  key: string[];
  pages: JudgedPage[];
  /** Names the call in the log. */
  what: (p: JudgedPage) => string;
};

/** Lowercase, trimmed, spaces collapsed, accents kept (NFC): « Chat  ? » and « chat ? » are the same question. */
export const normalizeQuery = (s: string) => s.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");

/** Consecutive failures, with no success yet, after which the rest of a batch is not tried (a server that is down, not a bad page). */
const BREAKER = 3;

export type ScoreCache = { get(key: string): number | undefined; set(key: string, score: number): void; close(): void };

/**
 * The scores file of `root`, emptied of what is older than `judgeCacheDays` and of the oldest rows beyond `judgeCacheRows`. A folder
 * that cannot be written (read-only, corrupt file): the scores live in memory for this call, nothing else changes.
 */
export function openScores(root: string, now = Date.now()): ScoreCache {
  try {
    mkdirSync(join(root, ".cortex"), { recursive: true });
    const db = new Database(join(root, ".cortex/judge.db"));
    try {
      db.run("PRAGMA busy_timeout = 5000");
      db.run("PRAGMA journal_mode = WAL");
      db.run("CREATE TABLE IF NOT EXISTS scores (key TEXT PRIMARY KEY, score REAL NOT NULL, at INTEGER NOT NULL)");
      db.run("CREATE INDEX IF NOT EXISTS scores_at ON scores (at)");
      db.run("DELETE FROM scores WHERE at < ?", [now - LIMITS.judgeCacheDays * 86_400_000]);
      db.run("DELETE FROM scores WHERE key IN (SELECT key FROM scores ORDER BY at DESC LIMIT -1 OFFSET ?)", [LIMITS.judgeCacheRows]);
    } catch (e) { db.close(); throw e; }
    const read = db.prepare("SELECT score FROM scores WHERE key = ?"), write = db.prepare("INSERT OR REPLACE INTO scores (key, score, at) VALUES (?, ?, ?)");
    return {
      get: (key) => (read.get(key) as { score: number } | null)?.score,
      set: (key, score) => { try { write.run(key, score, Date.now()); } catch { /* the score is still used by this call */ } },
      close: () => db.close(),
    };
  } catch {
    const mem = new Map<string, number>();
    return { get: (k) => mem.get(k), set: (k, v) => void mem.set(k, v), close: () => {} };
  }
}

/** Scores of `r.pages` in the same order, `undefined` for a page the judge could not rate. Cached scores cost no call. */
export async function scorePages(root: string, jc: JudgeConfig, r: ScoreRequest): Promise<(number | undefined)[]> {
  const out = new Array<number | undefined>(r.pages.length);
  if (!r.pages.length) return out;
  const cache = openScores(root);
  try {
    const wording = sha256(r.question.instructions), asked = r.key.map(normalizeQuery);
    const keys = r.pages.map((p) => sha256(JSON.stringify([jc.model, r.purpose, wording, asked, p.path, sha256(JSON.stringify(p.page))])));
    const todo: number[] = [];
    keys.forEach((k, i) => { const known = cache.get(k); if (known === undefined) todo.push(i); else out[i] = known; });
    let next = 0, ok = 0, failed = 0;
    const worker = async () => {
      while (next < todo.length && (ok || failed < BREAKER)) {
        const i = todo[next++]!, p = r.pages[i]!;
        const a = (await judge(root, { request: r.request, page: p.page }, { relevant: r.question }, undefined, r.what(p), { isolated: true }))?.relevant;
        if (a?.type !== "noul") { failed++; continue; }
        ok++; out[i] = a.noul; cache.set(keys[i]!, a.noul); // as it arrives, not after the others
      }
    };
    await Promise.all(Array.from({ length: Math.min(jc.concurrency, todo.length) }, worker));
    return out;
  } finally { cache.close(); }
}
