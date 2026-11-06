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
    ["warning", "raw/2025/01/zz-bad/source.md", "path outside the raw_path template \"{yyyy}/{mm}/{uuid}\" (sources are added with cortex add)"],
    ["warning", `raw/2026/11/${id(2)}/source.md`, "compiled but no Source page cites it"],
    ["warning", `raw/2026/11/${id(3)}/source.md`, "pending for more than 7 days"],
    ["error", `raw/2026/11/${id(5)}/source.md`, "expected type: RawSource"],
    ["error", `raw/2026/11/${id(6)}/source.md`, "invalid YAML: YAML Parse error: Unexpected token"],
    ["warning", "raw/2026/11/loose.md", "path outside the raw_path template \"{yyyy}/{mm}/{uuid}\" (sources are added with cortex add)"],
    ["error", "raw/2026/11/zz-bad/source.md", "duplicate raw id: zz-bad (also raw/2025/01/zz-bad/source.md); the journal cannot tell them apart"],
    ["warning", "raw/2026/11/zz-bad/source.md", "path outside the raw_path template \"{yyyy}/{mm}/{uuid}\" (sources are added with cortex add)"],
    ["error", `wiki/concepts/${id(2)}.md`, `broken link: /wiki/concepts/${id(99)}.md`],
    ["error", `wiki/concepts/${id(2)}.md`, "footnote [^zz] has no sources[] entry"],
    ["warning", `wiki/concepts/${id(2)}.md`, "modified since review (generated.at > verified.at): review again"],
    ["warning", `wiki/concepts/${id(2)}.md`, "near-synonym tags: \"llm\" and \"llms\""],
    ["warning", `wiki/concepts/${id(2)}.md`, "stale since 2026-06-01 (stale_after)"],
    ["info", `wiki/concepts/${id(3)}.md`, "never reviewed"],
    ["warning", `wiki/concepts/${id(3)}.md`, "orphan: no incoming link"],
    ["warning", `wiki/concepts/${id(3)}.md`, `probable duplicate of wiki/concepts/${id(1)}.md (same title)`],
    ["warning", `wiki/concepts/${id(3)}.md`, "relative link to a .md: ../concepts/beta.md (use a root-relative link: /wiki/….md)"],
    ["error", `wiki/concepts/${id(4)}.md`, "missing description"],
    ["error", `wiki/concepts/${id(4)}.md`, "missing type"],
    ["info", `wiki/concepts/${id(4)}.md`, "never reviewed"],
    ["warning", `wiki/concepts/${id(4)}.md`, "orphan: no incoming link"],
    ["error", `wiki/concepts/${id(5)}.md`, `source not found: /raw/2026/11/${id(99)}/source.md`],
    ["error", `wiki/concepts/${id(5)}.md`, "source not found: undefined"],
    ["info", `wiki/concepts/${id(5)}.md`, "never reviewed"],
    ["warning", `wiki/concepts/${id(5)}.md`, "orphan: no incoming link"],
    // REL-16 rows: bad type, bad status, tags not a list, missing title (+ the usual orphan / never-reviewed noise of the new pages)
    ["error", `wiki/concepts/${id(6)}.md`, "unknown type: concept (expected: Source | Concept | Entity | Synthesis)"],
    ["info", `wiki/concepts/${id(6)}.md`, "never reviewed"],
    ["warning", `wiki/concepts/${id(6)}.md`, "orphan: no incoming link"],
    ["error", `wiki/concepts/${id(7)}.md`, "tags: list of texts expected"],
    ["error", `wiki/concepts/${id(7)}.md`, "unknown status: wip (expected: draft | stable | deprecated)"],
    ["info", `wiki/concepts/${id(7)}.md`, "never reviewed"],
    ["warning", `wiki/concepts/${id(7)}.md`, "orphan: no incoming link"],
    ["error", `wiki/concepts/${id(8)}.md`, "missing title"],
    ["info", `wiki/concepts/${id(8)}.md`, "never reviewed"],
    ["warning", `wiki/concepts/${id(8)}.md`, "orphan: no incoming link"],
    ["error", "wiki/concepts/invalide.md", "invalid YAML: YAML Parse error: Unexpected token"],
    ["info", "wiki/entities/a-la-main.md", "never reviewed"],
    ["warning", "wiki/entities/a-la-main.md", "name outside the page_path template \"{type}/{uuid}\" (pages are created with cortex new)"],
    ["warning", "wiki/entities/a-la-main.md", "orphan: no incoming link"],
    ["error", "wiki/log.jsonl:2", "invalid JSON"],
    ["error", "wiki/log.jsonl:3", "kind: add|ingest|query|lint|update"],
    ["warning", "wiki/log.md", "differs from its generation from wiki/log.jsonl (edited by hand?): cortex index regenerates it"],
    ["info", `wiki/sources/${id(1)}.md`, "never reviewed"],
    ["info", `wiki/sources/${id(2)}.md`, "never reviewed"],
    ["warning", `wiki/sources/${id(2)}.md`, `probable duplicate of wiki/sources/${id(1)}.md (same raw source /raw/2026/11/${id(1)}/source.md)`],
  ]);
});
