import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunkSource, estimateTokens } from "./chunk";
import { extractSchema, extractSource, fallbackHead, mergeSubjects, mergeTags, pool, reduceHeads, reduceSchema, type ChunkExtraction } from "./extraction";
import type { Message } from "./print";
import type { Candidate } from "./route";

const head = (n = 1) => ({ summary: `Summary ${n}`, key_points: ["p1", "p2", "p3"].map((p) => `${p} of ${n}`), description: `Description ${n}`, tags: ["ml"] });
const subject = (title: string, quote: string, extra: object = {}) => ({ kind: "Concept", title, candidate: -1, description: `About ${title}`, facts: [{ claim: `${title} claim`, quote }], ...extra });
const reply = (o: object) => Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(o) } }] });

/** Fake server: `handle(body)` answers every request; `seen` keeps the parsed bodies, `peak` the most requests in flight. */
async function serve(handle: (b: any) => Response | Promise<Response>) {
  const seen: any[] = [];
  let live = 0, peak = 0;
  const server = Bun.serve({ port: 0, async fetch(req) {
    const b = await req.json();
    seen.push(b); peak = Math.max(peak, ++live);
    try { return await handle(b); } finally { live--; }
  } });
  return { seen, peak: () => peak, cfg: { model: "m", base_url: `http://127.0.0.1:${server.port}/v1` }, stop: () => server.stop(true) };
}
const named = (b: any) => b.response_format.json_schema.name as string;
const cand = (title: string): Candidate => ({ path: `wiki/concepts/${title}.md`, title, type: "Concept", description: `${title} page` });

const SHORT = "Caching keeps recent results close. A cache evicts the least recently used entry first. Redis is an in-memory store.";

test("extract: one call for a short source, with the instructions, tags and numbered candidates; unverified facts are rejected", async () => {
  const s = await serve(() => reply({
    ...head(), tags: ["models", "new-tag"],
    subjects: [
      subject("Caching", "Caching keeps recent results close.", { candidate: 0 }),
      subject("Redis", "Redis is an in-memory store.", { kind: "Entity" }),
      subject("Invented", "Nothing of the sort is written here."),
    ],
  }));
  try {
    const messages: Message[] = [];
    const r = await extractSource(s.cfg, { source: SHORT, title: "Caches", tags: ["model", "ai"], candidates: [cand("Cache page")], language: "French", report: (m) => messages.push(m) });
    expect(s.seen).toHaveLength(1);
    const b = s.seen[0];
    expect(named(b)).toBe("extract");
    expect(b.response_format.json_schema.schema).toEqual(extractSchema);
    expect(b.messages[0].content).toContain("Write in French");
    expect(b.messages[0].content).toContain("Never use the double-quote character inside a string value");
    expect(b.messages[0].content).not.toContain("{{");
    expect(b.messages[1].content).toContain("Tags in use: model, ai");
    expect(b.messages[1].content).toContain("0. Cache page (Concept): Cache page page");
    expect(b.messages[1].content).toContain("Source title: Caches");
    expect(b.messages[1].content).not.toContain("Part 1");
    expect(b.messages[1].content.endsWith(SHORT)).toBe(true);
    expect(r).toMatchObject({ chunks: 1, failed: [], rejected: 1, skipped: ["Invented"], dropped: [] });
    expect(r.extraction.subjects.map((x) => [x.title, x.candidate, x.kind])).toEqual([["Caching", 0, "Concept"], ["Redis", -1, "Entity"]]);
    expect(r.extraction.tags).toEqual(["model", "new-tag"]); // `models` takes the spelling in use
    expect(r.extraction.summary).toBe("Summary 1");
    expect(messages).toEqual([]);
  } finally { s.stop(); }
});

test("extract: a candidate out of the list is an error sent back to the model, which answers again", async () => {
  let n = 0;
  const s = await serve(() => reply({ ...head(), subjects: [subject("Caching", "Caching keeps recent results close.", { candidate: n++ ? 0 : 5 })] }));
  try {
    const r = await extractSource(s.cfg, { source: SHORT, tags: [], candidates: [cand("Cache page")] });
    expect(s.seen).toHaveLength(2);
    expect(s.seen[1].messages.at(-1).content).toContain("subjects.0.candidate");
    expect(r.extraction.subjects[0]!.candidate).toBe(0);
  } finally { s.stop(); }
});

test("extract: without candidates the prompt says so and `candidate` must be -1", async () => {
  const s = await serve(() => reply({ ...head(), subjects: [] }));
  try {
    await extractSource(s.cfg, { source: SHORT, tags: [], candidates: [] });
    expect(s.seen[0].messages[1].content).toContain("Tags in use: none yet");
    expect(s.seen[0].messages[1].content).toContain("(none: `candidate` is always -1)");
  } finally { s.stop(); }
});

// A long source: three sections, each with one sentence to quote
const PART = (n: number) => `Sentence number ${n} says something precise about topic ${n}.`;
const LONG = [1, 2, 3].map((n) => `# Section ${n}\n\n${PART(n)} ${`Filler words for section ${n}. `.repeat(14)}`).join("\n\n");
const OPTS = { chunkTokens: 120, overlapTokens: 20 };

test("map-reduce: one extract per chunk (at most `parallel` in flight, whatever the order of the answers), subjects merged, head from the reduce call", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "cortex-extraction-")), "m.jsonl");
  process.env.CORTEX_METRICS = file;
  const chunks = chunkSource(LONG, OPTS);
  expect(chunks.length).toBe(3);
  const s = await serve(async (b) => {
    if (named(b) === "reduce") return reply({ summary: "Global summary", key_points: ["g1", "g2", "g3"], description: "Global description", tags: ["ai", "ml"] });
    const i = Number(/Part (\d+) of 3/.exec(b.messages[1].content)![1]) - 1;
    await Bun.sleep((3 - i) * 20); // the first chunk answers last
    return reply({
      ...head(i + 1), tags: i === 2 ? ["ml", "ai"] : ["ml"],
      subjects: [
        subject(["Caching", "Cache layer", "Caching"][i]!, PART(i + 1), { candidate: 0, kind: ["Concept", "Entity", "Concept"][i], facts: [{ claim: ["Cache is fast.", "cache is FAST", "Cache expires."][i]!, quote: PART(i + 1) }] }),
        ...(i === 1 ? [subject("Zed", PART(2))] : []),
      ],
    });
  });
  try {
    const r = await extractSource(s.cfg, { source: LONG, title: "Long", tags: ["ai"], candidates: [cand("Caching")], parallel: 2, ...OPTS });
    expect(s.seen.map(named).sort()).toEqual(["extract", "extract", "extract", "reduce"]);
    expect(s.peak()).toBeLessThanOrEqual(2);
    expect(r.chunks).toBe(3);
    expect(r.extraction).toMatchObject({ summary: "Global summary", key_points: ["g1", "g2", "g3"], description: "Global description", tags: ["ai", "ml"] });
    expect(r.extraction.subjects).toEqual([
      { kind: "Concept", title: "Caching", candidate: 0, description: "About Caching", facts: [{ claim: "Cache is fast.", quote: PART(1) }, { claim: "Cache expires.", quote: PART(3) }] },
      { kind: "Concept", title: "Zed", candidate: -1, description: "About Zed", facts: [{ claim: "Zed claim", quote: PART(2) }] },
    ]);
    // the reduction reads the summaries of the parts, in order, not the source
    const red = s.seen.find((b) => named(b) === "reduce");
    expect(red.messages[1].content).toMatch(/Summary 1[\s\S]*Summary 2[\s\S]*Summary 3/);
    expect(red.messages[1].content).not.toContain("Filler words");
    expect(red.messages[1].content).toContain("Tags in use: ai");
    expect(red.response_format.json_schema.schema).toEqual(reduceSchema);
    expect(red.messages[0].content).toContain("Never use the double-quote character");
    const steps = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l).step).sort();
    expect(steps).toEqual(["extract", "extract", "extract", "reduce"]);
    // same input, same result, whatever the timing
    const again = await extractSource(s.cfg, { source: LONG, title: "Long", tags: ["ai"], candidates: [cand("Caching")], parallel: 4, ...OPTS });
    expect(again).toEqual(r);
  } finally { s.stop(); delete process.env.CORTEX_METRICS; }
});

test("a chunk that fails is left out and reported; a failed reduction falls back to the parts; no answer at all throws", async () => {
  const bad = (b: any) => /Part 2 of 3/.test(b.messages[1].content);
  const s = await serve((b) => {
    if (named(b) === "reduce") return new Response("boom", { status: 503 });
    if (bad(b)) return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "not json" } }] });
    const i = /Part 1 of 3/.test(b.messages[1].content) ? 1 : 3;
    return reply({ ...head(i), subjects: [subject(`Topic ${i}`, PART(i))] });
  });
  try {
    const messages: Message[] = [];
    const r = await extractSource(s.cfg, { source: LONG, tags: [], candidates: [], report: (m) => messages.push(m), ...OPTS });
    expect(r.failed).toEqual([1]);
    expect(r.extraction.subjects.map((x) => x.title)).toEqual(["Topic 1", "Topic 3"]);
    expect(r.extraction.summary).toBe("Summary 1 Summary 3");
    expect(r.extraction.description).toBe("Description 1");
    expect(messages.map((m) => m.text).join("\n")).toMatch(/morceau 2\/3[\s\S]*réduction sans résultat/);
    expect(messages.every((m) => m.level === "warn")).toBe(true);
  } finally { s.stop(); }
  const dead = await serve(() => new Response("boom", { status: 503 }));
  try { await expect(extractSource(dead.cfg, { source: LONG, tags: [], candidates: [], ...OPTS })).rejects.toThrow("extraction failed on all 3 chunks"); } finally { dead.stop(); }
});

test("a single answering chunk out of several needs no reduction", async () => {
  const s = await serve((b) => (/Part 1 of 3/.test(b.messages[1].content) ? reply({ ...head(), subjects: [] }) : new Response("no", { status: 503 })));
  try {
    const r = await extractSource(s.cfg, { source: LONG, tags: [], candidates: [], ...OPTS });
    expect(r.failed).toEqual([1, 2]);
    expect(s.seen.map(named)).not.toContain("reduce");
    expect(r.extraction.summary).toBe("Summary 1");
  } finally { s.stop(); }
});

test("the reduction input stays within 3k tokens however many parts there are", async () => {
  const s = await serve(() => reply(head()));
  try {
    const long = { summary: "word ".repeat(240), key_points: Array.from({ length: 7 }, () => "k".repeat(290)), description: "d", tags: ["ml", "ai"] };
    for (const n of [4, 12, 40]) {
      s.seen.length = 0;
      await reduceHeads(s.cfg, Array.from({ length: n }, () => long), { tags: [] });
      expect(estimateTokens(s.seen[0].messages[1].content)).toBeLessThanOrEqual(3100);
      expect(s.seen[0].messages[1].content).toContain(`The ${n} successive parts`);
    }
  } finally { s.stop(); }
});

const part = (subjects: ChunkExtraction["subjects"]): ChunkExtraction => ({ ...head(), subjects });
const sub = (title: string, n: number, extra: object = {}) => ({ kind: "Concept" as const, title, candidate: -1, description: title, facts: Array.from({ length: n }, (_, i) => ({ claim: `${title} ${i}`, quote: "q" })), ...extra });

test("mergeSubjects: keeps the 8 subjects with the most verified facts, sorted by title; the kind is the majority one", () => {
  const titles = ["B", "A", "C", "D", "E", "F", "G", "H", "I", "J"];
  const r = mergeSubjects("q", [part(titles.slice(0, 5).map((t, i) => sub(t, i + 1))), part(titles.slice(5).map((t, i) => sub(t, i + 1)))]);
  // facts: B1 A2 C3 D4 E5 | F1 G2 H3 I4 J5 → B and F (1 fact, first in order of appearance: B stays) are cut
  expect(r.subjects.map((s) => s.title)).toEqual(["A", "C", "D", "E", "G", "H", "I", "J"]);
  expect(r.dropped).toEqual(["B", "F"]);
  const m = mergeSubjects("q", [part([sub("X", 1, { kind: "Entity" })]), part([sub("X", 1, { kind: "Concept", facts: [{ claim: "other", quote: "q" }] })]), part([sub("X", 1, { kind: "Entity", facts: [{ claim: "third", quote: "q" }] })])]);
  expect(m.subjects).toHaveLength(1);
  expect(m.subjects[0]).toMatchObject({ kind: "Entity" });
  expect(m.subjects[0]!.facts.map((f) => f.claim)).toEqual(["X 0", "other", "third"]);
  // a tie keeps the first kind seen; the title slug merges « Cache-Layer » and « cache layer »
  const t = mergeSubjects("q", [part([sub("Cache-Layer", 1, { kind: "Entity" })]), part([sub("cache layer", 1, { facts: [{ claim: "z", quote: "q" }] })])]);
  expect(t.subjects).toHaveLength(1);
  expect(t.subjects[0]).toMatchObject({ kind: "Entity", title: "Cache-Layer" });
  // a candidate keeps its subjects apart from the new-page ones with the same title
  expect(mergeSubjects("q", [part([sub("Y", 1, { candidate: 2 }), sub("Y", 1, { facts: [{ claim: "n", quote: "q" }] })])]).subjects).toHaveLength(2);
});

test("mergeTags and fallbackHead: spelling in use, most frequent first; key points in turn, cut to 7", () => {
  expect(mergeTags([["a", "caches"], ["b", "cache"], ["b"]], ["cache"])).toEqual(["cache", "b", "a"]);
  const parts = [1, 2, 3].map((n) => ({ ...head(n), key_points: [`${n}a`, `${n}b`, `${n}c`] }));
  const h = fallbackHead(parts, []);
  expect(h.key_points).toEqual(["1a", "2a", "3a", "1b", "2b", "3b", "1c"]);
  expect(h.summary).toBe("Summary 1 Summary 2 Summary 3");
});

test("pool: results in order, at most n at a time", async () => {
  let live = 0, peak = 0;
  const r = await pool([30, 10, 20, 5, 15], 2, async (ms, i) => { peak = Math.max(peak, ++live); await Bun.sleep(ms); live--; return i; });
  expect(r).toEqual([0, 1, 2, 3, 4]);
  expect(peak).toBe(2);
  expect(await pool([], 4, async () => 1)).toEqual([]);
});
