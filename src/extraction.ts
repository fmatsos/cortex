import { z } from "zod";
import { chunkSource, estimateTokens, renderChunk, type Chunk } from "./chunk";
import { fold, verifyFacts } from "./cite";
import type { Config } from "./config";
import { slugify } from "./lib";
import { LIMITS } from "./limits";
import { tagKey } from "./lint";
import { structured } from "./llm";
import type { Report } from "./print";
import { pipelinePrompt } from "./prompts";
import type { Candidate } from "./route";
import { DEFAULT_LANGUAGE } from "./schema";
import { collator } from "./text";

// --- Steps 1 and 2 of the pipeline (docs/PIPELINE.md §2.2, §2.3, §3): one extraction per chunk of the source, then the
// reduction: the verified subjects are merged by cortex, only the global summary and key points go through the model.

export type Fact = { claim: string; quote: string };
export type Subject = { kind: "Concept" | "Entity"; title: string; /** Number in the list of candidates the extraction saw, -1 for a new page. */ candidate: number; description: string; facts: Fact[] };
/** What describes the source as a whole (the Source page). */
export type Head = { summary: string; key_points: string[]; description: string; tags: string[] };
export type ChunkExtraction = Head & { subjects: Subject[] };
export type Extraction = ChunkExtraction;

// --- Schemas: the JSON Schema goes to the server (grammar), zod checks it again plus what the grammar cannot carry

const TAG = /^[a-z0-9][a-z0-9-]{1,30}$/;
const str = (maxLength: number, extra: object = {}) => ({ type: "string", maxLength, ...extra });
const headSchema = {
  summary: str(1200, { minLength: 200 }),
  key_points: { type: "array", minItems: 3, maxItems: 7, items: str(300) },
  description: str(160),
  tags: { type: "array", minItems: 1, maxItems: 4, items: str(31, { pattern: "^[a-z0-9][a-z0-9-]{1,30}$" }) },
};
const HEAD = ["summary", "key_points", "description", "tags"];
const object = (required: string[], properties: object) => ({ type: "object", additionalProperties: false, required, properties });

/** JSON Schema of `extract` (§2.2). */
export const extractSchema = object([...HEAD, "subjects"], {
  ...headSchema,
  subjects: {
    type: "array", maxItems: LIMITS.pipelineMaxSubjects,
    items: object(["kind", "title", "candidate", "description", "facts"], {
      kind: { enum: ["Concept", "Entity"] }, title: str(80), candidate: { type: "integer", minimum: -1 }, description: str(160),
      facts: { type: "array", minItems: 1, maxItems: 6, items: object(["claim", "quote"], { claim: str(300), quote: str(LIMITS.pipelineQuoteChars) }) },
    }),
  },
});

/** JSON Schema of `reduce` (§2.3): the head of the extraction only. */
export const reduceSchema = object(HEAD, headSchema);

// `summary` is not held to the grammar's 200 characters: a two-line source cannot honestly fill them, and an error here would fail the whole source
const nonEmpty = (max: number) => z.string().trim().min(1).max(max);
const headZod = {
  summary: nonEmpty(1200),
  key_points: z.array(nonEmpty(300)).min(3).max(7),
  description: nonEmpty(160),
  tags: z.array(z.string().regex(TAG)).min(1).max(4),
};
/** zod of `extract`; `candidates` = how many pages were offered: `candidate` is in [-1, candidates - 1]. */
export const extractZod = (candidates: number) => z.object({
  ...headZod,
  subjects: z.array(z.object({
    kind: z.enum(["Concept", "Entity"]), title: nonEmpty(80), candidate: z.number().int().min(-1).max(candidates - 1), description: nonEmpty(160),
    facts: z.array(z.object({ claim: nonEmpty(300), quote: nonEmpty(LIMITS.pipelineQuoteChars) })).min(1).max(6),
  })).max(LIMITS.pipelineMaxSubjects),
});
export const reduceZod = z.object(headZod);

// --- Calls

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const vars = (language?: string) => ({ language: language ?? DEFAULT_LANGUAGE });
const tagLine = (tags: string[]) => `Tags in use: ${tags.length ? tags.join(", ") : "none yet"}`;

export type CallOpts = { /** Tags in use (50 at most). */ tags: string[]; language?: string; /** Raw id of the source, for the metrics. */ id?: string; report?: Report };

/** Step 1 for one chunk. `candidates` are the pages offered to the model, numbered from 0; `of` = number of chunks of the source. */
export async function extractChunk(cfg: Config, o: CallOpts & { chunk: Chunk; of: number; title?: string; candidates: Candidate[] }): Promise<ChunkExtraction> {
  const pages = o.candidates.length
    ? o.candidates.map((c, i) => `${i}. ${c.title} (${c.type}): ${clip(c.description, 160)}`).join("\n")
    : "(none: `candidate` is always -1)";
  // what is shared by the chunks of a source comes first, so that the server's prompt cache keeps the prefix
  const user = `${tagLine(o.tags)}\n\nPages the source may be about (give their number as \`candidate\`, or -1 for a new page):\n${pages}\n\n`
    + `${o.title ? `Source title: ${o.title}\n` : ""}${o.of > 1 ? `Part ${o.chunk.index + 1} of ${o.of}\n` : ""}\nSource:\n${renderChunk(o.chunk)}`;
  return structured(cfg, { name: "extract", system: pipelinePrompt("extract", vars(o.language)), user, schema: extractSchema, zod: extractZod(o.candidates.length), maxTokens: 1500, source: o.id, report: o.report });
}

const REDUCE_TOKENS = 3000;

/** What the reduction reads: for each part its summary, tags and key points; cut down step by step if it exceeds 3k tokens. */
function reduceInput(parts: Head[], tags: string[]): string {
  const render = (kp: number, max: number) => parts.map((p, i) => `Part ${i + 1}\nSummary: ${clip(p.summary, max)}\nTags: ${p.tags.join(", ")}${kp ? `\nKey points:\n${p.key_points.slice(0, kp).map((k) => `- ${k}`).join("\n")}` : ""}`).join("\n\n");
  let text = "";
  for (const [kp, max] of [[7, 1200], [3, 1200], [3, 600], [0, Math.max(200, Math.floor(REDUCE_TOKENS * 4 / parts.length) - 100)]] as const) {
    text = render(kp, max);
    if (estimateTokens(text) <= REDUCE_TOKENS) break;
  }
  return `${tagLine(tags)}\n\nThe ${parts.length} successive parts of the source:\n\n${text}`;
}

/** Step 2, model part: the summary, key points, description and tags of the whole source, from those of its parts. */
export async function reduceHeads(cfg: Config, parts: Head[], o: CallOpts): Promise<Head> {
  return structured(cfg, { name: "reduce", system: pipelinePrompt("reduce", vars(o.language)), user: reduceInput(parts, o.tags), schema: reduceSchema, zod: reduceZod, maxTokens: 800, source: o.id, report: o.report });
}

// --- Deterministic part of the reduction (§3)

/** Tags normalised: a tag whose `tagKey` is one in use takes the spelling in use; duplicates removed; the most frequent first, then in order of appearance. */
export function mergeTags(lists: string[][], inUse: string[]): string[] {
  const use = new Map(inUse.map((t) => [tagKey(t), t] as const)), seen = new Map<string, { tag: string; n: number }>();
  for (const t of lists.flat()) {
    const k = tagKey(t), e = seen.get(k);
    if (e) e.n++; else seen.set(k, { tag: use.get(k) ?? t, n: 1 });
  }
  return [...seen.values()].sort((a, b) => b.n - a.n).map((e) => e.tag); // stable: ties stay in order of appearance
}

/** Head without the model (reduction failed): summaries joined and cut, key points taken in turn from each part, description of the first part. */
export function fallbackHead(parts: Head[], inUse: string[]): Head {
  const points: string[] = [];
  for (let i = 0; points.length < 7 && parts.some((p) => i < p.key_points.length); i++) for (const p of parts) if (p.key_points[i] && points.length < 7) points.push(p.key_points[i]!);
  return { summary: clip(parts.map((p) => p.summary).join(" "), 1200), key_points: points, description: parts[0]!.description, tags: mergeTags(parts.map((p) => p.tags), inUse) };
}

/**
 * Subjects of all the chunks as one list. Facts whose quote is not in the source are rejected (step 3); a subject left
 * without fact is skipped. Key = the candidate page if there is one, else the slug of the title; facts concatenated and
 * deduplicated on the folded claim, description of the first chunk, kind the majority one. Above `pipelineMaxSubjects`, the
 * subjects with the most verified facts stay. Sorted by title (collator), so that two runs write the same diff.
 */
export function mergeSubjects(source: string, parts: ChunkExtraction[]): { subjects: Subject[]; rejected: number; skipped: string[]; dropped: string[] } {
  const groups = new Map<string, Subject[]>();
  let rejected = 0;
  const skipped: string[] = [];
  for (const s of parts.flatMap((p) => p.subjects)) {
    const { kept, rejected: bad } = verifyFacts(source, s.facts);
    rejected += bad.length;
    if (!kept.length) { skipped.push(s.title); continue; }
    const key = s.candidate >= 0 ? `c${s.candidate}` : `t${slugify(s.title, Infinity)}`;
    groups.set(key, [...(groups.get(key) ?? []), { ...s, facts: kept }]);
  }
  const merged = [...groups.values()].map((g): Subject => {
    const seen = new Set<string>(), kinds = new Map<string, number>();
    for (const s of g) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
    const kind = [...kinds].reduce((best, k) => (k[1] > best[1] ? k : best))[0] as Subject["kind"]; // a tie keeps the first seen
    return { ...g[0]!, kind, facts: g.flatMap((s) => s.facts).filter((f) => { const k = fold(f.claim); return !seen.has(k) && seen.add(k); }) };
  });
  const byFacts = [...merged].sort((a, b) => b.facts.length - a.facts.length); // stable
  const keep = new Set(byFacts.slice(0, LIMITS.pipelineMaxSubjects));
  return {
    subjects: merged.filter((s) => keep.has(s)).sort((a, b) => collator.compare(a.title, b.title)),
    rejected, skipped, dropped: merged.filter((s) => !keep.has(s)).map((s) => s.title),
  };
}

/** Runs `fn` over `items`, at most `n` at a time; results in the order of `items`. */
export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(n, 1), items.length) }, async () => { for (let i; (i = next++) < items.length; ) out[i] = await fn(items[i]!, i); }));
  return out;
}

export type Extracted = {
  extraction: Extraction;
  /** Chunks the source was cut into. */
  chunks: number;
  /** Indexes of the chunks whose extraction failed: the result is partial. */
  failed: number[];
  /** Facts without a quote found in the source (rejected). */
  rejected: number;
  /** Titles of the subjects left without a verified fact. */
  skipped: string[];
  /** Titles of the subjects cut by `pipelineMaxSubjects`. */
  dropped: string[];
};

/**
 * Steps 1 and 2: the source is cut (`chunkSource`), one extraction per chunk (at most `parallel` in flight), the subjects are
 * merged and verified by cortex, and for a source in several chunks the model writes the global summary and key points. A
 * chunk that fails is left out (`failed`), a failed reduction falls back to `fallbackHead`; it throws only when no chunk gave an answer.
 */
export async function extractSource(cfg: Config, o: CallOpts & { source: string; title?: string; candidates: Candidate[]; parallel?: number; chunkTokens?: number; overlapTokens?: number }): Promise<Extracted> {
  const chunks = chunkSource(o.source, { chunkTokens: o.chunkTokens, overlapTokens: o.overlapTokens });
  const results = await pool<Chunk, { ok: ChunkExtraction } | { err: string }>(chunks, o.parallel ?? LIMITS.pipelineParallel, async (chunk) => {
    try { return { ok: await extractChunk(cfg, { ...o, chunk, of: chunks.length }) }; } catch (e) { return { err: (e as Error).message }; }
  });
  const parts = results.flatMap((r) => ("ok" in r ? [r.ok] : [] as ChunkExtraction[]));
  const failed = results.flatMap((r, i) => ("err" in r ? [i] : []));
  if (!parts.length) throw new Error(`extraction failed${chunks.length > 1 ? ` on all ${chunks.length} chunks` : ""}: ${(results[0] as { err: string }).err}`);
  for (const i of failed) o.report?.({ level: "warn", text: `extraction : morceau ${i + 1}/${chunks.length} sans résultat (${(results[i] as { err: string }).err}), extraction partielle`, mark: "  ⚠" });

  let head: Head = parts[0]!;
  if (parts.length > 1) {
    try { head = await reduceHeads(cfg, parts, o); } catch (e) {
      head = fallbackHead(parts, o.tags);
      o.report?.({ level: "warn", text: `réduction sans résultat (${(e as Error).message}) : résumé assemblé sans le modèle`, mark: "  ⚠" });
    }
  }
  const { subjects, rejected, skipped, dropped } = mergeSubjects(o.source, parts);
  return { extraction: { ...head, tags: mergeTags([head.tags], o.tags), subjects }, chunks: chunks.length, failed, rejected, skipped, dropped };
}
