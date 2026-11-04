import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { readDocs } from "./lib";

export type Hit = { path: string; title: string; area: "wiki" | "raw"; snippet: string; score: number };

/** Reconstruit l'index FTS5 (cache jetable dans .brain/) depuis wiki/ et raw/. */
export async function buildIndex(root: string): Promise<Database> {
  mkdirSync(join(root, ".brain"), { recursive: true });
  const db = new Database(join(root, ".brain/index.sqlite"));
  // ponytail: reconstruction complète à chaque recherche (~ms pour 100 fichiers) ; incrémental par mtime au-delà de quelques milliers
  db.run("DROP TABLE IF EXISTS docs");
  db.run(`CREATE VIRTUAL TABLE docs USING fts5(path UNINDEXED, area UNINDEXED, title, body, tokenize = 'unicode61 remove_diacritics 2')`);
  const ins = db.prepare("INSERT INTO docs (path, area, title, body) VALUES (?, ?, ?, ?)");
  for (const area of ["wiki", "raw"] as const) {
    const docs = await readDocs(root, area);
    db.transaction(() => {
      for (const d of docs) {
        if (/^wiki\/(index|log)\.md$/.test(d.path)) continue;
        ins.run(d.path, area, String(d.fm.title ?? ""), `${d.fm.description ?? ""}\n${d.fm.note ?? ""}\n${d.body}`);
      }
    })();
  }
  return db;
}

/** Chaque terme est mis entre guillemets : l'apostrophe ou le tiret d'une saisie libre ne casse pas la syntaxe FTS5. */
export const ftsQuery = (q: string) =>
  q.split(/\s+/).filter(Boolean).map((t) => `"${t.replaceAll('"', '""')}"`).join(" ");

export async function search(root: string, q: string, opts: { in?: "wiki" | "raw"; limit?: number } = {}): Promise<Hit[]> {
  const db = await buildIndex(root);
  const where = opts.in ? "AND area = $area" : "";
  // titre pondéré ×5 ; wiki avant raw
  const rows = db.query(`
    SELECT path, area, title, snippet(docs, 3, '«', '»', '…', 12) AS snippet, bm25(docs, 0, 0, 5, 1) AS score
    FROM docs WHERE docs MATCH $q ${where}
    ORDER BY area = 'raw', score LIMIT $limit`).all({ $q: ftsQuery(q), $area: opts.in ?? null, $limit: opts.limit ?? 20 }) as Hit[];
  db.close();
  return rows;
}
