import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWiki } from "./context";
import { refresh } from "./embed";
import { routeCandidates, routeSubjects } from "./route";

// Fake llama.cpp: /embeddings (the source is [1,0,0]; "C<n>" pages lean away from it by n/10, so C1 is the closest; "Src",
// "Dep" and "Syn" are as close as it gets but must be excluded; "N<n>" neighbours are far, N3 a bit nearer than the others;
// "Minou"-like texts are "cat") and /systemone, whose verdicts each test sets.
const vec = (t: string): number[] => {
  const c = /^C(\d+)\n/.exec(t);
  if (c) return [1, Number(c[1]) / 10, 0];
  if (/^(Src|Dep|Syn)\n/.test(t) || t.includes("SOURCE")) return [1, 0, 0];
  if (/^N3\n/.test(t)) return [0.3, 0, 1];
  if (/^N2\n/.test(t)) return [0.1, 0, 1];
  if (/chat|minou/i.test(t)) return [0, 1, 0];
  return [0, 0, 1];
};
type Body = { state: any; questions: Record<string, { type: string; instructions: string; criteria?: Record<string, string> }> };
let calls: Body[] = [], verdict: (b: Body) => Response | object = () => ({});
function fake() {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url), b = (await req.json()) as any;
      if (url.pathname === "/v1/embeddings") return Response.json({ data: (b.input as string[]).map((t, index) => ({ index, embedding: [...vec(t), 0.1, 0.1] })) });
      if (url.pathname !== "/v1/systemone") return new Response("no", { status: 404 });
      calls.push(b);
      const r = verdict(b);
      return r instanceof Response ? r : Response.json({ model: b.model, answers: r });
    },
  });
}
const noul = (f: (title: string) => number) => (b: Body) => Object.fromEntries(Object.keys(b.questions).map((id) => [id, { type: "noul", noul: f(b.state.pages[Number(id.slice(1))].title) }]));
const roots: string[] = [];
const page = (type: string, title: string, o: { tags?: string[]; body?: string; status?: string } = {}) =>
  `---\ntype: ${type}\ntitle: ${title}\ndescription: D ${title}.\nstatus: ${o.status ?? "draft"}\ntags: [${(o.tags ?? []).join(", ")}]\n---\n${o.body ?? "x"}\n`;
const link = (p: string) => `[l](/wiki/concepts/${p}.md)`;
const dir = (type: string) => (type === "Entity" ? "entities" : type === "Source" ? "sources" : type === "Synthesis" ? "syntheses" : "concepts");

/** C1..C12, linked/tagged neighbours, excluded pages; `extra` more neighbours of C1. */
async function wiki(port: number, o: { judge?: boolean; embed?: boolean; extra?: number; small?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "cortex-route-"));
  roots.push(root);
  const base_url = `http://localhost:${port}/v1`;
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ ...(o.embed === false ? {} : { embed: { base_url, dims: 3 } }), ...(o.judge === false ? {} : { judge: { base_url } }) }));
  const w = (type: string, file: string, title: string, o2?: Parameters<typeof page>[2]) => Bun.write(join(root, `wiki/${dir(type)}/${file}.md`), page(type, title, o2));
  for (let n = 1; n <= (o.small ? 3 : 12); n++) await w(n % 2 ? "Concept" : "Entity", `c${n}`, `C${n}`, { tags: n <= 2 ? ["x"] : n === 3 ? ["y"] : [], body: n === 1 ? `${link("n1")} ${link("n2")} ${link("n3")}` : n === 2 ? link("n1") : "x" });
  if (o.small) { await refresh(root); return root; }
  await w("Concept", "n1", "N1"); await w("Concept", "n2", "N2"); await w("Concept", "n3", "N3");
  await w("Concept", "t1", "T1", { tags: ["x", "y"] }); // tag x: two core pages
  await w("Concept", "t2", "T2", { tags: ["y"] }); // tag y: one core page only
  await w("Concept", "t3", "T3", { tags: ["x"] });
  await w("Source", "s1", "Src", { tags: ["x"], body: link("n1") });
  await w("Synthesis", "y1", "Syn", { tags: ["x"] });
  await w("Concept", "d1", "Dep", { tags: ["x"], status: "deprecated" });
  for (let n = 0; n < (o.extra ?? 0); n++) await w("Concept", `e${n}`, `E${n}`, { body: "x" });
  if (o.extra) await Bun.write(join(root, "wiki/concepts/c1.md"), page("Concept", "C1", { tags: ["x"], body: [link("n1"), link("n2"), link("n3"), ...Array.from({ length: o.extra }, (_, n) => link(`e${n}`))].join(" ") }));
  await refresh(root);
  return root;
}
const titles = (l: { title: string }[]) => l.map((p) => p.title);
const src = { title: "Un titre", body: "SOURCE text. ".repeat(300) };
afterEach(() => { calls = []; verdict = () => ({}); for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

test("candidates: core by embeddings, then one-link neighbours, then shared tags; Source, Synthesis and deprecated left out; no judge = that order", async () => {
  const s = fake(), root = await wiki(s.port!, { judge: false });
  const r = await routeCandidates(openWiki(root), src);
  // core C1..C10 (C11, C12 are farther); neighbours: N1 (linked to C1 and C2) before N3 (nearer) before N2; tags: T1 (x, shared by C1 and C2) and T3; T2 only shares y, carried by one core page (C3)
  expect(titles(r.pool)).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "N1", "N3", "N2", "T1", "T3"]);
  expect(titles(r.extract)).toEqual(titles(r.pool).slice(0, 10));
  expect(r.pool[0]).toMatchObject({ path: "wiki/concepts/c1.md", type: "Concept", description: "D C1." });
  expect(r.pool[1].type).toBe("Entity");
  expect(calls).toEqual([]);
  s.stop(true);
});

test("candidates: the judge sorts the pool; extraction keeps the ten best at or above routeYes", async () => {
  const s = fake(), root = await wiki(s.port!);
  const yes = new Set(["N2", "C4", "T3"]);
  verdict = noul((t) => (yes.has(t) ? 0.9 : t === "C1" ? 0.5 : 0.1));
  const r = await routeCandidates(openWiki(root), src);
  expect(calls).toHaveLength(1);
  expect(Object.keys(calls[0].questions)).toHaveLength(15);
  expect(calls[0].state.source.length).toBeLessThanOrEqual(1501);
  expect(calls[0].state.pages[0]).toEqual({ title: "C1", description: "D C1." });
  expect(calls[0].questions.p0.type).toBe("noul");
  expect(titles(r.extract)).toEqual(["C4", "N2", "T3", "C1"]); // stable among equals, C1 at exactly 0.5
  expect(titles(r.pool).slice(0, 4)).toEqual(["C4", "N2", "T3", "C1"]);
  expect(r.pool).toHaveLength(15);
  expect(r.pool[0].judged).toBe(0.9);
  s.stop(true);
});

test("candidates: the pool is capped at 30, core first; at most ten reach the extraction", async () => {
  const s = fake(), root = await wiki(s.port!, { judge: false, extra: 30 });
  const r = await routeCandidates(openWiki(root), src);
  expect(r.pool).toHaveLength(30);
  expect(titles(r.pool).slice(0, 10)).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"]);
  expect(titles(r.pool).slice(10, 13)).toEqual(["N1", "N3", "N2"]); // before the 30 E pages linked once
  expect(titles(r.pool)).not.toContain("T1"); // tags come last: no room left
  s.stop(true);
  const s2 = fake(), root2 = await wiki(s2.port!, { extra: 30 });
  verdict = noul(() => 1);
  expect((await routeCandidates(openWiki(root2), src)).extract).toHaveLength(10);
  s2.stop(true);
});

test("candidates: a small wiki (under ten candidates) is not sorted, everything passes", async () => {
  const s = fake(), root = await wiki(s.port!, { small: true });
  const r = await routeCandidates(openWiki(root), src);
  expect(titles(r.extract)).toEqual(["C1", "C2", "C3"]);
  expect(r.pool).toEqual(r.extract);
  expect(calls).toEqual([]);
  s.stop(true);
});

test("candidates: judge down = the order of the bounds; no embeddings = BM25 on the title, then the same neighbours and tags", async () => {
  const s = fake(), root = await wiki(s.port!);
  verdict = () => new Response("down", { status: 500 });
  const down = await routeCandidates(openWiki(root), src);
  expect(titles(down.extract)).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"]);
  expect(titles(down.pool)).toHaveLength(15);
  expect(down.pool[0].judged).toBeUndefined();

  const bare = await wiki(s.port!, { embed: false, judge: false });
  const r = await routeCandidates(openWiki(bare), { title: "C1 et C2", body: "texte" });
  // « C1 et C2 » AND fails on the pages, the words of 4+ letters do not exist: nothing found by BM25 here, hence nothing
  expect(r.pool).toEqual([]);
  // a title that BM25 finds: the page D C1 / description matches « C1 »
  await Bun.write(join(bare, "wiki/concepts/c1.md"), page("Concept", "C1", { tags: ["x"], body: `Le zythum. ${link("n1")} ${link("n2")}` }));
  const f = await routeCandidates(openWiki(bare), { title: "zythum", body: "texte" });
  expect(titles(f.pool)).toEqual(["C1", "N1", "N2"]); // core by BM25, then its neighbours
  s.stop(true);
});

test("subjects: candidate of the right type wins; a wrong type, a bad number or -1 go through the duplicate guard; no fact = skipped; collator order", async () => {
  const root = await wiki(0, { judge: false, embed: false });
  const cands = [{ path: "wiki/concepts/c1.md" }, { path: "wiki/entities/c2.md" }];
  const f = (claim: string) => ({ claim, quote: claim });
  const subjects = [
    { kind: "Concept", title: "Zèbre", description: "Un bovin.", candidate: 0, facts: [f("a")] }, // right type
    { kind: "Concept", title: "Abeille", description: "Un insecte.", candidate: 1, facts: [f("b")] }, // C2 is an Entity: a new page
    { kind: "Concept", title: "Vide", description: "Rien.", candidate: -1, facts: [] },
    { kind: "Concept", title: "Ours", description: "Un animal.", candidate: 7, facts: [f("c")] }, // out of range
  ];
  const { routes, skipped } = await routeSubjects(openWiki(root), subjects, cands);
  expect(routes.map((r) => [r.subject.title, r.target, r.via])).toEqual([["Abeille", undefined, "new"], ["Ours", undefined, "new"], ["Zèbre", "wiki/concepts/c1.md", "candidate"]]);
  expect(skipped.map((x) => x.title)).toEqual(["Vide"]);
});

test("subjects: the judge sends a new subject to an existing page; no judge, a very close cosine does; a near title or the same slug too", async () => {
  const s = fake(), root = await wiki(s.port!);
  const f = (claim: string) => ({ claim, quote: claim });
  const choice = (pick: string, p: number, n: number) => ({ dup: { type: "choice", choice: pick, confidence: p, probabilities: { ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i + 1}`, 0])), none: 0, [pick]: p } } });
  await Bun.write(join(root, "wiki/concepts/chat.md"), page("Concept", "Chat", { body: "x" }));
  await refresh(root);
  verdict = (b) => choice("p1", 0.95, Object.keys(b.questions.dup.criteria!).length - 1);
  let r = await routeSubjects(openWiki(root), [{ kind: "Concept", title: "Minou", description: "Un petit chat.", candidate: -1, facts: [f("a")] }], []);
  expect(r.routes[0]).toMatchObject({ target: expect.stringMatching(/^wiki\/concepts\//), via: "duplicate" });
  expect(calls[0].state.new_page).toMatchObject({ type: "Concept", title: "Minou" });
  verdict = (b) => choice("none", 0.95, Object.keys(b.questions.dup.criteria!).length - 1);
  r = await routeSubjects(openWiki(root), [{ kind: "Concept", title: "Minou", description: "Un petit chat.", candidate: -1, facts: [f("a")] }], []);
  expect(r.routes[0]).toMatchObject({ target: undefined, via: "new" });
  s.stop(true);

  const bare = await wiki(0, { judge: false, embed: false });
  await Bun.write(join(bare, "wiki/concepts/q.md"), page("Concept", "Qwen3 4B Instruct"));
  const t = await routeSubjects(openWiki(bare), [
    { kind: "Concept", title: "Qwen3-4B-Instruct-2507", description: "d", candidate: -1, facts: [f("a")] },
    { kind: "Entity", title: "Qwen3 4B Instruct", description: "d", candidate: -1, facts: [f("b")] }, // same slug, other type: still taken
    { kind: "Concept", title: "C7", description: "d", candidate: -1, facts: [f("c")] },
  ], []);
  // the first two land on the same page and merge
  expect(t.routes.map((x) => [x.target, x.via]).sort()).toEqual([["wiki/concepts/c7.md", "title"], ["wiki/concepts/q.md", "title"]]);
  expect(t.routes.find((x) => x.target === "wiki/concepts/q.md")!.subject.facts.map((x) => x.claim).sort()).toEqual(["a", "b"]);
});

test("subjects: near subjects of one compile merge their facts, a repeated claim once; the deprecated page is no target", async () => {
  const bare = await wiki(0, { judge: false, embed: false });
  await Bun.write(join(bare, "wiki/concepts/old.md"), page("Concept", "Vieux modèle", { status: "deprecated" }));
  const f = (claim: string) => ({ claim, quote: claim });
  const { routes } = await routeSubjects(openWiki(bare), [
    { kind: "Concept", title: "Vieux modèle", description: "d1", candidate: -1, facts: [f("Il  est LENT."), f("a")] },
    { kind: "Concept", title: "Modèle vieux", description: "d2", candidate: -1, facts: [f("il est lent"), f("b")] },
    { kind: "Concept", title: "Autre", description: "d3", candidate: -1, facts: [f("z")] },
  ], []);
  expect(routes.map((r) => [r.subject.title, r.via, r.subject.facts.map((x) => x.claim)])).toEqual([
    ["Autre", "new", ["z"]],
    ["Modèle vieux", "new", ["il est lent", "b", "a"]], // collator order: this one is met first, the other one's repeated claim is dropped
  ]);
  expect(routes[1].subject.description).toBe("d2");
});

test("subjects: titles with the same ASCII slug but not the same title are not the same page (C++ / C#, non-Latin); an empty slug matches nothing", async () => {
  const bare = await wiki(0, { judge: false, embed: false });
  await Bun.write(join(bare, "wiki/concepts/csharp.md"), page("Concept", "C#"));
  await Bun.write(join(bare, "wiki/concepts/nihongo.md"), page("Concept", "日本語"));
  await Bun.write(join(bare, "wiki/concepts/punct.md"), page("Concept", "???"));
  const f = (claim: string) => ({ claim, quote: claim });
  const subj = (title: string, claim: string) => ({ kind: "Concept", title, description: "d", candidate: -1, facts: [f(claim)] });
  const { routes } = await routeSubjects(openWiki(bare), [subj("C++", "a"), subj("C#", "b"), subj("中文", "c"), subj("日本語", "d"), subj("!!!", "e"), subj("???", "f")], []);
  const by = (t: string) => routes.find((r) => r.subject.title === t)!;
  expect([by("C++").target, by("中文").target, by("!!!").target, by("???").target]).toEqual([undefined, undefined, undefined, undefined]); // new pages, each of its own (no letter, no digit: no identity)
  expect([by("C#").target, by("日本語").target]).toEqual(["wiki/concepts/csharp.md", "wiki/concepts/nihongo.md"]);
  expect(routes).toHaveLength(6);
  // two non-Latin claims are two claims, not one empty fold
  const m = await routeSubjects(openWiki(bare), [subj("Alpha beta", "日本"), { ...subj("Beta alpha", "中国"), facts: [f("中国")] }], []);
  expect(m.routes[0].subject.facts.map((x) => x.claim).sort()).toEqual(["中国", "日本"]);
});

test("subjects: the title fallback only targets a Concept or Entity page, never a Source or a Synthesis", async () => {
  const bare = await wiki(0, { judge: false, embed: false });
  await Bun.write(join(bare, "wiki/sources/redis.md"), page("Source", "Redis"));
  await Bun.write(join(bare, "wiki/syntheses/cache-strategies.md"), page("Synthesis", "Cache strategies"));
  await Bun.write(join(bare, "wiki/entities/valkey.md"), page("Entity", "Valkey"));
  const f = (claim: string) => ({ claim, quote: claim });
  const { routes } = await routeSubjects(openWiki(bare), [
    { kind: "Entity", title: "Redis", description: "d", candidate: -1, facts: [f("a")] },
    { kind: "Concept", title: "Cache strategies", description: "d", candidate: -1, facts: [f("b")] },
    { kind: "Concept", title: "Valkey", description: "d", candidate: -1, facts: [f("c")] }, // other type, same title: a Concept or Entity page, still taken
  ], []);
  expect(routes.map((r) => [r.subject.title, r.target, r.via])).toEqual([["Cache strategies", undefined, "new"], ["Redis", undefined, "new"], ["Valkey", "wiki/entities/valkey.md", "title"]]);
});
