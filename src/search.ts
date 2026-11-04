import { Database } from "bun:sqlite";
import { isReservedPage, readDocs } from "./lib";
import { warn } from "./style";

export type Hit = { path: string; title: string; area: "wiki" | "raw"; snippet: string; score: number };

/** In-memory FTS5 index, rebuilt from wiki/ and raw/: no writes, so usable in a read-only sandbox. */
export async function buildIndex(root: string): Promise<Database> {
  // ponytail: full rebuild on every search (~ms for 100 files); incremental persistent index by mtime beyond a few thousand
  const db = new Database(":memory:");
  db.run(`CREATE VIRTUAL TABLE docs USING fts5(path UNINDEXED, area UNINDEXED, title, body, tokenize = 'unicode61 remove_diacritics 2')`);
  const ins = db.prepare("INSERT INTO docs (path, area, title, body) VALUES (?, ?, ?, ?)");
  for (const area of ["wiki", "raw"] as const) {
    const { docs, errors } = await readDocs(root, area);
    for (const e of errors) warn(`page ignorée, frontmatter invalide : ${e.path} (${e.msg})`);
    db.transaction(() => {
      for (const d of docs) {
        if (isReservedPage(d.path)) continue;
        ins.run(d.path, area, String(d.fm.title ?? ""), `${d.fm.description ?? ""}\n${d.fm.note ?? ""}\n${d.body}`);
      }
    })();
  }
  return db;
}

/** Each term is quoted: the apostrophe or hyphen of free input does not break the FTS5 syntax. */
export const ftsQuery = (q: string) =>
  q.split(/\s+/).filter(Boolean).map((t) => `"${t.replaceAll('"', '""')}"`).join(" ");

export async function search(root: string, q: string, opts: { in?: "wiki" | "raw"; limit?: number } = {}): Promise<Hit[]> {
  const db = await buildIndex(root);
  const where = opts.in ? "AND area = $area" : "";
  // title weighted ×5; wiki before raw
  const rows = db.query(`
    SELECT path, area, title, snippet(docs, 3, '«', '»', '…', 12) AS snippet, bm25(docs, 0, 0, 5, 1) AS score
    FROM docs WHERE docs MATCH $q ${where}
    ORDER BY area = 'raw', score LIMIT $limit`).all({ $q: ftsQuery(q), $area: opts.in ?? null, $limit: opts.limit ?? 20 }) as Hit[];
  db.close();
  return rows;
}
