import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileCtx } from "./agent";
import { chunkSource } from "./chunk";
import { openWiki } from "./context";
import { refresh } from "./embed";
import { rawId } from "./doc";
import { localIso, sha256 } from "./lib";
import { compilePipeline, settlePages, type PipelineOpts } from "./pipeline";
import type { Message } from "./print";
import { readQueue } from "./queue";

// End to end on a temp wiki against a fake llama.cpp: /chat/completions is scripted by `json_schema.name`, /embeddings
// gives every text the same vector (the nearest pages come back in path order, which makes the numbering predictable).

const ID = "01a1a5c9-5e80-7075-ae13-aab03b0a8697";
const SRC = "Caching keeps recent results close to the consumer. A cache evicts the least recently used entry first. Redis is an in-memory store used as a cache. Memcached is slower than Redis in some benchmarks.";
const NOW = () => new Date("2026-11-06T10:00:00+01:00");
const roots: string[] = [];
const servers: { stop(close?: boolean): void }[] = [];
afterEach(() => { servers.splice(0).forEach((s) => s.stop(true)); roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })); });

type Script = Record<string, (b: any, n: number) => object | Response>;
/** Fake server: `calls` lists every chat call (schema name, system and user message); a step without script answers 500. */
function fake(script: Script) {
  const calls: { name: string; system: string; user: string }[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) {
    const b: any = await req.json();
    if (new URL(req.url).pathname.endsWith("/embeddings")) return Response.json({ data: (b.input as string[]).map((_, index) => ({ index, embedding: [1, 0, 0] })) });
    const name = b.response_format?.json_schema?.name ?? "?";
    calls.push({ name, system: b.messages[0].content, user: b.messages[1].content });
    const r = script[name]?.(b, calls.filter((c) => c.name === name).length);
    if (!r) return new Response("no script", { status: 500 });
    return r instanceof Response ? r : Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(r) } }] });
  } });
  servers.push(server);
  return { calls, base_url: `http://127.0.0.1:${server.port}/v1`, count: (name: string) => calls.filter((c) => c.name === name).length };
}

const note = "[^x]";
const head = { summary: "Un texte sur les caches et sur Redis, qui sert de magasin en mémoire.", key_points: ["Un cache garde des résultats récents", "LRU évince l'entrée la plus ancienne", "Redis est un magasin en mémoire"], description: "Caches et Redis.", tags: ["perf", "new-tag"] };
const subject = (kind: string, title: string, candidate: number, facts: [string, string][]) => ({ kind, title, candidate, description: `${title}.`, facts: facts.map(([claim, quote]) => ({ claim, quote })) });
const BODY = `Redis est un magasin clé-valeur en mémoire, utilisé comme cache ${note}. Il sert souvent de [[p:1]] pour des résultats récents ${note}.\n\n## Usage\nOn le compare à [[p:3]] et il est décrit dans [[p:0]] ${note}. Cette page décrit son rôle de cache à faible latence pour les applications web et les services qui relisent souvent les mêmes données ${note}.`;

/** The scenario of the first tests: a subject on the page `Cache`, a new `Redis` page, a subject with no verified fact, two connections. */
function script(over: Script = {}): Script {
  return {
    extract: () => ({
      ...head, subjects: [
        subject("Concept", "Cache", 0, [["Eviction is least recently used first.", "A cache evicts the least recently used entry first."]]),
        subject("Entity", "Redis", -1, [["Redis is an in-memory store.", "Redis is an in-memory store used as a cache."], ["Redis is the fastest.", "Redis is faster than everything."]]),
        subject("Concept", "Ghost", -1, [["Nothing.", "Nothing of the sort is written."]]),
      ],
    }),
    connect: () => ({ connections: [{ page: 0, relation: "extends", facts: [0], why: "Précise l'éviction." }, { page: 1, relation: "related", facts: [], why: "Autre forme de cache." }] }),
    write: () => ({ body: BODY }),
    update: (b) => ({ section: "Éviction", addition: `${b.messages[1].content.includes("Page: LRU") ? "LRU est la règle qui retire d'abord l'entrée la moins récemment utilisée" : "L'éviction retire d'abord l'entrée la moins récemment utilisée du cache"} pour libérer de la place ${note}. Cette règle repose sur la fraîcheur d'usage des entrées.`, contradiction: null }),
    ...over,
  };
}

const page = (type: string, title: string, o: { status?: string; body?: string } = {}) =>
  `---\ntype: ${type}\ntitle: ${title}\ndescription: D ${title}.\nstatus: ${o.status ?? "draft"}\ntags: [perf]\nsources:\n  - id: old\n    resource: /raw/2026/10/old/source.md\n    title: Old\n---\n${o.body ?? `Un texte sur ${title}.\n\n## Éviction\nRègles diverses ${"[^old]"}.\n\n[^old]: Old, /raw/2026/10/old/source.md`}\n`;

/** Wiki with three pages (Cache stable, LRU, Memoization), one pending raw source, embeddings and a git repository. */
async function wiki(base_url: string, o: { raws?: { id: string; title: string; body: string }[]; config?: object } = {}): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "cortex-pipeline-"));
  roots.push(root);
  Bun.spawnSync(["git", "init", "-q", root]);
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ client: "openai", model: "m", base_url, language: "French", page_path: "{type}/{slug}", embed: { base_url, dims: 3 }, ...o.config }));
  await Bun.write(join(root, "raw/2026/10/old/source.md"), "---\ntype: RawSource\ntitle: Old\nstatus: compiled\n---\nVieux texte.\n");
  for (const r of o.raws ?? [{ id: ID, title: "Caches", body: SRC }])
    await Bun.write(join(root, `raw/2026/11/${r.id}/source.md`), `---\ntype: RawSource\ntitle: ${r.title}\nnote: Ma note.\nstatus: pending\n---\n${r.body}\n`);
  await Bun.write(join(root, "wiki/concepts/cache.md"), page("Concept", "Cache", { status: "stable" }));
  await Bun.write(join(root, "wiki/concepts/lru.md"), page("Concept", "LRU"));
  await Bun.write(join(root, "wiki/concepts/memoization.md"), page("Concept", "Memoization"));
  await refresh(root);
  return root;
}

const raw = async (root: string, id = ID) => (await openWiki(root).raws()).find((r) => rawId(r.path) === id)!;
const compile = async (root: string, opts: PipelineOpts = {}, id = ID) => {
  const messages: Message[] = [];
  const r = await compilePipeline(openWiki(root), await raw(root, id), { now: NOW, ...opts }, (m) => messages.push(m));
  return { ...r, messages };
};
const text = (root: string, p: string) => readFileSync(join(root, p), "utf8");
const status = async (root: string, id = ID) => String((await raw(root, id)).fm.status);
/** Every file under wiki/ with its content. */
const snapshot = (root: string) => Object.fromEntries([...new Bun.Glob("wiki/**/*").scanSync({ cwd: root })].sort().map((p) => [p, text(root, p)]));
const state = (root: string) => join(root, ".cortex/pipeline", `${ID}.json`);

test("a source end to end: Source page, new page, updated pages, links, journal, state removed", async () => {
  const s = fake(script());
  const root = await wiki(s.base_url);
  const r = await compile(root);
  expect(r.ok).toBe(true);
  expect(r.stats).toMatchObject({ chunks: 1, failedChunks: [], rejected: 2, skipped: ["Ghost"], dropped: [], redundant: 0, failedSteps: [], links: 1 });
  expect(r.stats.created).toEqual(["wiki/sources/caches.md", "wiki/entities/redis.md"]);
  expect(r.stats.updated.sort()).toEqual(["wiki/concepts/cache.md", "wiki/concepts/lru.md"]);
  expect([s.count("extract"), s.count("connect"), s.count("write"), s.count("update"), s.count("reduce")]).toEqual([1, 1, 1, 2, 0]);
  // the extraction saw the candidates in path order, the write step the pages it may mention
  expect(s.calls.find((c) => c.name === "extract")!.user).toContain("0. Cache (Concept)");
  expect(s.calls.find((c) => c.name === "write")!.user).toContain("[[p:0]] Caches\n[[p:1]] Cache\n[[p:2]] LRU\n[[p:3]] Memoization");
  expect(s.calls.find((c) => c.name === "connect")!.user).toContain("0. LRU (Concept)");

  const src = text(root, "wiki/sources/caches.md");
  expect(src).toContain(`sources:\n  - id: ${ID}\n    resource: /raw/2026/11/${ID}/source.md`);
  expect(src).toContain('description: "Caches et Redis."');
  expect(src).toContain("tags: [\"perf\",\"new-tag\"]");
  expect(src).toContain("> [!note] Note personnelle\n> Ma note.");
  expect(src).toContain(`## Résumé\nUn texte sur les caches et sur Redis, qui sert de magasin en mémoire.[^${ID}]`);
  expect(src).toContain(`## Points clés\n- Un cache garde des résultats récents[^${ID}]`);
  expect(src).toContain("- [Cache](/wiki/concepts/cache.md)");
  expect(src).toContain("- [LRU](/wiki/concepts/lru.md)");
  expect(src).toContain("- [Memoization](/wiki/concepts/memoization.md) — Autre forme de cache.");
  expect(src).toContain("- [Redis](/wiki/entities/redis.md)");
  expect(src).toContain(`[^${ID}]: Caches, /raw/2026/11/${ID}/source.md`);
  expect(src).toContain(`generated: { by: "openai/m:pipeline", at: ${localIso(NOW())} }`);

  const redis = text(root, "wiki/entities/redis.md");
  expect(redis).not.toContain("[[p:");
  expect(redis).toContain("[Cache](/wiki/concepts/cache.md)");
  expect(redis).toContain("[Memoization](/wiki/concepts/memoization.md)");
  expect(redis).toContain("[Caches](/wiki/sources/caches.md)");
  expect(redis).toContain("status: draft");
  expect(redis).toContain("description: Redis.");
  expect(redis).toContain("  - id: caches\n    resource: /raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md");
  expect(redis).toContain(`[^caches]: Caches, /raw/2026/11/${ID}/source.md`);
  expect(redis).not.toContain("Ma note.");

  const cache = text(root, "wiki/concepts/cache.md");
  expect(cache).toContain("status: stable"); // no contradiction, a note: still stable
  expect(cache).toContain("L'éviction retire d'abord l'entrée la moins récemment utilisée du cache pour libérer de la place [^caches].");
  expect(cache).toContain("  - id: caches");
  expect(cache).toContain("[^old]: Old,");
  expect(text(root, "wiki/concepts/lru.md")).toContain("LRU est la règle qui retire d'abord");
  expect(text(root, "wiki/concepts/memoization.md")).not.toContain("caches"); // linked from the Source page only

  expect(await status(root)).toBe("compiled");
  expect(existsSync(state(root))).toBe(false);
  expect(openWiki(root).journal().entries.at(-1)).toMatchObject({ kind: "ingest", sources: [ID] });
  expect(openWiki(root).journal().entries.at(-1)!.text).toContain("2 page(s) créée(s), 2 mise(s) à jour, 2 fait(s) sans citation rejeté(s)");
  expect((await (await import("./lint")).lint(root)).filter((i) => i.level === "error")).toEqual([]);
  expect(r.messages.some((m) => m.level === "fail" || (m.level === "warn" && !/links? added/.test(m.text)))).toBe(false);
});

test("compileCtx --pipeline: the same, with index and journal regenerated; a source that fails does not stop the next one", async () => {
  const B = "01a1a5c9-5e80-7075-ae13-aab03b0a8698";
  const s = fake(script({ extract: (b, n) => (b.messages[1].content.includes("Source title: Cassée") ? new Response("boom", { status: 500 }) : script().extract!(b, n)) }));
  const root = await wiki(s.base_url, { raws: [{ id: B, title: "Cassée", body: "Texte qui ne passe pas." }, { id: ID, title: "Caches", body: SRC }] });
  const r = await compileCtx(openWiki(root), [], { pending: true, batch: true, pipeline: true }, undefined);
  expect(r.ok).toBe(false);
  expect(r.messages.some((m) => m.level === "fail" && m.text.includes(B) && m.text.includes("extraction failed"))).toBe(true);
  expect(await status(root, B)).toBe("pending");
  expect(await status(root, ID)).toBe("compiled");
  expect(Object.keys(JSON.parse(text(root, `.cortex/pipeline/${B}.json`)).steps)).toEqual(["write", "update", "candidates"]); // kept, up to the step that failed
  expect(text(root, "wiki/index.md")).toContain("[Redis](/wiki/entities/redis.md)");
  expect(text(root, "wiki/log.md")).toContain("compilé (pipeline)");
});

test("--pipeline needs the openai client", async () => {
  const s = fake(script());
  const root = await wiki(s.base_url, { config: { client: "claude" } });
  const r = await compileCtx(openWiki(root), [ID], { pipeline: true }, undefined);
  expect(r.ok).toBe(false);
  expect(r.messages[0]!.text).toContain("needs the openai client");
  expect(s.calls).toEqual([]);
});

test("crash before the application: the wiki is intact, the rerun does not call extract or connect again", async () => {
  let down = true;
  const s = fake(script({ write: (b, n) => (down ? new Response("boom", { status: 500 }) : script().write!(b, n)), update: (b, n) => (down ? new Response("boom", { status: 500 }) : script().update!(b, n)) }));
  const root = await wiki(s.base_url);
  const before = snapshot(root), rawBefore = text(root, `raw/2026/11/${ID}/source.md`);
  const r1 = await compile(root);
  expect(r1.ok).toBe(false);
  expect(r1.messages.some((m) => m.level === "fail" && m.text.includes("aucune page n'a pu être rédigée"))).toBe(true);
  expect(snapshot(root)).toEqual(before); // nothing written before step 7
  expect(text(root, `raw/2026/11/${ID}/source.md`)).toBe(rawBefore);
  const saved = JSON.parse(text(root, `.cortex/pipeline/${ID}.json`));
  expect(saved).toMatchObject({ version: 1, model: "m", source_sha256: sha256(`Caches\n${SRC}\n`) });
  expect(Object.keys(saved.steps)).toEqual(expect.arrayContaining(["candidates", "extract", "route", "connect"]));

  down = false;
  const r2 = await compile(root);
  expect(r2.ok).toBe(true);
  expect(r2.messages.some((m) => m.text.includes("reprise : candidates, chunks (1/1), extract, route, connect"))).toBe(true);
  expect([s.count("extract"), s.count("connect")]).toEqual([1, 1]);
  expect(existsSync(join(root, "wiki/entities/redis.md"))).toBe(true);
  expect(await status(root)).toBe("compiled");
  expect(existsSync(state(root))).toBe(false);
});

test("the state is only valid for the same source and model; --fresh ignores it; the application is replayable", async () => {
  const s = fake(script());
  const root = await wiki(s.base_url);
  expect((await compile(root, { keepState: true })).ok).toBe(true);
  expect(existsSync(state(root))).toBe(true);
  const done = snapshot(root), calls = s.calls.length;
  // replay: every step is in the state, every page already written: no call, no new byte (but the journal)
  const again = await compile(root, { keepState: true });
  expect(again.ok).toBe(true);
  expect(s.calls.length).toBe(calls);
  const { "wiki/log.jsonl": log1, "wiki/log.md": _1, ...pages1 } = done as Record<string, string>;
  const { "wiki/log.jsonl": log2, "wiki/log.md": _2, ...pages2 } = snapshot(root);
  expect(pages2).toEqual(pages1);
  expect(log2!.split("\n").length).toBe(log1!.split("\n").length + 1);
  expect(again.stats).toMatchObject({ created: ["wiki/sources/caches.md", "wiki/entities/redis.md"], redundant: 0 }); // what the compile created, replayed or not
  expect(again.stats.updated.sort()).toEqual(["wiki/concepts/cache.md", "wiki/concepts/lru.md"]); // they cite the source: still touched
  // another model: the state is not used
  writeFileSync(join(root, "cortex.json"), JSON.stringify({ ...JSON.parse(text(root, "cortex.json")), model: "other" }));
  await compile(root, { keepState: true });
  expect(s.count("extract")).toBe(2);
  // --fresh
  await compile(root, { fresh: true });
  expect(s.count("extract")).toBe(3);
});

test("a title taken between the steps: the body goes to the page the refusal names, as a section", async () => {
  let down = true;
  const s = fake(script({ write: (b, n) => (down ? new Response("boom", { status: 500 }) : script().write!(b, n)), update: (b, n) => (down ? new Response("boom", { status: 500 }) : script().update!(b, n)) }));
  const root = await wiki(s.base_url);
  expect((await compile(root)).ok).toBe(false);
  await Bun.write(join(root, "wiki/entities/other-redis.md"), page("Entity", "Redis", { body: "Un magasin." }));
  down = false;
  const r = await compile(root);
  expect(r.ok).toBe(true);
  expect(existsSync(join(root, "wiki/entities/redis.md"))).toBe(false);
  const other = text(root, "wiki/entities/other-redis.md");
  expect(other).toContain("## Redis\n\nRedis est un magasin clé-valeur en mémoire");
  expect(other).toContain("  - id: caches");
  expect(r.stats.updated).toContain("wiki/entities/other-redis.md");
  expect(r.stats.created).toEqual(["wiki/sources/caches.md"]);
});

test("a step of the model that fails: the other pages are written, the source is compiled, a review entry says what is missing", async () => {
  const s = fake(script({ write: () => new Response("boom", { status: 500 }) }));
  const root = await wiki(s.base_url);
  const r = await compile(root);
  expect(r.ok).toBe(true);
  expect(r.stats.failedSteps).toHaveLength(1);
  expect(r.stats.failedSteps[0]).toContain("page « Redis »");
  expect(existsSync(join(root, "wiki/entities/redis.md"))).toBe(false);
  expect(text(root, "wiki/concepts/cache.md")).toContain("[^caches]");
  const q = readQueue(root).entries;
  expect(q).toHaveLength(1);
  expect(q[0]).toMatchObject({ kind: "review", title: "Compile partiel : Caches", status: "open", sources: [ID] });
  expect(q[0]!.reason).toContain("page « Redis »");
  expect(text(root, "wiki/queue.md")).toContain("Compile partiel : Caches");
  expect(await status(root)).toBe("compiled");
  // the same failure on a rerun does not pile up entries
  await compile(root, { fresh: true });
  expect(readQueue(root).entries.filter((e) => e.kind === "review")).toHaveLength(1);
});

test("a contradiction found by the connections: callout, draft page, said in the journal", async () => {
  const s = fake(script({
    connect: () => ({ connections: [{ page: 0, relation: "contradicts", facts: [0], why: "Dit autre chose." }] }),
    update: (b) => ({ section: "Éviction", addition: `Le cache évince d'abord l'entrée la moins récemment utilisée pour libérer de la place ${note}. Cette règle repose sur la fraîcheur.`, contradiction: b.messages[1].content.includes("Page: LRU") ? "La page dit le contraire." : null }),
  }));
  const root = await wiki(s.base_url);
  const r = await compile(root);
  expect(r.ok).toBe(true);
  expect(s.calls.filter((c) => c.name === "update").some((c) => c.user.includes("This source contradicts the page"))).toBe(true);
  const lru = text(root, "wiki/concepts/lru.md");
  expect(lru).toContain("> [!warning] Contradiction\n> La page dit le contraire. [^caches]");
  expect(lru).toContain("status: draft");
  expect(r.stats.contradictions).toEqual(["wiki/concepts/lru.md"]);
  expect(openWiki(root).journal().entries.at(-1)!.text).toContain("contradiction sur wiki/concepts/lru.md (draft)");
});

test("an update whose text carries no note leaves the page in draft", async () => {
  const s = fake(script({ update: () => ({ section: "Éviction", addition: "L'éviction retire d'abord l'entrée la moins récemment utilisée du cache pour libérer de la place, sans aucune note de bas de page.", contradiction: null }) }));
  const root = await wiki(s.base_url);
  expect((await compile(root)).ok).toBe(true);
  expect(text(root, "wiki/concepts/cache.md")).toContain("status: draft"); // was stable
});

test("a long source: chunks in parallel, one fails (partial extraction, callout), the reduction runs on the others", async () => {
  const body = [1, 2, 3, 4].map((i) => `## Part ${i}\n\n${`Filler paragraph about the part ${i}. `.repeat(380)}\n\nSentence marker ${i} appears here.`).join("\n\n");
  expect(chunkSource(body).length).toBeGreaterThanOrEqual(3);
  const s = fake(script({
    extract: (b) => {
      const user: string = b.messages[1].content;
      if (/Part 2 of/.test(user)) return new Response("boom", { status: 500 });
      const marker = [...user.matchAll(/Sentence marker (\d) appears here\./g)].at(-1)![1];
      return { ...head, subjects: [subject("Entity", `Topic ${marker}`, -1, [[`Fact ${marker}`, `Sentence marker ${marker} appears here.`]])] };
    },
    reduce: () => ({ ...head, summary: "Résumé global de toutes les parties de la source." }),
    connect: () => ({ connections: [] }),
  }));
  const root = await wiki(s.base_url, { raws: [{ id: ID, title: "Longue", body }] });
  const r = await compile(root);
  expect(r.ok).toBe(true);
  expect(r.stats.chunks).toBeGreaterThanOrEqual(3);
  expect(r.stats.failedChunks).toEqual([1]);
  expect(s.count("reduce")).toBe(1);
  const src = text(root, "wiki/sources/longue.md");
  expect(src).toContain("> [!warning]\n> Extraction partielle : 1 morceau(x) sur");
  expect(src).toContain("Résumé global de toutes les parties de la source.");
  expect(openWiki(root).journal().entries.at(-1)!.text).toContain("extraction partielle");
  expect(r.messages.some((m) => m.level === "warn" && m.text.includes("sans résultat"))).toBe(true);
  expect(existsSync(join(root, "wiki/entities/topic-2.md"))).toBe(false); // the failed chunk gave no subject
  expect(existsSync(join(root, "wiki/entities/topic-1.md"))).toBe(true);
});

test("crash during the extraction of a long source: the chunks already answered are not asked again", async () => {
  const body = [1, 2, 3, 4].map((i) => `## Part ${i}\n\n${`Filler paragraph about the part ${i}. `.repeat(380)}\n\nSentence marker ${i} appears here.`).join("\n\n");
  const n = chunkSource(body).length;
  expect(n).toBe(3);
  const topic = (i: number) => ({ ...head, subjects: [subject("Entity", `Topic ${i}`, -1, [[`Fact ${i}`, `Sentence marker ${i} appears here.`]])] });
  const s = fake(script({
    extract: (b) => topic(Number([...b.messages[1].content.matchAll(/Sentence marker (\d) appears here\./g)].at(-1)![1])),
    reduce: () => ({ ...head, summary: "Résumé global." }), connect: () => ({ connections: [] }),
  }));
  const root = await wiki(s.base_url, { raws: [{ id: ID, title: "Longue", body }] });
  // what a crashed run left: the answers of chunks 0 and 1 (the state is only valid for this text and this model)
  const seeded = { version: 1, model: "m", source_sha256: sha256(`Longue\n${body}\n`), steps: { chunks: { of: n, parts: { 0: topic(1), 1: topic(2) } }, write: {}, update: {} }, applied: { paths: {}, created: [] } };
  await Bun.write(state(root), JSON.stringify(seeded));
  const r = await compile(root);
  expect(r.ok).toBe(true);
  expect(r.messages.some((m) => m.text.includes("reprise : chunks (2/3)"))).toBe(true);
  expect(s.count("extract")).toBe(1);
  expect(s.calls.find((c) => c.name === "extract")!.user).toContain("Part 3 of 3");
  expect(s.count("reduce")).toBe(1); // over the three parts
  expect(r.stats.failedChunks).toEqual([]);
  expect(["topic-1", "topic-2", "topic-4"].every((t) => existsSync(join(root, `wiki/entities/${t}.md`)))).toBe(true); // the third chunk holds parts 3 and 4: the script answers with its last marker
  // a source cut differently (another chunk count) does not use them
  await Bun.write(state(root), JSON.stringify({ ...seeded, steps: { ...seeded.steps, chunks: { of: n + 1, parts: seeded.steps.chunks.parts } } }));
  await compile(root, { fresh: false });
  expect(s.count("extract")).toBe(1 + 3);
});

test("determinism: two compiles of the same source on the same wiki write the same bytes", async () => {
  const a = fake(script()), b = fake(script());
  const [ra, rb] = [await wiki(a.base_url), await wiki(b.base_url)];
  // the servers have different ports, which cortex.json holds: the pages must not depend on it
  expect((await compile(ra)).ok && (await compile(rb)).ok).toBe(true);
  const [sa, sb] = [snapshot(ra), snapshot(rb)];
  expect(Object.keys(sa).length).toBeGreaterThan(6);
  expect(sb).toEqual(sa);
  expect(text(ra, `raw/2026/11/${ID}/source.md`)).toBe(text(rb, `raw/2026/11/${ID}/source.md`));
});

test("nothing outside wiki/ is touched but the status of the raw source (and the state under .cortex/)", async () => {
  const s = fake(script());
  const root = await wiki(s.base_url);
  const r = await compile(root, { keepState: true });
  expect(r.ok).toBe(true);
  expect(r.messages.some((m) => /outside wiki/.test(m.text))).toBe(false);
  expect(readdirSync(join(root, ".cortex/pipeline"))).toEqual([`${ID}.json`]);
});

test("settlePages: mechanical fixes without the model, then one repair try per page", async () => {
  const s = fake({ repair: () => ({ body: "Corps réparé par le modèle.\n" }) });
  const root = await wiki(s.base_url);
  const cfg = { client: "openai" as const, model: "m", base_url: s.base_url };
  await Bun.write(join(root, "wiki/concepts/broken.md"), `---\ntype: Concept\ntitle: Broken\nstatus: draft\nsources:\n  - id: a\n    resource: /raw/2026/10/old/source.md\n---\nVoir [ailleurs](/wiki/concepts/ghost.md) et ceci [^zz] cela [^a].\n\n[^zz]: Perdue, /raw/x\n[^a]: Old, /raw/2026/10/old/source.md\n`);
  await Bun.write(join(root, "wiki/concepts/empty.md"), `---\ntype: Concept\ntitle: Empty\ndescription: Vide.\nstatus: draft\n---\n\n`);
  const left = await settlePages(root, ["wiki/concepts/broken.md", "wiki/concepts/empty.md"], { cfg, language: "French", description: "Décrite par l'extraction." });
  expect(left).toEqual([]);
  const broken = text(root, "wiki/concepts/broken.md");
  expect(broken).toContain('description: "Décrite par l\'extraction."');
  expect(broken).toContain("Voir ailleurs et ceci [^a] cela [^a].");
  expect(broken).not.toContain("zz");
  expect(text(root, "wiki/concepts/empty.md")).toContain("Corps réparé par le modèle.");
  expect(s.count("repair")).toBe(1); // only the empty page needed the model
  // a repair that fails leaves the error, reported
  await Bun.write(join(root, "wiki/concepts/empty.md"), `---\ntype: Concept\ntitle: Empty\ndescription: Vide.\nstatus: draft\n---\n\n`);
  const s2 = fake({});
  const left2 = await settlePages(root, ["wiki/concepts/empty.md"], { cfg: { ...cfg, base_url: s2.base_url }, language: "French" });
  expect(left2).toEqual(["wiki/concepts/empty.md: empty body"]);
});

test("the pipeline needs a model, and a source with a body", async () => {
  const s = fake(script());
  const root = await wiki(s.base_url, { config: { model: null } });
  const r = await compile(root);
  expect(r.ok).toBe(false);
  expect(r.messages[0]!.text).toContain("needs a model");
  const root2 = await wiki(s.base_url, { raws: [{ id: ID, title: "Vide", body: "  " }] });
  expect((await compile(root2)).messages[0]!.text).toContain("the source is empty");
  expect(s.calls).toEqual([]);
});

/** The wiki of `wiki()` with two groups of linked pages: Cache (hub) with LRU and Hashing, Memoization (hub) with DynProg and Tabulation. */
async function twoGroups(base_url: string): Promise<string> {
  const root = await wiki(base_url);
  await Promise.all([["LRU", "lru", "Cache"], ["Hashing", "hashing", "Cache"], ["DynProg", "dynprog", "Memoization"], ["Tabulation", "tabulation", "Memoization"]].map(([t, f, l]) =>
    Bun.write(join(root, `wiki/concepts/${f}.md`), page("Concept", t!, { body: `Voir [${l}](/wiki/concepts/${l!.toLowerCase()}.md) [^old].\n\n[^old]: Old, /raw/2026/10/old/source.md` }))));
  await refresh(root);
  return root;
}

test("a source that links two groups of pages: one synthesis entry in the queue, not duplicated by a rerun", async () => {
  const s = fake(script());
  const root = await twoGroups(s.base_url);
  const r = await compile(root, { keepState: true });
  expect(r.ok).toBe(true);
  // touched: Cache (the subject), DynProg (connection), Hashing (link), Redis (new); the groups are Cache/LRU/Hashing and Memoization/DynProg/Tabulation
  const q = readQueue(root).entries;
  expect(q).toHaveLength(1);
  expect(q[0]).toMatchObject({ kind: "synthesis", title: "Synthèse : Cache / Memoization", status: "open", sources: [ID] });
  expect(q[0]!.pages).toEqual(["wiki/concepts/cache.md", "wiki/concepts/memoization.md", "wiki/entities/redis.md", "wiki/concepts/dynprog.md", "wiki/concepts/hashing.md"]);
  expect(q[0]!.reason).toContain("3 et 3 pages");
  expect(text(root, "wiki/queue.md")).toContain("Synthèse : Cache / Memoization");
  expect(r.messages.some((m) => m.text.includes("1 synthèse(s) à écrire"))).toBe(true);
  // a rerun of the same source: no second entry
  expect((await compile(root, { fresh: true })).ok).toBe(true);
  expect(readQueue(root).entries.filter((e) => e.kind === "synthesis")).toHaveLength(1);
});

test("a source that touches one group only, or groups too small: no synthesis entry", async () => {
  const lone = await wiki(fake(script()).base_url); // three lone pages
  expect((await compile(lone)).ok).toBe(true);
  expect(readQueue(lone).entries).toEqual([]);
  // the connection (page 1: Hashing) is in the group of Cache: the new page Redis and the pages of one group
  const s = fake(script({ connect: () => ({ connections: [{ page: 1, relation: "related", facts: [], why: "Même groupe." }] }) }));
  const root = await twoGroups(s.base_url);
  expect((await compile(root)).ok).toBe(true);
  expect(readQueue(root).entries).toEqual([]);
});

test("a rerun tries the failed chunks again (the saved ones are reused) and decides again from the complete extraction", async () => {
  const body = [1, 2, 3, 4].map((i) => `## Part ${i}\n\n${`Filler paragraph about the part ${i}. `.repeat(380)}\n\nSentence marker ${i} appears here.`).join("\n\n");
  let down = true;
  const s = fake(script({
    extract: (b) => {
      const user: string = b.messages[1].content;
      if (down && /Part 2 of/.test(user)) return new Response("boom", { status: 500 });
      const marker = [...user.matchAll(/Sentence marker (\d) appears here\./g)].at(-1)![1];
      return { ...head, subjects: [subject("Entity", `Topic ${marker}`, -1, [[`Fact ${marker}`, `Sentence marker ${marker} appears here.`]])] };
    },
    reduce: () => ({ ...head, summary: "Résumé global de toutes les parties de la source." }), connect: () => ({ connections: [] }),
    write: (b, n) => (down ? new Response("boom", { status: 500 }) : script().write!(b, n)),
  }));
  const root = await wiki(s.base_url, { raws: [{ id: ID, title: "Longue", body }] });
  const r1 = await compile(root);
  expect(r1.ok).toBe(false); // no page could be written: the state is kept, with the failed chunk in it
  expect(JSON.parse(text(root, `.cortex/pipeline/${ID}.json`)).steps.extract.failed).toEqual([1]);
  const extracts = s.count("extract");

  down = false;
  const r2 = await compile(root);
  expect(r2.ok).toBe(true);
  expect(s.count("extract")).toBe(extracts + 1); // only the failed chunk was asked again
  expect(r2.stats.failedChunks).toEqual([]);
  expect(text(root, "wiki/sources/longue.md")).not.toContain("Extraction partielle");
  expect(existsSync(join(root, "wiki/entities/topic-2.md"))).toBe(true); // what the failed chunk holds is in the wiki now
});
