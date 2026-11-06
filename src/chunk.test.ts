import { expect, test } from "bun:test";
import { chunkSource, estimateTokens, renderChunk } from "./chunk";

const opts = { chunkTokens: 100, overlapTokens: 20 }; // 400 characters per chunk, 80 of overlap
const para = (n: number, w = "mot") => `Phrase ${n} sur ${w}. ` + "Elle continue avec des mots simples. ".repeat(3).trim();
const text = (n: number, head = false) => Array.from({ length: n }, (_, i) => (head && i % 2 === 0 ? `## Partie ${i / 2}\n\n` : "") + para(i)).join("\n\n");

test("a source under the threshold stays whole", () => {
  const s = text(3);
  expect(chunkSource(s, opts)).toEqual([{ index: 0, start: 0, end: s.length, text: s, context: "" }]);
  expect(chunkSource("", opts)).toHaveLength(1);
  expect(estimateTokens("a".repeat(401))).toBe(101);
});

test("above the threshold: chunks are exact slices, in order, covering every paragraph", () => {
  const s = text(30), cs = chunkSource(s, opts);
  expect(cs.length).toBeGreaterThan(3);
  cs.forEach((c, i) => {
    expect(c.index).toBe(i);
    expect(s.slice(c.start, c.end)).toBe(c.text);
    expect(c.text.length).toBeLessThanOrEqual(Math.round(400 * 7 / 6));
    if (i) expect(c.start).toBeGreaterThan(cs[i - 1]!.end - 1);
  });
  for (let i = 0; i < 30; i++) expect(cs.some((c) => c.text.includes(para(i)))).toBe(true);
  // never inside a paragraph: each chunk starts at the start of a paragraph and ends at its end
  for (const c of cs) { expect(c.text.startsWith("Phrase")).toBe(true); expect(c.text.endsWith("simples.")).toBe(true); }
});

test("cuts prefer Markdown headings", () => {
  const s = text(24, true), cs = chunkSource(s, opts);
  expect(cs.length).toBeGreaterThan(2);
  // all but the first chunk start at a heading (a section is two paragraphs, ~270 characters)
  for (const c of cs.slice(1)) expect(c.text.startsWith("## Partie")).toBe(true);
});

test("overlap: the last paragraph of the previous chunk, marked (context)", () => {
  const s = text(30), cs = chunkSource(s, { chunkTokens: 100, overlapTokens: 100 });
  expect(cs[0]!.context).toBe("");
  for (let i = 1; i < cs.length; i++) {
    const prev = cs[i - 1]!.text, lastPara = prev.slice(prev.lastIndexOf("\n\n") + 2);
    expect(cs[i]!.context).toBe(lastPara);
  }
  expect(renderChunk(cs[1]!)).toBe(`(context)\n${cs[1]!.context}\n(/context)\n\n${cs[1]!.text}`);
  expect(renderChunk(cs[0]!)).toBe(cs[0]!.text);
});

test("overlap is bounded by its token budget, and cut at a sentence", () => {
  const long = "Une première phrase assez longue pour peser. ".repeat(20).trim(); // ~900 characters, one paragraph
  const s = `${long}\n\n${"Autre paragraphe sans fin. ".repeat(30).trim()}`;
  const cs = chunkSource(s, { chunkTokens: 250, overlapTokens: 20 });
  expect(cs.length).toBeGreaterThan(1);
  for (const c of cs) { expect(c.context.length).toBeLessThanOrEqual(80); if (c.context) expect(/[.!?]$/.test(c.context)).toBe(true); }
});

test("deterministic: same source, same chunks", () => {
  const s = text(40, true);
  expect(chunkSource(s, opts)).toEqual(chunkSource(s, opts));
});

test("a source without any title or blank line is cut at sentence ends", () => {
  const s = "Une phrase de test. ".repeat(100).trim(), cs = chunkSource(s, opts);
  expect(cs.length).toBeGreaterThan(3);
  for (const c of cs) { expect(c.text.length).toBeLessThanOrEqual(400); expect(c.text.endsWith("test.")).toBe(true); expect(c.text.startsWith("Une phrase")).toBe(true); }
});

test("a text without any space is cut hard rather than looping", () => {
  const cs = chunkSource("x".repeat(1500), opts);
  expect(cs.map((c) => c.text).join("")).toBe("x".repeat(1500));
});

test("fenced code is never cut at its blank lines nor taken for headings", () => {
  const code = "```\n# not a title\n\nline\n\nmore\n```";
  const s = `${text(8)}\n\n${code}\n\n${text(8)}`;
  const cs = chunkSource(s, opts);
  expect(cs.filter((c) => c.text.includes("line")).every((c) => c.text.includes(code))).toBe(true);
});

test("a short tail is absorbed in the last chunk up to the maximum", () => {
  const p = `${"mot ".repeat(50).trim()}.`; // 200 characters
  expect(chunkSource(`${p}\n\n${p}\n\n${p}`.slice(0, 430), opts)).toHaveLength(1); // 430 > 400 but under 7/6 of it
  expect(chunkSource(`${p}\n\n${p}\n\n${p}`, opts)).toHaveLength(2); // 604: cut between paragraphs
});
