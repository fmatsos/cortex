import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintConfig } from "./config";
import { embed, embedConfig, nearest, refresh, similar } from "./embed";
import { search } from "./search";

// Fake llama.cpp: 8 dims, the first three say "cat", "dog" or "other"; the rest is noise that `dims: 3` must cut off.
const topic = (t: string) => (/chat|f[ée]lin/i.test(t) ? [1, 0, 0] : /chien/i.test(t) ? [0, 1, 0] : [0, 0, 1]);
let seen: string[] = [], auth: (string | null)[] = [];
function fake(port = 0) {
  return Bun.serve({
    port,
    async fetch(req) {
      const b = (await req.json()) as { model: string; input: string[] };
      auth.push(req.headers.get("authorization"));
      seen.push(...b.input);
      const data = b.input.map((t, index) => { const v = [...topic(t), 0.1, 0.1, 0.1, 0.1, 0.1]; const n = Math.hypot(...v); return { index, embedding: v.map((x) => x / n) }; }).reverse(); // shuffled: index decides
      return Response.json({ data });
    },
  });
}
const page = (title: string, body: string) => `---\ntype: Concept\ntitle: ${title}\ndescription: D.\n---\n${body}\n`;
const roots: string[] = [];
async function wiki(port: number, extra: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "cortex-embed-"));
  roots.push(root);
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ embed: { base_url: `http://localhost:${port}/v1`, dims: 3, ...extra } }));
  await Bun.write(join(root, "wiki/concepts/cat1.md"), page("Chat", "Le chat dort."));
  await Bun.write(join(root, "wiki/concepts/cat2.md"), page("Félin", "Un animal domestique."));
  await Bun.write(join(root, "wiki/concepts/dog.md"), page("Chien", "Le chien aboie."));
  return root;
}
afterEach(() => { seen = []; auth = []; for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

test("embed config: absent = off, defaults, key only to a URL the environment names", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-embed-")); roots.push(root);
  await Bun.write(join(root, "cortex.json"), "{}");
  expect(await embedConfig(root)).toBeUndefined();
  expect(await nearest(root, "x", 3)).toBeUndefined();
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ base_url: "http://elsewhere/v1/", embed: {} }));
  expect(await embedConfig(root)).toMatchObject({ url: "http://elsewhere/v1", model: "qwen3-embed", dims: 256, key: undefined });
  expect(lintConfig({ embed: { dims: 0 } })[0].level).toBe("error");
  expect(lintConfig({ embed: { model: "m", dims: 128, base_url: null } })).toEqual([]);
  expect(lintConfig({ embed: { nope: 1 } })[0].level).toBe("error");
});

test("embed: truncates to dims and renormalizes, keeps the order of the inputs", async () => {
  const s = fake();
  const [a, b] = await embed(["chien", "chat"], { url: `http://localhost:${s.port}/v1`, model: "m", dims: 3 });
  expect(a).toEqual([0, 1, 0]);
  expect(b).toEqual([1, 0, 0]);
  s.stop(true);
});

test("refresh: only changed or new pages are embedded, removed ones dropped, another model redoes all", async () => {
  const s = fake(), root = await wiki(s.port!);
  expect(await refresh(root)).toEqual({ embedded: 3, removed: 0 });
  expect(seen.length).toBe(3);
  seen = [];
  expect(await refresh(root)).toEqual({ embedded: 0, removed: 0 });
  expect(seen).toEqual([]); // nothing sent
  await Bun.write(join(root, "wiki/concepts/dog.md"), page("Chien", "Le chien aboie fort."));
  await Bun.write(join(root, "wiki/concepts/new.md"), page("Nouveau", "Autre."));
  await Bun.write(join(root, "wiki/index.md"), "# Index\n"); // reserved: never embedded
  expect(await refresh(root)).toEqual({ embedded: 2, removed: 0 });
  rmSync(join(root, "wiki/concepts/cat2.md"));
  expect(await refresh(root)).toEqual({ embedded: 0, removed: 1 });
  const store = await Bun.file(join(root, ".cortex/embeddings.json")).json();
  expect(Object.keys(store.pages).sort()).toEqual(["wiki/concepts/cat1.md", "wiki/concepts/dog.md", "wiki/concepts/new.md"]);
  expect(store).toMatchObject({ model: "qwen3-embed", dims: 3 });
  seen = [];
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ embed: { base_url: `http://localhost:${s.port}/v1`, dims: 3, model: "other" } }));
  expect(await refresh(root)).toEqual({ embedded: 3, removed: 0 });
  s.stop(true);
});

test("refresh: a down server keeps what was stored and does not throw", async () => {
  const s = fake(), root = await wiki(s.port!);
  await refresh(root);
  await Bun.write(join(root, "wiki/concepts/dog.md"), page("Chien", "Autre texte."));
  s.stop(true);
  expect(await refresh(root)).toEqual({ embedded: 0, removed: 0 });
  const before = await Bun.file(join(root, ".cortex/embeddings.json")).text();
  expect(Object.keys(JSON.parse(before).pages)).toHaveLength(3); // dog keeps its old vector...
  const s2 = fake(Number(new URL((await embedConfig(root))!.url).port)); // ...and is embedded again once the server is back
  expect(await refresh(root)).toEqual({ embedded: 1, removed: 0 });
  s2.stop(true);
});

test("nearest and similar: cosine order; the query carries the instruction, a page-like text does not", async () => {
  const s = fake(), root = await wiki(s.port!);
  await refresh(root);
  seen = [];
  const n = (await nearest(root, "chat", 2))!;
  expect(n.map((x) => x.path)).toEqual(["wiki/concepts/cat1.md", "wiki/concepts/cat2.md"]);
  expect(n[0].score).toBeGreaterThan(0.99);
  expect(seen[0]).toStartWith("Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:chat");
  seen = [];
  await nearest(root, "chien", 1, false);
  expect(seen).toEqual(["chien"]);
  expect((await similar(root, "wiki/concepts/cat1.md", 5))!.map((x) => x.path)).toEqual(["wiki/concepts/cat2.md", "wiki/concepts/dog.md"]);
  expect(await similar(root, "wiki/concepts/absent.md", 5)).toBeUndefined();
  s.stop(true);
});

test("search: BM25 and cosine fused by RRF; a vector-only hit has no snippet; without embeddings, BM25 alone", async () => {
  const s = fake(), root = await wiki(s.port!);
  await refresh(root);
  const hits = await search(root, "chat");
  expect(hits.map((h) => h.path)).toEqual(["wiki/concepts/cat1.md", "wiki/concepts/cat2.md", "wiki/concepts/dog.md"]); // both rankings, then vectors only
  expect(hits[0].snippet).toContain("«chat»");
  expect(hits[1]).toMatchObject({ title: "Félin", area: "wiki", snippet: "" });
  expect((await search(root, "chat", { limit: 2 })).map((h) => h.path)).toEqual(["wiki/concepts/cat1.md", "wiki/concepts/cat2.md"]);
  expect((await search(root, "chat", { titles: true })).map((h) => h.path)).toEqual(["wiki/concepts/cat1.md"]); // titles: no vectors
  s.stop(true);
  await Bun.write(join(root, "cortex.json"), "{}");
  expect((await search(root, "chat")).map((h) => h.path)).toEqual(["wiki/concepts/cat1.md"]);
});

test("search: server down or store missing = BM25 alone, at most one warning", async () => {
  const s = fake(), root = await wiki(s.port!);
  expect((await search(root, "chat")).map((h) => h.path)).toEqual(["wiki/concepts/cat1.md"]); // no store yet
  await refresh(root);
  s.stop(true);
  const err = console.error; const lines: string[] = [];
  console.error = (...a: unknown[]) => { lines.push(a.join(" ")); };
  try {
    expect((await search(root, "chat")).map((h) => h.path)).toEqual(["wiki/concepts/cat1.md"]);
    expect((await search(root, "chat")).map((h) => h.path)).toEqual(["wiki/concepts/cat1.md"]);
  } finally { console.error = err; }
  expect(lines.length).toBeLessThanOrEqual(1);
});

test("embed: the API key only goes to a URL the environment names", async () => {
  const s = fake(), url = `http://localhost:${s.port}/v1`, root = await wiki(s.port!);
  const env = { k: process.env.OPENAI_API_KEY, u: process.env.OPENAI_BASE_URL };
  try {
    process.env.OPENAI_API_KEY = "sk-test"; delete process.env.OPENAI_BASE_URL;
    await refresh(root); // base_url named by cortex.json only
    expect(auth.every((a) => a === null)).toBe(true);
    process.env.OPENAI_BASE_URL = url;
    await Bun.write(join(root, "cortex.json"), JSON.stringify({ embed: { dims: 3 } })); // URL from the environment
    await Bun.write(join(root, "wiki/concepts/dog.md"), page("Chien", "Autre."));
    await refresh(root);
    expect(auth.at(-1)).toBe("Bearer sk-test");
  } finally {
    if (env.k === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = env.k;
    if (env.u === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = env.u;
    s.stop(true);
  }
});
