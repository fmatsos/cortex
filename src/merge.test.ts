import { expect, test } from "bun:test";
import { parseDoc } from "./lib";
import { mergeUpdate, sourceId, type Cited } from "./merge";

const P = "wiki/concepts/a.md";
const page = (body: string, fm = "") => `---\ntype: Concept\ntitle: Context rot\nstatus: draft\ntags: [llm]\nsources:\n  - id: chroma\n    resource: /raw/chroma/source.md\n    title: Chroma\n${fm}---\n${body}`;
const body0 = `Opening paragraph about the rot.[^chroma]

## Causes

Attention is diluted.[^chroma] Long contexts are noisy.[^chroma]

## Effects

Quality drops.[^chroma]

[^chroma]: Chroma, /raw/chroma/source.md
`;
const src: Cited = { id: "lab-note", title: "Lab note", resource: "/raw/lab/source.md" };
const up = (o: Partial<{ section: string; addition: string; contradiction: string | null }> = {}) => ({ section: "Effects", addition: "A second effect appears at 50k tokens.[^lab-note]", contradiction: null, ...o });
const merge = (text: string, u = up(), s = src) => mergeUpdate(P, text, u, s);

test("an addition goes at the end of the named section; sources[] and the note definition follow", () => {
  const r = merge(page(body0))!;
  const d = parseDoc(P, r.text);
  expect(d.body).toContain("Quality drops.[^chroma]\n\nA second effect appears at 50k tokens.[^lab-note]\n\n[^chroma]: Chroma, /raw/chroma/source.md\n[^lab-note]: Lab note, /raw/lab/source.md\n");
  expect(d.fm.sources).toEqual([{ id: "chroma", resource: "/raw/chroma/source.md", title: "Chroma" }, { id: "lab-note", resource: "/raw/lab/source.md", title: "Lab note" }]);
  expect(d.body.indexOf("## Causes")).toBeLessThan(d.body.indexOf("A second effect")); // the other sections are untouched
  expect(d.fm).toMatchObject({ title: "Context rot", tags: ["llm"], status: "draft" });
  expect(r.contradiction).toBe(false);
});

test("the section is found folded, as a near title, with its # or accents; an unknown one is a new section before the definitions; an empty one is the last", () => {
  expect(merge(page(body0), up({ section: "## EFFECTS " }))!.text).toContain("Quality drops.[^chroma]\n\nA second effect");
  const near = page(body0.replace("## Causes", "## Causes of the rot"));
  expect(merge(near, up({ section: "the causes of rot" }))!.text).toContain("Long contexts are noisy.[^chroma]\n\nA second effect");
  const created = parseDoc(P, merge(page(body0), up({ section: "Mitigation" }))!.text).body;
  expect(created).toContain("Quality drops.[^chroma]\n\n## Mitigation\n\nA second effect appears at 50k tokens.[^lab-note]\n\n[^chroma]:");
  expect(merge(page(body0), up({ section: "" }))!.text).toContain("Quality drops.[^chroma]\n\nA second effect");
  // a one-word heading has no near title: only the fold matches
  expect(parseDoc(P, merge(page(body0), up({ section: "Effect" }))!.text).body).toContain("## Effect\n");
});

test("a page without any ## takes the addition in its preamble, before the definitions", () => {
  const flat = page("Just a paragraph.[^chroma]\n\n[^chroma]: Chroma, /raw/chroma/source.md\n");
  const r = merge(flat, up({ section: "Whatever" }))!;
  expect(parseDoc(P, r.text).body).toContain("## Whatever"); // a named section is created…
  const empty = merge(flat, up({ section: "" }))!;
  expect(parseDoc(P, empty.text).body).toBe("Just a paragraph.[^chroma]\n\nA second effect appears at 50k tokens.[^lab-note]\n\n[^chroma]: Chroma, /raw/chroma/source.md\n[^lab-note]: Lab note, /raw/lab/source.md\n"); // …an empty one goes in section 0
});

test("a page with an empty body takes the addition and its definition", () => {
  const r = merge(page(""), up({ section: "" }))!;
  expect(parseDoc(P, r.text).body).toBe("A second effect appears at 50k tokens.[^lab-note]\n\n[^lab-note]: Lab note, /raw/lab/source.md\n");
});

test("known sentences are dropped: identical (notes, case, punctuation aside) and near; a paragraph left empty disappears", () => {
  const add = "quality DROPS!\n\nAttention is diluted over long contexts.[^lab-note] Long contexts are noisy.[^lab-note]\n\nA new figure: 12 % of the tokens are lost.[^lab-note]";
  const r = merge(page(body0), up({ addition: add }))!;
  const b = parseDoc(P, r.text).body;
  expect(b).toContain("Quality drops.[^chroma]\n\nAttention is diluted over long contexts.[^lab-note]\n\nA new figure: 12 % of the tokens are lost.[^lab-note]\n\n[^chroma]"); // « diluted over long contexts » is not near enough to be dropped
  expect(b).not.toContain("quality DROPS");
  expect(b).not.toContain("noisy.[^lab-note]");
  expect(r.dropped).toBe(2);
  // near: more than 0.8 in word trigrams
  const long = "The model keeps reading the whole context window again and again on every single step of the loop.[^chroma]";
  const near = merge(page(`${long}\n\n[^chroma]: C\n`), up({ section: "", addition: "The model keeps reading the whole context window again and again on every single step of the loop today.[^lab-note]" }));
  expect(near).toBeUndefined();
});

test("repeated sentences inside the addition itself are kept once; sentences do not split on 3.5 or e.g.", () => {
  const r = merge(page(body0), up({ addition: "Qwen3.5 is a 4B model.[^lab-note] Qwen3.5 is a 4B model.[^lab-note] It works e.g. on a laptop.[^lab-note]" }))!;
  expect(r.text.match(/Qwen3\.5 is a 4B model/g)).toHaveLength(1);
  expect(r.text).toContain("It works e.g. on a laptop.[^lab-note]");
});

test("nothing new: undefined, no write, no sources[] entry; replayed, the same merge is a no-op (no second entry, no -2)", () => {
  const dup = up({ addition: "Quality drops.[^lab-note] Attention is diluted.[^lab-note]" });
  expect(merge(page(body0), dup)).toBeUndefined();
  const once = merge(page(body0))!.text;
  expect(merge(once)).toBeUndefined();
  expect(sourceId(P, once, src)).toBe("lab-note"); // the entry of this resource is reused…
  expect(sourceId(P, page(body0), { title: "Chroma", resource: "/raw/other/source.md" })).toBe("chroma-2"); // …a title already taken gets -2
  expect(sourceId(P, page(body0), src)).toBe("lab-note");
});

test("the model's own note ids are pointed at the given id; its definitions and # headings are not kept as such", () => {
  const r = merge(page(body0), up({ addition: "## Heading\nA fact.[^whatever] Another fact.[^x2]\n\n[^whatever]: made up" }))!;
  const b = parseDoc(P, r.text).body;
  expect(b).toContain("### Heading\nA fact.[^lab-note] Another fact.[^lab-note]");
  expect(b).not.toContain("[^whatever]");
  expect(b).not.toContain("made up");
  expect(b).not.toContain("\n## Heading");
});

test("a contradiction is a callout at the head of the section with the note; the page goes back to draft; replayed, it is not added twice", () => {
  const stable = page(body0).replace("status: draft", "status: stable");
  const r = merge(stable, up({ contradiction: "The lab measured the opposite at 50k tokens." }))!;
  expect(r.contradiction).toBe(true);
  const d = parseDoc(P, r.text);
  expect(d.fm.status).toBe("draft");
  expect(d.body).toContain("## Effects\n\n> [!warning] Contradiction\n> The lab measured the opposite at 50k tokens. [^lab-note]\n\nQuality drops.[^chroma]\n\nA second effect");
  expect(merge(r.text, up({ contradiction: "The lab measured the opposite at 50k tokens." }))).toBeUndefined();
  // a note the model wrote is kept as the given one, not doubled
  expect(merge(page(body0), up({ contradiction: "Opposite.[^zz]" }))!.text).toContain("> Opposite.[^lab-note]\n");
});

test("a contradiction counts as an addition even when every sentence next to it is known", () => {
  const r = merge(page(body0), up({ addition: "Quality drops.[^lab-note]", contradiction: "It does not drop before 50k tokens." }))!;
  expect(r.contradiction).toBe(true);
  expect(parseDoc(P, r.text).body).toContain("> [!warning] Contradiction\n> It does not drop before 50k tokens. [^lab-note]");
  expect(r.dropped).toBe(1);
});

test("a contradiction in the preamble (section 0) goes first", () => {
  const flat = page("Just a paragraph.[^chroma]\n\n[^chroma]: Chroma, /raw/chroma/source.md\n");
  const r = merge(flat, up({ section: "", addition: "Known? No, new.[^lab-note]", contradiction: "Not so." }))!;
  expect(parseDoc(P, r.text).body.startsWith("> [!warning] Contradiction\n> Not so. [^lab-note]\n\nJust a paragraph.")).toBe(true);
});

test("a page shaped like weave's output (links after the definitions): definitions stay together at the end, the addition goes before the links", () => {
  const woven = page(`${body0}\n- [Chroma report](/wiki/sources/chroma.md)\n`);
  const r = merge(woven)!;
  const b = parseDoc(P, r.text).body;
  expect(b).toBe(`Opening paragraph about the rot.[^chroma]

## Causes

Attention is diluted.[^chroma] Long contexts are noisy.[^chroma]

## Effects

Quality drops.[^chroma]

A second effect appears at 50k tokens.[^lab-note]

- [Chroma report](/wiki/sources/chroma.md)

[^chroma]: Chroma, /raw/chroma/source.md
[^lab-note]: Lab note, /raw/lab/source.md
`);
  expect(merge(r.text)).toBeUndefined();
});

test("frontmatter lines other than sources and status stay byte for byte; a source without resource or title is stored as given", () => {
  const text = page(body0, "# a comment\nextra:   [1,   2]\n");
  const r = merge(text, up(), { id: "bare", title: "" })!;
  expect(r.text.startsWith("---\ntype: Concept\ntitle: Context rot\nstatus: draft\ntags: [llm]\nsources:\n")).toBe(true);
  expect(r.text).toContain("# a comment\nextra:   [1,   2]\n---\n");
  expect(parseDoc(P, r.text).fm.sources).toEqual([{ id: "chroma", resource: "/raw/chroma/source.md", title: "Chroma" }, { id: "bare" }]);
});

test("a page that cannot hold sources[] (no frontmatter) throws instead of citing a source it does not list", () => {
  expect(() => merge("Just text.\n")).toThrow("no frontmatter");
});
