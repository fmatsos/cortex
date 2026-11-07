import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { EMBED, nearest } from "./embed";
import { isReservedPage, parseDoc } from "./lib";
import { warn } from "./style";
import { LIMITS } from "./limits";

export type Hit = { path: string; title: string; area: "wiki" | "raw"; snippet: string; score: number };

const AREAS = ["wiki", "raw"] as const;
/** Bump when the tables or the indexed text change: an older cache is dropped and rebuilt. */
const CACHE_VERSION = 1;

type FileRow = { path: string; docid: number; mtime: number; size: number };

/** Brings the index in line with wiki/ and raw/: only the files whose mtime or size changed are read again, the removed ones are dropped. */
async function sync(db: Database, root: string) {
  if ((db.query("PRAGMA user_version").get() as { user_version: number }).user_version !== CACHE_VERSION) {
    db.run("DROP TABLE IF EXISTS docs"); db.run("DROP TABLE IF EXISTS files");
    db.run(`CREATE VIRTUAL TABLE docs USING fts5(path UNINDEXED, area UNINDEXED, title, body, tokenize = 'unicode61 remove_diacritics 2')`);
    db.run("CREATE TABLE files (path TEXT PRIMARY KEY, docid INTEGER, mtime REAL, size INTEGER)");
    db.run(`PRAGMA user_version = ${CACHE_VERSION}`);
  }
  const have = new Map((db.query("SELECT path, docid, mtime, size FROM files").all() as FileRow[]).map((r) => [r.path, r]));
  const seen = new Set<string>(), todo: { path: string; area: string; mtime: number; size: number }[] = [];
  for (const area of AREAS) {
    if (!existsSync(join(root, area))) continue;
    for (const f of [...new Bun.Glob("**/*.md").scanSync(join(root, area))].sort()) { // sorted: equal scores keep a stable order
      const path = `${area}/${f}`;
      if (isReservedPage(path)) continue;
      const { mtimeMs: mtime, size } = statSync(join(root, path));
      seen.add(path);
      const h = have.get(path);
      if (!h || h.mtime !== mtime || h.size !== size) todo.push({ path, area, mtime, size });
    }
  }
  const fresh = [] as { path: string; area: string; mtime: number; size: number; title: string; body: string }[], bad: string[] = [];
  for (const t of todo) {
    try {
      const d = parseDoc(t.path, await Bun.file(join(root, t.path)).text());
      fresh.push({ ...t, title: String(d.fm.title ?? ""), body: `${d.fm.description ?? ""}\n${d.fm.note ?? ""}\n${d.body}` });
    } catch (e) { warn(`page skipped, invalid frontmatter: ${t.path} (${(e as Error).message.split("\n")[0]})`); bad.push(t.path); }
  }
  const gone = [...have.keys()].filter((p) => !seen.has(p));
  if (!fresh.length && !gone.length && !bad.length) return;
  const docid = db.prepare("SELECT docid FROM files WHERE path = ?"), ins = db.prepare("INSERT INTO docs (path, area, title, body) VALUES (?, ?, ?, ?)");
  db.transaction(() => { // immediate: two cortex processes syncing at once do not index a file twice
    const drop = (path: string) => {
      const r = docid.get(path) as { docid: number } | null;
      if (r) { db.run("DELETE FROM docs WHERE rowid = ?", [r.docid]); db.run("DELETE FROM files WHERE path = ?", [path]); }
    };
    for (const p of [...gone, ...bad]) drop(p);
    for (const f of fresh) {
      drop(f.path);
      db.run("INSERT INTO files VALUES (?, ?, ?, ?)", [f.path, ins.run(f.path, f.area, f.title, f.body).lastInsertRowid, f.mtime, f.size]);
    }
  }).immediate();
}

/**
 * FTS5 index of wiki/ and raw/, persisted in .cortex/search.db and kept up to date by `sync`. If the cache cannot be used (read-only
 * sandbox, corrupt file, busy), the index is built in memory instead, as every search used to: nothing here is ever required to write.
 */
export async function buildIndex(root: string): Promise<Database> {
  const file = join(root, ".cortex/search.db");
  for (let attempt = 0; attempt < 2; attempt++) {
    let db: Database | undefined;
    try {
      mkdirSync(join(root, ".cortex"), { recursive: true });
      db = new Database(file);
      db.run("PRAGMA busy_timeout = 5000");
      await sync(db, root);
      return db;
    } catch (e) {
      db?.close();
      if (attempt || !/not a database|malformed|corrupt|no such table/i.test((e as Error).message)) break;
      try { rmSync(file, { force: true }); } catch { break; } // unreadable cache: start again from nothing
    }
  }
  const db = new Database(":memory:");
  await sync(db, root);
  return db;
}

/** Each term is quoted: the apostrophe or hyphen of free input does not break the FTS5 syntax. */
export const ftsQuery = (q: string) =>
  q.split(/\s+/).filter(Boolean).map((t) => `"${t.replaceAll('"', '""')}"`).join(" ");

/**
 * BM25 over the title (×5) and the text, wiki before raw. With `titles`, the match is on the title only (duplicate check).
 * When semantic search is on and available (embed.ts), the BM25 and the cosine top 50 are fused (RRF); `nearest` never fails
 * the search: without it, the BM25 ranking is the answer.
 */
export async function search(root: string, q: string, opts: { in?: "wiki" | "raw"; limit?: number; titles?: boolean } = {}): Promise<Hit[]> {
  const limit = opts.limit ?? 20;
  const near = limit > 0 && !opts.titles && opts.in !== "raw" ? await nearest(root, q, EMBED.topK) : undefined;
  const db = await buildIndex(root);
  try {
    const where = opts.in ? "AND area = $area" : "";
    const rows = db.query(`
      SELECT path, area, title, snippet(docs, 3, '«', '»', '…', ${LIMITS.snippetTokens}) AS snippet, bm25(docs, 0, 0, 5, 1) AS score
      FROM docs WHERE docs MATCH $q ${where}
      ORDER BY area = 'raw', score, path LIMIT $limit`).all({ $q: opts.titles ? `title : (${ftsQuery(q)})` : ftsQuery(q), $area: opts.in ?? null, $limit: near ? EMBED.topK : limit }) as Hit[];
    if (!near) return rows;
    // reciprocal rank fusion; a page only the vectors found has no snippet; wiki stays before raw
    const rrf = new Map<string, number>();
    for (const list of [rows, near]) list.forEach((h, i) => rrf.set(h.path, (rrf.get(h.path) ?? 0) + 1 / (EMBED.rrfK + i + 1)));
    const byPath = new Map(rows.map((r) => [r.path, r]));
    const only = near.map((n) => n.path).filter((p) => !byPath.has(p));
    if (only.length) {
      const sql = `SELECT d.path, d.area, d.title FROM files f JOIN docs d ON d.rowid = f.docid WHERE f.path IN (${only.map(() => "?").join(",")})`;
      for (const r of db.query(sql).all(...only) as Omit<Hit, "snippet" | "score">[]) byPath.set(r.path, { ...r, snippet: "", score: 0 });
    }
    return [...byPath.values()].map((h) => ({ ...h, score: -(rrf.get(h.path) ?? 0) }))
      .sort((a, b) => Number(a.area === "raw") - Number(b.area === "raw") || a.score - b.score || a.path.localeCompare(b.path)).slice(0, limit);
  } finally { db.close(); }
}
