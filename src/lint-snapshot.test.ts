import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lint } from "./lint";

/**
 * T9: snapshot of `lint` on a fixture wiki that exercises every rule. The whole issue list is pinned (sorted by
 * path, level, message), so any behaviour change in lint shows up as a diff of this list.
 */

const NOW = new Date("2026-11-04T12:00:00+01:00");
const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const raw = (n: number) => `raw/2026/11/${id(n)}/source.md`;
const wiki = (dir: string, n: number) => `wiki/${dir}/${id(n)}.md`;

const page = (fm: Record<string, string | undefined>, body = "") =>
  `---\n${Object.entries(fm).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n${body}\n`;
const rawSrc = (fm: Record<string, string>) => `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\ntexte\n`;

const S = "{ by: x, at: 2026-11-04T09:00:00+01:00 }";
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cortex-snap-"));
  const w = (path: string, txt: string) => Bun.write(join(root, path), txt);
  await w("cortex.json", "{}");

  // raw sources
  await w(raw(1), rawSrc({ type: "RawSource", title: "R1", fetched_at: "2026-11-01T00:00:00+01:00", note: "n", status: "compiled" })); // cited twice: duplicate Source pages
  await w(raw(2), rawSrc({ type: "RawSource", title: "R2", fetched_at: "2026-11-01T00:00:00+01:00", note: "n", status: "compiled" })); // compiled, cited by nobody
  await w(raw(3), rawSrc({ type: "RawSource", title: "R3", fetched_at: "2026-10-01T00:00:00+01:00", note: '""', status: "pending" })); // no note, pending > 7 days
  await w(raw(4), rawSrc({ type: "RawSource", title: "R4", fetched_at: "2026-11-03T00:00:00+01:00", note: "n", status: "pending" })); // clean
  await w(raw(5), rawSrc({ type: "Note", title: "R5", fetched_at: "2026-11-03T00:00:00+01:00", note: "n", status: "skipped" })); // wrong type
  await w(raw(6), "---\ntype: [oops\n---\nx\n"); // invalid YAML
  await w("raw/2026/11/zz-bad/source.md", rawSrc({ type: "RawSource", title: "Z1", note: "n", status: "skipped" })); // outside raw_path
  await w("raw/2025/01/zz-bad/source.md", rawSrc({ type: "RawSource", title: "Z2", note: "n", status: "skipped" })); // same raw id again
  await w("raw/2026/11/loose.md", rawSrc({ type: "RawSource", title: "L", note: "n", status: "skipped" })); // not a source.md

  // wiki pages
  await w(wiki("concepts", 1), page(
    { type: "Concept", title: "Alpha", description: "D.", tags: "[llm, context]", status: "stable", generated: "{ by: x, at: 2026-11-04T09:00:00+01:00 }", verified: "{ by: y, at: 2026-11-04T10:00:00+01:00 }", sources: `\n  - id: r4\n    resource: /${raw(4)}` },
    `Voir [Beta](/${wiki("concepts", 2)}). Fait.[^r4]\n\n[^r4]: Détail.`)); // clean page, linked from Beta
  await w(wiki("concepts", 2), page(
    { type: "Concept", title: "Beta", description: "D.", tags: "[llms]", generated: "{ by: x, at: 2026-11-04T11:00:00+01:00 }", verified: "{ by: y, at: 2026-11-04T10:00:00+01:00 }", stale_after: "2026-06-01T00:00:00+00:00" },
    `Voir [Alpha](/${wiki("concepts", 1)}#x) et [cassé](/${wiki("concepts", 99)}). Fait.[^zz]`)); // near-synonym tag, broken link, footnote without entry, modified since review, stale
  await w(wiki("concepts", 3), page({ type: "Concept", title: "alpha", description: "D.", generated: S }, "Rien. Voir [Beta](../concepts/beta.md).")); // duplicate title, orphan, never reviewed, relative .md link
  await w(wiki("concepts", 4), page({ type: undefined, title: "Gamma", generated: S }, `Voir [Alpha](/${wiki("concepts", 1)}).`)); // missing type and description
  await w(wiki("concepts", 5), page({ type: "Concept", title: "Delta", description: "D.", tags: "[context]", generated: S, sources: `\n  - id: a\n    resource: /${raw(99)}\n  - id: b` }, `Voir [Alpha](/${wiki("concepts", 1)}).[^a]`)); // missing resource files, same tag as Alpha
  // REL-16: type outside the four, status outside the three, tags that is not a list, missing title
  await w(wiki("concepts", 6), page({ type: "concept", title: "Epsilon", description: "D.", generated: S }, "Rien."));
  await w(wiki("concepts", 7), page({ type: "Concept", title: "Zeta", description: "D.", status: "wip", tags: "llm", generated: S }, "Rien."));
  await w(wiki("concepts", 8), page({ type: "Concept", description: "D.", generated: S }, "Rien."));
  await w("wiki/entities/a-la-main.md", page({ type: "Entity", title: "Main", description: "D.", generated: S }, `Voir [Alpha](/${wiki("concepts", 1)}).`)); // outside page_path
  await w(wiki("sources", 1), page({ type: "Source", title: "Source un", description: "D.", generated: S, sources: `\n  - id: r1\n    resource: /${raw(1)}` }, `Lien [Alpha](/${wiki("concepts", 1)}).[^r1]`));
  await w(wiki("sources", 2), page({ type: "Source", title: "Source deux", description: "D.", generated: S, sources: `\n  - id: r1\n    resource: /${raw(1)}` }, `Lien [Beta](/${wiki("concepts", 2)}).`)); // same raw source as above
  await w("wiki/concepts/invalide.md", "---\ntype: [oops\n---\nx\n"); // invalid YAML
  await w("wiki/index.md", "# Index\n"); // reserved: ignored by the page rules

  // journal: one invalid line, and a hand-written log.md
  await w("wiki/log.jsonl", '{"at":"2026-11-04","kind":"add","text":"x"}\n{pas du json\n{"at":"2026-11-04","kind":"zz","text":"x"}\n');
  await w("wiki/log.md", "# Journal\n- à la main\n");
  return root;
}

const key = (i: { level: string; path: string; msg: string }) => `${i.path}\t${i.level}\t${i.msg}`;

test("T9: lint snapshot on a fixture wiki exercising every rule", async () => {
  const root = await fixture();
  const issues = (await lint(root, NOW)).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)).map((i) => [i.level, i.path, i.msg]);
  expect(issues).toEqual([
    ["warning", "raw/2025/01/zz-bad/source.md", "chemin hors du modèle raw_path « {yyyy}/{mm}/{uuid} » (les sources s'ajoutent par cortex add)"],
    ["warning", `raw/2026/11/${id(2)}/source.md`, "compilée mais aucune page Source ne la cite"],
    ["warning", `raw/2026/11/${id(3)}/source.md`, "en attente depuis plus de 7 jours"],
    ["warning", `raw/2026/11/${id(3)}/source.md`, "note manquante : à demander avant de compiler"],
    ["error", `raw/2026/11/${id(5)}/source.md`, "type: RawSource attendu"],
    ["error", `raw/2026/11/${id(6)}/source.md`, "YAML invalide : YAML Parse error: Unexpected token"],
    ["warning", "raw/2026/11/loose.md", "chemin hors du modèle raw_path « {yyyy}/{mm}/{uuid} » (les sources s'ajoutent par cortex add)"],
    ["error", "raw/2026/11/zz-bad/source.md", "id raw en double : zz-bad (aussi raw/2025/01/zz-bad/source.md) ; le journal ne peut pas distinguer les deux"],
    ["warning", "raw/2026/11/zz-bad/source.md", "chemin hors du modèle raw_path « {yyyy}/{mm}/{uuid} » (les sources s'ajoutent par cortex add)"],
    ["error", `wiki/concepts/${id(2)}.md`, `lien cassé : /wiki/concepts/${id(99)}.md`],
    ["error", `wiki/concepts/${id(2)}.md`, "note [^zz] sans entrée sources[]"],
    ["warning", `wiki/concepts/${id(2)}.md`, "modifiée depuis la relecture (generated.at > verified.at) : à relire"],
    ["warning", `wiki/concepts/${id(2)}.md`, "périmée depuis 2026-06-01 (stale_after)"],
    ["warning", `wiki/concepts/${id(2)}.md`, "tags quasi synonymes : « llm » et « llms »"],
    ["info", `wiki/concepts/${id(3)}.md`, "jamais relue"],
    ["warning", `wiki/concepts/${id(3)}.md`, `doublon probable de wiki/concepts/${id(1)}.md (même titre)`],
    ["warning", `wiki/concepts/${id(3)}.md`, "lien relatif vers un .md : ../concepts/beta.md (utilise un lien depuis la racine : /wiki/….md)"],
    ["warning", `wiki/concepts/${id(3)}.md`, "orpheline : aucun lien entrant"],
    ["error", `wiki/concepts/${id(4)}.md`, "description manquante"],
    ["error", `wiki/concepts/${id(4)}.md`, "type manquant"],
    ["info", `wiki/concepts/${id(4)}.md`, "jamais relue"],
    ["warning", `wiki/concepts/${id(4)}.md`, "orpheline : aucun lien entrant"],
    ["error", `wiki/concepts/${id(5)}.md`, `source introuvable : /raw/2026/11/${id(99)}/source.md`],
    ["error", `wiki/concepts/${id(5)}.md`, "source introuvable : undefined"],
    ["info", `wiki/concepts/${id(5)}.md`, "jamais relue"],
    ["warning", `wiki/concepts/${id(5)}.md`, "orpheline : aucun lien entrant"],
    // REL-16 rows: bad type, bad status, tags not a list, missing title (+ the usual orphan / never-reviewed noise of the new pages)
    ["error", `wiki/concepts/${id(6)}.md`, "type inconnu : concept (attendu : Source | Concept | Entity | Synthesis)"],
    ["info", `wiki/concepts/${id(6)}.md`, "jamais relue"],
    ["warning", `wiki/concepts/${id(6)}.md`, "orpheline : aucun lien entrant"],
    ["error", `wiki/concepts/${id(7)}.md`, "status inconnu : wip (attendu : draft | stable | deprecated)"],
    ["error", `wiki/concepts/${id(7)}.md`, "tags : liste de textes attendue"],
    ["info", `wiki/concepts/${id(7)}.md`, "jamais relue"],
    ["warning", `wiki/concepts/${id(7)}.md`, "orpheline : aucun lien entrant"],
    ["error", `wiki/concepts/${id(8)}.md`, "titre manquant"],
    ["info", `wiki/concepts/${id(8)}.md`, "jamais relue"],
    ["warning", `wiki/concepts/${id(8)}.md`, "orpheline : aucun lien entrant"],
    ["error", "wiki/concepts/invalide.md", "YAML invalide : YAML Parse error: Unexpected token"],
    ["info", "wiki/entities/a-la-main.md", "jamais relue"],
    ["warning", "wiki/entities/a-la-main.md", "nom hors du modèle page_path « {type}/{uuid} » (les pages se créent par cortex new)"],
    ["warning", "wiki/entities/a-la-main.md", "orpheline : aucun lien entrant"],
    ["error", "wiki/log.jsonl:2", "JSON invalide"],
    ["error", "wiki/log.jsonl:3", "kind : add|ingest|query|lint|update"],
    ["warning", "wiki/log.md", "diffère de sa génération depuis wiki/log.jsonl (édité à la main ?) : cortex index le régénère"],
    ["info", `wiki/sources/${id(1)}.md`, "jamais relue"],
    ["info", `wiki/sources/${id(2)}.md`, "jamais relue"],
    ["warning", `wiki/sources/${id(2)}.md`, `doublon probable de wiki/sources/${id(1)}.md (même source raw /raw/2026/11/${id(1)}/source.md)`],

  ]);
});
