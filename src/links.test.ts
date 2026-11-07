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
  expect((await writeLinks(root, found, new Date("2026-11-06T10:00:00+01:00"))).length).toBe(1);
  const after = await Bun.file(join(root, "wiki/sources/a.md")).text();
  const at = (await import("./lib")).localIso(new Date("2026-11-06T10:00:00+01:00"));
  expect(after).toBe(text.replace("tags: [agents]\n", `tags: [agents]\ngenerated: { by: "cortex-links", at: ${at} }\n`).replace("**Codex**", `**[Codex](/${t.path})**`));
  expect(await writeLinks(root, found)).toEqual([]); // already written: the mention is no longer there as is
  expect(await Bun.file(join(root, "wiki/sources/a.md")).text()).toBe(after); // nothing written: no new stamp
  // a page of `keep` (just written by a compile) gets its links but keeps the compile's stamp
  const mine = "---\ntype: Source\ntitle: B\ntags: [agents]\ngenerated: { by: codex/luna, at: 2026-11-06T09:00:00+01:00 }\n---\nAvec Codex.\n";
  await Bun.write(join(root, "wiki/sources/b.md"), mine);
  const b = { ...parseDoc("wiki/sources/b.md", mine), issues: [] } as unknown as Page;
  expect((await writeLinks(root, suggestLinks([t, b]), new Date(), new Set([b.path]))).length).toBe(1);
  expect(await Bun.file(join(root, b.path)).text()).toBe(mine.replace("Avec Codex.", `Avec [Codex](/${t.path}).`));
});

test("writeLinks: a reviewed page that was up to date stays reviewed; one already waiting for a review still waits", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { parseDoc } = await import("./lib");
  const { writeLinks } = await import("./links");
  const { pageState } = await import("./doc");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  const t = page("Entity", "Codex", "L'agent d'OpenAI.", { tags: ["agents"] });
  const fm = (gen: string, ver: string) => `---\ntype: Source\ntitle: A\ntags: [agents]\ngenerated: { by: model, at: ${gen} }\nverified: { by: "human:franck", at: ${ver} }\n---\nAvec Codex.\n`;
  const state = async (name: string, text: string) => {
    await Bun.write(join(root, `wiki/sources/${name}.md`), text);
    const p = { ...parseDoc(`wiki/sources/${name}.md`, text), issues: [] } as unknown as Page;
    await writeLinks(root, suggestLinks([t, p]), new Date("2026-11-06T10:00:00+01:00"));
    const out = parseDoc(p.path, await Bun.file(join(root, p.path)).text());
    return { review: pageState(out.fm as never).needsReview, by: (out.fm.verified as { by: string }).by, linked: out.body.includes("[Codex](") };
  };
  expect(await state("ok", fm("2026-11-01T10:00:00+01:00", "2026-11-02T10:00:00+01:00"))).toEqual({ review: false, by: "human:franck", linked: true });
  expect(await state("todo", fm("2026-11-03T10:00:00+01:00", "2026-11-02T10:00:00+01:00"))).toEqual({ review: true, by: "human:franck", linked: true });
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

test("links: on a large wiki the spread cap is absolute (50 pages), on a small one still 30 %", () => {
  const t = page("Concept", "Contexte", "x");
  const mentions = (n: number) => Array.from({ length: n }, (_, i) => page("Source", `U${i}`, i < n / 4 ? `le contexte ${link(t)}` : "le contexte"));
  const filler = (n: number) => Array.from({ length: n }, (_, i) => page("Source", `F${i}`, "rien"));
  const big = [t, ...filler(400), ...mentions(60)]; // 60 of 461 pages = 13 %, linked on 15 of them: kept by the 30 % rule alone
  expect(pairs(big)).toEqual([]);
  expect(pairs([t, ...filler(150), ...mentions(48)])).toHaveLength(36); // under both: 48 mentions, 12 links (25 %)
});

test("links: scoped to a compile = the whole-wiki run restricted to its pages and its new targets", () => {
  const scoped = (pages: Page[], mine: Page[], created: Page[]) =>
    suggestLinks(pages, undefined, { pages: new Set(mine.map((p) => p.path)), targets: new Set(created.map((p) => p.path)) });
  const whole = (pages: Page[], mine: Page[], created: Page[]) => {
    const [m, c] = [new Set(mine.map((p) => p.path)), new Set(created.map((p) => p.path))];
    return suggestLinks(pages).filter((s) => m.has(s.path) || c.has(s.target));
  };
  const inf = page("Concept", "Inférence locale", "Faire tourner un modèle chez soi.");
  const codex = page("Entity", "Codex", "L'agent d'OpenAI.", { aliases: ["Codex CLI"] });
  const qwen = page("Entity", "Qwen3", "La famille.");
  const qwen4 = page("Entity", "Qwen3 4B", "Le petit modèle."); // created by the compile; « Qwen3 » is inside its name
  const touched = page("Source", "T", "Avec l'inférence locale, Codex CLI et Qwen3 4B ; et Qwen3 seul ; Codex aussi.");
  const others = [
    page("Source", "B", "On teste Qwen3 4B en local."), page("Source", "C", "Qwen3 4B encore, et Qwen3."), // a longer name wins over « Qwen3 »
    page("Source", "D", `Qwen3 4B ${link(qwen4)} déjà lié.`), page("Source", "E", "Qwen3 sans le reste ; Codex en passant."),
    page("Source", "F", `Voir ${link(qwen)} : Qwen3.`), page("Source", "G", "Inférence locale, ici aussi."),
  ];
  const filler = Array.from({ length: 12 }, (_, i) => page("Source", `F${i}`, i % 4 ? "autre chose" : "codex partout"));
  const pages = [inf, codex, qwen, qwen4, touched, ...others, ...filler];
  const got = scoped(pages, [touched], [qwen4]);
  expect(got.length).toBeGreaterThan(2);
  expect(got).toEqual(whole(pages, [touched], [qwen4]));
  expect(got.some((s) => s.path === others[0].path && s.target === qwen4.path)).toBe(true); // elsewhere in the wiki, for the new page
  expect(got.some((s) => s.path === others[3].path && s.target === qwen.path)).toBe(false); // not scoped: neither the page nor the target
  // the other way round: the new page is the short name, « Qwen3 4B » (not scoped) must still win where both could match
  const short = scoped(pages, [], [qwen]);
  expect(short).toEqual(whole(pages, [], [qwen]));
  expect(short.map((s) => s.from)).toEqual(["T", "C", "E"]); // never « Qwen3 » inside « Qwen3 4B » (B)
  expect(scoped(pages, [], [])).toEqual([]);
  expect(scoped(pages, [others[1]], [])).toEqual(whole(pages, [others[1]], []));
});
