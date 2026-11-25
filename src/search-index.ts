import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { isReservedPage, parseDoc, sha256 } from "./lib";
import { loadVec } from "./native";
import { sqliteState } from "./sqlite-lib"; // before any Database: it chooses the SQLite library
import { warn } from "./style";

/**
 * The search index, `.cortex/search.db` (SQLite), kept up to date from wiki/ and raw/ by `sync`: only the files whose mtime or
 * size changed are read again. It holds
 *   - `docs`: a page (kind `page`: title, description and whole body) and, for each `##` section of a wiki page, a `passage`
 *     (section title and text); a raw source is one page;
 *   - `fts`: FTS5 over title and body of every doc (unicode61, accents folded); `fts_title`: FTS5 trigrams over the titles of
 *     the pages only (typos);
 *   - `vecs`: the embeddings (Float32 BLOB) by `sha256(model + text)`, referenced by `docs.vkey`: a page edited again finds the
 *     vectors of its unchanged sections instead of embedding them again. `vec_idx` (sqlite-vec `vec0`, cosine) indexes them for
 *     the KNN when the extension loads; otherwise the KNN is computed in JS over the BLOBs (embed.ts decides what is embedded).
 * If the file cannot be used (read-only folder, corrupt, busy), the index lives in memory: nothing here requires writing.
 */
export type Index = { db: Database; /** the sqlite-vec table is loaded and usable */ vec: boolean; close(): void };
export type Kind = "page" | "passage";
export type Unit = { id: number; path: string; parent: number | null; kind: Kind; area: "wiki" | "raw"; title: string; body: string };

const AREAS = ["wiki", "raw"] as const;
/** Bump when the tables or the indexed text change: an older file is deleted and rebuilt (embeddings.json of the first semantic search is not read any more). */
const INDEX_VERSION = 2;

type FileRow = { path: string; mtime: number; size: number };

/** Lowercase, accents removed: the form the trigram table holds and is asked in. */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const getMeta = (db: Database, key: string) => (db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | null)?.value;
export const setMeta = (db: Database, key: string, value: string | number) => { db.run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [key, String(value)]); };

const create = (db: Database) => {
  for (const sql of [
    "CREATE TABLE docs (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, parent INTEGER, kind TEXT NOT NULL, area TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL, vkey TEXT)",
    "CREATE INDEX docs_path ON docs (path)", "CREATE INDEX docs_vkey ON docs (vkey)",
    "CREATE TABLE files (path TEXT PRIMARY KEY, mtime REAL NOT NULL, size INTEGER NOT NULL)",
    "CREATE VIRTUAL TABLE fts USING fts5(title, body, content = 'docs', content_rowid = 'id', tokenize = 'unicode61 remove_diacritics 2')",
    "CREATE VIRTUAL TABLE fts_title USING fts5(title, tokenize = 'trigram')",
    "CREATE TABLE vecs (key TEXT PRIMARY KEY, vec BLOB NOT NULL)",
    "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  ]) db.run(sql);
  db.run(`PRAGMA user_version = ${INDEX_VERSION}`);
};

/** The `##` sections of a Markdown body (code fences respected), those with some text. The text before the first one stays on the page. */
export function sections(body: string): { title: string; text: string }[] {
  const out: { title: string; lines: string[] }[] = [];
  let fence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = !fence && /^##\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (m) out.push({ title: m[1].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "").trim(), lines: [] });
    else out.at(-1)?.lines.push(line);
  }
  return out.map((s) => ({ title: s.title, text: s.lines.join("\n").trim() })).filter((s) => s.text);
}

/** Brings the index in line with wiki/ and raw/. */
async function sync(ix: Index, root: string) {
  const { db } = ix;
  const have = new Map((db.query("SELECT path, mtime, size FROM files").all() as FileRow[]).map((r) => [r.path, r]));
  const seen = new Set<string>(), todo: { path: string; area: "wiki" | "raw"; mtime: number; size: number }[] = [];
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
  const fresh = [] as { path: string; area: "wiki" | "raw"; mtime: number; size: number; title: string; body: string; sections: ReturnType<typeof sections> }[], bad: string[] = [];
  for (const t of todo) {
    try {
      const d = parseDoc(t.path, await Bun.file(join(root, t.path)).text());
      fresh.push({ ...t, title: String(d.fm.title ?? ""), body: `${d.fm.description ?? ""}\n${d.fm.note ?? ""}\n${d.body}`, sections: t.area === "wiki" ? sections(d.body) : [] });
    } catch (e) { warn(`page skipped, invalid frontmatter: ${t.path} (${(e as Error).message.split("\n")[0]})`); bad.push(t.path); }
  }
  const gone = [...have.keys()].filter((p) => !seen.has(p));
  if (!fresh.length && !gone.length && !bad.length) return;
  const rows = db.prepare("SELECT id, kind, title, body FROM docs WHERE path = ?");
  const ins = db.prepare("INSERT INTO docs (path, parent, kind, area, title, body, hash) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const add = (path: string, parent: number | null, kind: Kind, area: string, title: string, body: string) => {
    const id = Number(ins.run(path, parent, kind, area, title, body, sha256(`${title}\n${body}`)).lastInsertRowid);
    db.run("INSERT INTO fts (rowid, title, body) VALUES (?, ?, ?)", [id, title, body]);
    if (kind === "page") db.run("INSERT INTO fts_title (rowid, title) VALUES (?, ?)", [id, fold(title)]);
    return id;
  };
  db.transaction(() => { // immediate: two cortex processes syncing at once do not index a file twice
    let removed = 0;
    const drop = (path: string) => {
      for (const r of rows.all(path) as { id: number; kind: Kind; title: string; body: string }[]) {
        db.run("INSERT INTO fts (fts, rowid, title, body) VALUES ('delete', ?, ?, ?)", [r.id, r.title, r.body]);
        if (r.kind === "page") db.run("DELETE FROM fts_title WHERE rowid = ?", [r.id]);
        if (ix.vec) db.run("DELETE FROM vec_idx WHERE doc_id = ?", [r.id]);
        else setMeta(db, "vec_stale", 1); // a writer without sqlite-vec: the next one that has it rebuilds vec_idx
      }
      db.run("DELETE FROM docs WHERE path = ?", [path]); db.run("DELETE FROM files WHERE path = ?", [path]);
    };
    for (const p of [...gone, ...bad]) { if (p.startsWith("wiki/")) removed++; drop(p); }
    for (const f of fresh) {
      drop(f.path);
      const page = add(f.path, null, "page", f.area, f.title, f.body);
      for (const s of f.sections) add(f.path, page, "passage", f.area, s.title, s.text);
      db.run("INSERT INTO files VALUES (?, ?, ?)", [f.path, f.mtime, f.size]);
    }
    if (removed) setMeta(db, "removed", Number(getMeta(db, "removed") ?? 0) + removed);
  }).immediate();
}

const withoutFile = (file: string) => { for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) rmSync(f, { force: true }); };

async function open(file: string): Promise<Index> {
  const db = new Database(file);
  try {
    db.run("PRAGMA busy_timeout = 5000");
    // WAL: a reader (a search, the assistant) is never blocked by the writer that indexes (`cortex serve` refreshes the embeddings while it answers); a commit stays atomic either way
    if (file !== ":memory:") db.run("PRAGMA journal_mode = WAL");
    if ((db.query("PRAGMA user_version").get() as { user_version: number }).user_version !== INDEX_VERSION) {
      if ((db.query("SELECT count(*) AS n FROM sqlite_master").get() as { n: number }).n) throw new Error("outdated index"); // a file of another version
      create(db);
    }
    const ext = await loadVec(db);
    const vec = ext && !!db.query("SELECT 1 FROM sqlite_master WHERE name = 'vec_idx'").get();
    return { db, vec, close: () => db.close() };
  } catch (e) { db.close(); throw e; }
}

/**
 * The up-to-date index of `root`. An index of an older version, corrupt, is deleted and rebuilt; one that cannot be written is
 * replaced by an in-memory one, as every search used to build it.
 */
export async function buildIndex(root: string): Promise<Index> {
  const file = join(root, ".cortex/search.db");
  for (let attempt = 0; attempt < 2; attempt++) {
    let ix: Index | undefined;
    try {
      mkdirSync(join(root, ".cortex"), { recursive: true });
      ix = await open(file);
      await sync(ix, root);
      if (ix.vec && getMeta(ix.db, "vec_stale") === "1") repairVectors(ix);
      return ix;
    } catch (e) {
      ix?.close();
      if (attempt || !/not a database|malformed|corrupt|no such table|no such module|outdated index/i.test((e as Error).message)) break;
      try { withoutFile(file); } catch { break; } // unusable index: start again from nothing
    }
  }
  const ix = await open(":memory:");
  await sync(ix, root);
  return ix;
}

// --- vectors

/** The `vec_idx` table (sqlite-vec) of `dims` dimensions, created again if it was built for another size; false without the extension. */
function vecTable(ix: Index, dims: number): boolean {
  const { db } = ix;
  try {
    if (!ix.vec && !db.query("SELECT 1 FROM sqlite_master WHERE name = 'vec_idx'").get()) {
      db.run(`CREATE VIRTUAL TABLE vec_idx USING vec0(doc_id INTEGER PRIMARY KEY, kind TEXT, embedding FLOAT[${dims}] distance_metric = cosine)`);
      setMeta(db, "vec_dims", dims);
      ix.vec = true;
    } else if (ix.vec && getMeta(db, "vec_dims") !== String(dims)) {
      db.run("DROP TABLE vec_idx");
      db.run(`CREATE VIRTUAL TABLE vec_idx USING vec0(doc_id INTEGER PRIMARY KEY, kind TEXT, embedding FLOAT[${dims}] distance_metric = cosine)`);
      setMeta(db, "vec_dims", dims);
    }
    return ix.vec;
  } catch { ix.vec = false; return false; }
}

/** Cosines are compared to 6 decimals: float noise must not decide the order of equal ones (the same with or without sqlite-vec). */
const round = (x: number) => Math.round(x * 1e6) / 1e6;
const byScore = (a: { id: number; score: number }, b: { id: number; score: number }) => b.score - a.score || a.id - b.id;
const f32 = (b: Uint8Array) => (b.byteOffset % 4 ? new Float32Array(b.slice().buffer) : new Float32Array(b.buffer, b.byteOffset, b.byteLength >> 2));

/** Rebuilds `vec_idx` from the stored vectors (it missed writes made while the extension was not there). */
function repairVectors(ix: Index) {
  const { db } = ix;
  try {
    const dims = Number(getMeta(db, "dims"));
    if (!dims) return;
    db.transaction(() => {
      db.run("DROP TABLE IF EXISTS vec_idx");
      db.run(`CREATE VIRTUAL TABLE vec_idx USING vec0(doc_id INTEGER PRIMARY KEY, kind TEXT, embedding FLOAT[${dims}] distance_metric = cosine)`);
      const put = db.prepare("INSERT INTO vec_idx (doc_id, kind, embedding) VALUES (?, ?, ?)");
      for (const r of db.query("SELECT d.id, d.kind, v.vec FROM docs d JOIN vecs v ON v.key = d.vkey").all() as { id: number; kind: Kind; vec: Uint8Array }[]) put.run(BigInt(r.id), r.kind, f32(r.vec));
      setMeta(db, "vec_dims", dims); setMeta(db, "vec_stale", 0);
    }).immediate();
  } catch { ix.vec = false; }
}

/** What the vectors were made with, undefined when none were stored. */
export function vectorModel(db: Database): { model: string; dims: number } | undefined {
  const model = getMeta(db, "model"), dims = Number(getMeta(db, "dims"));
  return model && dims ? { model, dims } : undefined;
}

/** Starts the vectors again for `model` at `dims` dimensions when they were made by another (or none yet): every doc is to embed. */
export function prepareVectors(ix: Index, model: string, dims: number) {
  const { db } = ix, cur = vectorModel(db);
  db.transaction(() => {
    if (cur?.model !== model || cur.dims !== dims) {
      db.run("UPDATE docs SET vkey = NULL"); db.run("DELETE FROM vecs");
      if (ix.vec) db.run("DELETE FROM vec_idx");
      setMeta(db, "model", model); setMeta(db, "dims", dims); setMeta(db, "vec_stale", 1);
    }
  }).immediate();
  if (!vecTable(ix, dims) || getMeta(db, "vec_stale") === "1") repairVectors(ix);
}

export function vectorOf(db: Database, key: string): Float32Array | undefined {
  const r = db.query("SELECT vec FROM vecs WHERE key = ?").get(key) as { vec: Uint8Array } | null;
  return r ? f32(r.vec) : undefined;
}

/** Path of each doc id. */
export function pathsOf(db: Database, ids: number[]): Map<number, string> {
  const out = new Map<number, string>();
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    for (const r of db.query(`SELECT id, path FROM docs WHERE id IN (${part.map(() => "?").join(",")})`).all(...part) as { id: number; path: string }[]) out.set(r.id, r.path);
  }
  return out;
}

/** Stores the vector `key` (once) and gives it to the docs `ids`. */
export function putVector(ix: Index, key: string, vec: Float32Array, docs: { id: number; kind: Kind }[]) {
  const { db } = ix;
  if (vec.length !== Number(getMeta(db, "dims"))) throw new Error(`embedding of ${vec.length} dimensions, ${getMeta(db, "dims")} expected`);
  db.run("INSERT OR IGNORE INTO vecs (key, vec) VALUES (?, ?)", [key, vec]);
  for (const d of docs) {
    db.run("UPDATE docs SET vkey = ? WHERE id = ?", [key, d.id]);
    if (ix.vec) db.run("INSERT OR REPLACE INTO vec_idx (doc_id, kind, embedding) VALUES (?, ?, ?)", [BigInt(d.id), d.kind, vec]);
    else setMeta(db, "vec_stale", 1);
  }
}

/** Forgets the vectors no doc refers to any more. */
export const gcVectors = (db: Database) => db.run("DELETE FROM vecs WHERE key NOT IN (SELECT vkey FROM docs WHERE vkey IS NOT NULL)");

/** The docs of the wiki not embedded yet. */
export const pending = (db: Database): Unit[] =>
  db.query("SELECT id, path, parent, kind, area, title, body FROM docs WHERE area = 'wiki' AND vkey IS NULL ORDER BY id").all() as Unit[];

/** The stored vector of the page `path`. */
export function pageVector(db: Database, path: string): Float32Array | undefined {
  const r = db.query("SELECT v.vec FROM docs d JOIN vecs v ON v.key = d.vkey WHERE d.path = ? AND d.kind = 'page'").get(path) as { vec: Uint8Array } | null;
  return r ? f32(r.vec) : undefined;
}

/**
 * The `k` docs whose vector is closest to `q` (unit vectors: cosine), best first, with their cosine. sqlite-vec does it when it
 * is loaded; otherwise (or if it fails) a pass over the BLOBs in JS, ~16 ms for 10 000 vectors. Same answer either way.
 */
export function nearestDocs(ix: Index, q: Float32Array, k: number, kind?: Kind): { id: number; score: number }[] {
  if (ix.vec) {
    try {
      const rows = ix.db.query(`SELECT doc_id AS id, distance FROM vec_idx WHERE embedding MATCH ? AND k = ?${kind ? " AND kind = ?" : ""}`)
        .all(...(kind ? [q, k, kind] : [q, k])) as { id: number; distance: number }[];
      return rows.map((r) => ({ id: r.id, score: round(1 - r.distance) })).sort(byScore);
    } catch { /* the extension fails on this query: JS below */ }
  }
  const out: { id: number; score: number }[] = [];
  for (const r of ix.db.query(`SELECT d.id, v.vec FROM docs d JOIN vecs v ON v.key = d.vkey WHERE d.area = 'wiki'${kind ? " AND d.kind = ?" : ""}`).all(...(kind ? [kind] : [])) as { id: number; vec: Uint8Array }[]) {
    const v = f32(r.vec);
    if (v.length !== q.length) continue;
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * q[i];
    out.push({ id: r.id, score: round(s) });
  }
  return out.sort(byScore).slice(0, k);
}

/**
 * For `cortex doctor` and the start of `serve`: the SQLite in use, where it came from, and whether sqlite-vec loads and answers a
 * KNN query (else the nearest neighbours are computed in JS).
 */
export async function searchInfo(): Promise<{ sqlite: string; library: string; vec?: string; knn: boolean; note?: string }> {
  const db = new Database(":memory:");
  try {
    const sqlite = (db.query("SELECT sqlite_version() AS v").get() as { v: string }).v;
    const vec = (await loadVec(db)) ? (db.query("SELECT vec_version() AS v").get() as { v: string }).v : undefined;
    let knn = false;
    if (vec) {
      try {
        db.run("CREATE VIRTUAL TABLE t USING vec0(id INTEGER PRIMARY KEY, embedding FLOAT[2] distance_metric = cosine)");
        db.run("INSERT INTO t (id, embedding) VALUES (1, ?), (2, ?)", [new Float32Array([1, 0]), new Float32Array([0, 1])]);
        knn = (db.query("SELECT id FROM t WHERE embedding MATCH ? AND k = 1").get(new Float32Array([0.1, 1])) as { id: number } | null)?.id === 2;
      } catch { /* reported as not answering */ }
    }
    const { path, source, error, ignored } = sqliteState;
    const library = path ? `${path}, from ${source === "env" ? "$CORTEX_SQLITE_LIB" : "Homebrew"}` : ignored ? "Bun's own ($CORTEX_SQLITE_LIB is only honoured on macOS)" : "the system's, or Bun's own";
    return { sqlite, library, vec, knn, note: error };
  } finally { db.close(); }
}
