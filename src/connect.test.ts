import { expect, test } from "bun:test";
import { connectSchema, connectSource, connectionSteps, linkLine, type Connection, type Relation } from "./connect";
import type { Message } from "./print";
import type { Candidate } from "./route";

const reply = (o: object) => Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(o) } }] });
async function serve(handle: (b: any) => Response | Promise<Response>) {
  const seen: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) { const b = await req.json(); seen.push(b); return handle(b); } });
  return { seen, cfg: { model: "m", base_url: `http://127.0.0.1:${server.port}/v1` }, stop: () => server.stop(true) };
}
const page = (title: string, description = `${title} page`): Candidate => ({ path: `wiki/concepts/${title.toLowerCase()}.md`, title, type: "Concept", description });
const POOL = [page("Alpha"), page("Beta"), page("Gamma"), page("Delta")];
const subjects = [{ title: "Caching", facts: [{ claim: "Caches evict old entries", quote: "q1" }, { claim: "LRU is common", quote: "q2" }] }, { title: "Redis", facts: [{ claim: "Redis is in memory", quote: "q3" }] }];
const o = { summary: "A source about caches.", keyPoints: ["k1", "k2", "k3"], subjects, pool: POOL };
const conn = (page: number, relation: Relation, facts: number[] = [], why = "because"): Connection => ({ page, relation, facts, why });

test("connect: one call with summary, numbered facts and numbered pages (except the targeted ones); extends and contradicts become updates, example and related links", async () => {
  const s = await serve(() => reply({ connections: [conn(1, "extends", [0, 2]), conn(0, "contradicts", [1], "says the opposite"), conn(2, "example", [], "worked case"), conn(2, "related", [], "late"), conn(1, "related")] }));
  try {
    // Beta is already targeted by a subject: the model sees Alpha, Gamma, Delta as 0, 1, 2
    const r = await connectSource(s.cfg, { ...o, targeted: ["wiki/concepts/beta.md"], language: "French" });
    expect(s.seen).toHaveLength(1);
    const b = s.seen[0];
    expect(b.response_format.json_schema.name).toBe("connect");
    expect(b.response_format.json_schema.schema).toEqual(connectSchema);
    expect(b.messages[0].content).toContain("in French");
    expect(b.messages[0].content).not.toContain("{{");
    expect(b.max_tokens).toBe(600);
    const u: string = b.messages[1].content;
    expect(u).toContain("Summary: A source about caches.");
    expect(u).toContain("- k2");
    expect(u).toContain("0. [Caching] Caches evict old entries");
    expect(u).toContain("2. [Redis] Redis is in memory");
    expect(u).toContain("Existing pages:\n0. Alpha (Concept): Alpha page\n1. Gamma (Concept): Gamma page\n2. Delta (Concept): Delta page");
    expect(u).not.toContain("Beta");
    expect(r.updates).toEqual([
      { path: "wiki/concepts/alpha.md", title: "Alpha", facts: [subjects[0]!.facts[1]!], contradiction: true, why: "says the opposite" },
      { path: "wiki/concepts/gamma.md", title: "Gamma", facts: [subjects[0]!.facts[0]!, subjects[1]!.facts[0]!], contradiction: false, why: "because" },
    ]);
    expect(r.links).toEqual([{ path: "wiki/concepts/delta.md", title: "Delta", relation: "example", why: "worked case" }]);
  } finally { s.stop(); }
});

test("connect: the model's page numbers are those of the list it saw", async () => {
  const s = await serve(() => reply({ connections: [conn(1, "extends", [0, 2]), conn(2, "example", [], "worked case")] }));
  try {
    const r = await connectSource(s.cfg, { ...o, targeted: ["wiki/concepts/alpha.md"] }); // list: Beta, Gamma, Delta
    expect(r.updates).toEqual([{ path: "wiki/concepts/gamma.md", title: "Gamma", facts: [subjects[0]!.facts[0]!, subjects[1]!.facts[0]!], contradiction: false, why: "because" }]);
    expect(r.links).toEqual([{ path: "wiki/concepts/delta.md", title: "Delta", relation: "example", why: "worked case" }]);
  } finally { s.stop(); }
});

test("connectionSteps: related is a link only, a page named twice keeps its first relation, extends without a valid fact falls back to a link, results sorted by title", () => {
  const facts = subjects.flatMap((s) => s.facts);
  const r = connectionSteps([conn(3, "related"), conn(1, "extends", [9, 9]), conn(1, "contradicts", [0]), conn(2, "extends", [1, 1, 2, 7]), conn(0, "example"), conn(8, "related")], POOL, facts);
  expect(r.updates.map((u) => [u.title, u.facts.map((f) => f.quote), u.contradiction])).toEqual([["Gamma", ["q2", "q3"], false]]);
  expect(r.links.map((l) => [l.title, l.relation])).toEqual([["Alpha", "example"], ["Beta", "extends"], ["Delta", "related"]]);
});

test("connectionSteps: at most pipelineMaxConnections connections", () => {
  const pages = Array.from({ length: 14 }, (_, i) => page(`P${String(i).padStart(2, "0")}`));
  const r = connectionSteps(pages.map((_, i) => conn(i, "related")), pages, []);
  expect(r.links).toHaveLength(10);
  expect(r.links.at(-1)!.title).toBe("P09");
});

test("connect: indices out of range are an error sent back to the model, which answers again", async () => {
  let n = 0;
  const s = await serve(() => reply({ connections: [n++ ? conn(0, "extends", [0]) : conn(7, "extends", [0])] }));
  try {
    const r = await connectSource(s.cfg, o);
    expect(s.seen).toHaveLength(2);
    expect(s.seen[1].messages.at(-1).content).toContain("connections.0.page");
    expect(r.updates.map((u) => u.title)).toEqual(["Alpha"]);
  } finally { s.stop(); }
});

test("connect: skipped without a call when no page is left near the source or no fact was verified", async () => {
  const s = await serve(() => reply({ connections: [] }));
  try {
    expect(await connectSource(s.cfg, { ...o, pool: [] })).toEqual({ updates: [], links: [] });
    expect(await connectSource(s.cfg, { ...o, targeted: POOL.map((p) => p.path) })).toEqual({ updates: [], links: [] });
    expect(await connectSource(s.cfg, { ...o, subjects: [{ title: "X", facts: [] }] })).toEqual({ updates: [], links: [] });
    expect(s.seen).toHaveLength(0);
  } finally { s.stop(); }
});

test("connect: a failing call is reported and gives an empty result", async () => {
  const s = await serve(() => reply({ nope: true }));
  try {
    const messages: Message[] = [];
    expect(await connectSource(s.cfg, { ...o, report: (m) => messages.push(m) })).toEqual({ updates: [], links: [] });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.level).toBe("warn");
    expect(messages[0]!.text).toContain("connexions");
  } finally { s.stop(); }
});

test("connect: the page list is shortened to fit 4k tokens, and the bounds follow", async () => {
  const pool = Array.from({ length: 30 }, (_, i) => page(`Page${i}`, "x".repeat(400)));
  const s = await serve(() => reply({ connections: [] }));
  try {
    await connectSource(s.cfg, { ...o, summary: "s".repeat(13000), pool });
    const u: string = s.seen[0].messages[1].content;
    expect(Math.ceil(u.length / 4)).toBeLessThanOrEqual(4000);
    expect(u).toContain("0. Page0 ");
    expect(u).not.toContain("29. Page29");
    expect(s.seen[0].response_format.json_schema.schema).toEqual(connectSchema);
  } finally { s.stop(); }
});

test("linkLine: the line of the Source page", () => {
  expect(linkLine({ path: "wiki/concepts/a.md", title: "A [x]", why: "worked\ncase" })).toBe("- [A x](/wiki/concepts/a.md) — worked case");
  expect(linkLine({ path: "wiki/concepts/a.md", title: "A", why: "" })).toBe("- [A](/wiki/concepts/a.md)");
});
