import { LIMITS } from "./limits";

/** Rough token count (4 characters per token), enough to size prompts without a tokenizer. */
export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

/** One part of a long source: `text` is the exact slice `source.slice(start, end)`; `context` is the overlap taken from the part before. */
export type Chunk = { index: number; start: number; end: number; text: string; context: string };

type Block = { start: number; end: number; heading: boolean };

/** Blocks of a Markdown text: paragraphs (blank-line separated, fenced code kept whole), a heading line opening its own block with the lines that follow it. */
function blocks(text: string): Block[] {
  const out: Block[] = [];
  let cur: Block | undefined, fence = false, pos = 0;
  for (const line of text.split("\n")) {
    const end = pos + line.length, isFence = /^\s*(```|~~~)/.test(line);
    if (!fence && !line.trim()) cur = undefined;
    else {
      const heading = !fence && /^#{1,6}\s/.test(line);
      if (heading) cur = undefined;
      if (cur) cur.end = end; else out.push(cur = { start: pos, end, heading });
      if (isFence) fence = !fence;
    }
    pos = end + 1;
  }
  return out;
}

/** Splits one block bigger than `max` characters at sentence ends, else at spaces, pieces of at most `target` characters. */
function split(text: string, b: Block, target: number): Block[] {
  const out: Block[] = [];
  let start = b.start;
  while (b.end - start > target) {
    const win = text.slice(start, start + target);
    let cut = Math.max(win.lastIndexOf(". "), win.lastIndexOf("! "), win.lastIndexOf("? "), win.lastIndexOf(".\n")) + 1;
    if (cut < target / 3) cut = Math.max(win.lastIndexOf(" "), win.lastIndexOf("\n"));
    if (cut < 1) cut = target; // no space at all (a base64 blob…)
    out.push({ start, end: start + cut, heading: false });
    start += cut;
    while (start < b.end && /\s/.test(text[start]!)) start++;
  }
  if (start < b.end) out.push({ start, end: b.end, heading: false });
  return out;
}

/** The tail of `para` that fits `budget` characters, starting at a sentence boundary; empty when no whole sentence fits. */
function tail(para: string, budget: number): string {
  if (para.length <= budget) return para;
  const m = /(?<=[.!?…])\s+/g;
  for (let r; (r = m.exec(para)); ) if (para.length - (r.index + r[0].length) <= budget) return para.slice(r.index + r[0].length);
  return "";
}

/**
 * Cuts a source for the extraction. At most `chunkTokens` (6000, estimated) it stays whole. Above, the cuts fall at
 * Markdown headings, else between paragraphs, never inside a sentence (a paragraph above the maximum is cut at sentence
 * ends); a chunk targets `chunkTokens` and may reach 7/6 of it to absorb a short tail. Each chunk but the first carries
 * as `context` the last paragraph of the one before (at most `overlapTokens`). Pure: same source, same chunks.
 */
export function chunkSource(text: string, opts: { chunkTokens?: number; overlapTokens?: number } = {}): Chunk[] {
  const target = (opts.chunkTokens ?? LIMITS.pipelineChunkTokens) * 4, overlap = (opts.overlapTokens ?? LIMITS.pipelineChunkOverlap) * 4;
  if (text.length <= target) return [{ index: 0, start: 0, end: text.length, text, context: "" }];
  const max = Math.round(target * 7 / 6);
  const bs = blocks(text).flatMap((b) => (b.end - b.start > max ? split(text, b, target) : [b]));
  const out: Chunk[] = [];
  for (let i = 0; i < bs.length; ) {
    let j = i; // last block that still fits the target (at least one)
    while (j + 1 < bs.length && bs[j + 1]!.end - bs[i]!.start <= target) j++;
    let k = j + 1; // chunk = blocks i..k-1
    if (k < bs.length && bs[bs.length - 1]!.end - bs[i]!.start <= max) k = bs.length;
    else if (k < bs.length) {
      for (let h = j + 1; h > i; h--) if (bs[h]!.heading && bs[h - 1]!.end - bs[i]!.start >= target / 2) { k = h; break; }
    }
    const start = bs[i]!.start, end = bs[k - 1]!.end, prev = out.at(-1);
    const last = prev && text.slice(bs[i - 1]!.start, bs[i - 1]!.end);
    out.push({ index: out.length, start, end, text: text.slice(start, end), context: last ? tail(last, overlap) : "" });
    i = k;
  }
  return out;
}

/** What the model reads for a chunk: the overlap, marked, then the chunk's own text. */
export const renderChunk = (c: Chunk) => (c.context ? `(context)\n${c.context}\n(/context)\n\n${c.text}` : c.text);
