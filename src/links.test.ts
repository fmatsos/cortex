import { expect, test } from "bun:test";
import type { Page } from "./doc";
import { prose, suggestLinks, type Similarity } from "./links";

let n = 0;
const page = (type: string, title: string, body: string, fm: Record<string, unknown> = {}): Page =>
  ({ path: `wiki/${type.toLowerCase()}s/p${++n}.md`, fm: { type, title, tags: ["ia"], ...fm }, body, issues: [] }) as unknown as Page;
const link = (p: Page) => `[x](/${p.path})`;
const pairs = (pages: Page[], sim?: Similarity) => suggestLinks(pages, sim).map((s) => `${s.path}→${s.target}`);

test("prose: code, quotes, headings, footnotes and existing links are not prose", () => {
  expect(prose("a `pyenv` b\n```\npyenv\n```\n> pyenv\n## pyenv\n[pyenv](/wiki/x.md) c[^1]\n[^1]: pyenv").match(/pyenv/g)).toBeNull();
});

test("links: a mention in prose is suggested once, with its reasons; an existing link or a self-mention is not", () => {
  const t = page("Concept", "Inférence locale", "Faire tourner un modèle chez soi.");
  const a = page("Source", "A", "On parle d'inference LOCALE ici, et encore d'inférence locale.");
  const b = page("Source", "B", `Déjà lié : ${link(t)} inférence locale.`);
  const r = suggestLinks([t, a, b]);
  expect(r.map((s) => [s.path, s.target, s.term])).toEqual([[a.path, t.path, "inference LOCALE"]]); // accents and case folded, first mention as written
  expect(r[0].reasons).toEqual(["mentions « inference LOCALE »", "few mentions yet (2)", "shared tag ia"]);
});

test("writeLinks: the first mention becomes the link, text as written; code and frontmatter untouched; a moved mention is skipped", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { parseDoc } = await import("./lib");
  const { writeLinks } = await import("./links");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  const t = page("Entity", "Codex", "L'agent d'OpenAI.", { tags: ["agents"] });
  const text = "---\ntype: Source\ntitle: A\ntags: [agents]\n---\n`codex exec` puis **Codex** et encore Codex.\n";
  await Bun.write(join(root, "wiki/sources/a.md"), text);
  const a = { ...parseDoc("wiki/sources/a.md", text), issues: [] } as unknown as Page;
  const found = suggestLinks([t, a]);
  expect(found.map((s) => s.term)).toEqual(["Codex"]);
  expect((await writeLinks(root, found)).length).toBe(1);
  expect(await Bun.file(join(root, "wiki/sources/a.md")).text()).toBe(text.replace("**Codex**", `**[Codex](/${t.path})**`));
  expect(await writeLinks(root, found)).toEqual([]); // already written: the mention is no longer there as is
});

test("links: short names only in their exact case; ambiguous names never; aliases count", () => {
  const llm = page("Concept", "LLM", "Grand modèle de langage.");
  const m1 = page("Entity", "Mercure", "La planète."), m2 = page("Concept", "Mercure", "Le dieu.");
  const py = page("Entity", "Python", "Le langage.", { aliases: ["CPython"] });
  const a = page("Source", "A", "un llm local ; Mercure brille ; CPython est lent");
  const b = page("Source", "B", "un LLM local");
  expect(pairs([llm, m1, m2, py, a, b])).toEqual([`${a.path}→${py.path}`, `${b.path}→${llm.path}`]);
});

test("links: a name mentioned on most pages is a common word", () => {
  const common = page("Concept", "Modèle", "x");
  const many = Array.from({ length: 6 }, (_, i) => page("Source", `S${i}`, i < 4 ? "un modèle" : "rien"));
  expect(pairs([common, ...many])).toEqual([]); // 4 of 7 pages > 30 %
});

test("links: keyphraseness below the threshold drops the suggestion", () => {
  const rare = page("Concept", "Contexte", "x");
  const filler = Array.from({ length: 30 }, (_, i) => page("Source", `F${i}`, "rien"));
  const users = Array.from({ length: 6 }, (_, i) => page("Source", `U${i}`, i === 0 ? `le contexte ${link(rare)}` : "le contexte"));
  expect(pairs([rare, ...filler, ...users])).toEqual([]); // 1 of 6 = 0.17 < 0.2
});

test("links: without a shared tag or source, the similarity decides — and it is pluggable", () => {
  const t = page("Concept", "Fermentation", "x", { tags: ["cuisine"] });
  const a = page("Source", "A", "la fermentation", { tags: ["autre"] });
  expect(pairs([t, a])).toEqual([]); // tf-idf of two tiny unrelated pages: 0
  const always: Similarity = { name: "test", prepare: () => () => 0.9 };
  expect(suggestLinks([t, a], always)[0].reasons).toContain("test 0.90");
});
