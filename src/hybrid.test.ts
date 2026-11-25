import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintConfig } from "./config";
import { embed, embedConfig, embedHooks, embedProfile, keep, keepRelated, nearest, PROFILES, profileFor, refresh, resetEmbedState, similar } from "./embed";
import { search } from "./search";
import { buildIndex, sections } from "./search-index";

// The hybrid index (search-index.ts, search.ts, embed.ts) with the local provider replaced by a fake model: 4 dimensions,
// [ferment, astro, noise, dairy], so that what is close in meaning is known.
const count = (t: string, re: RegExp) => (t.toLowerCase().match(re) ?? []).length;
const toVec = (t: string) => {
  const v = [count(t, /chou|ferment|yaourt|bocal|bact[ée]rie|lait/g), count(t, /trou|horizon|lumi[èe]re|noir/g), t.startsWith("query:") ? 0 : 0.05, count(t, /yaourt|lait/g)];
  return t.startsWith("query:") && !v.some(Boolean) ? [1, 1, 1, 1] : v; // a query about nothing known points between everything
};
let seen: string[] = [];
embedHooks.local = async (texts) => { seen.push(...texts); return texts.map(toVec); };
const roots: string[] = [];
afterEach(() => { resetEmbedState(); seen = []; delete process.env.CORTEX_SQLITE_VEC; for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

const page = (title: string, body: string, desc = "D.") => `---\ntype: Concept\ntitle: ${title}\ndescription: ${desc}\n---\n${body}\n`;
async function wiki(embedCfg: object | null = { provider: "local", dims: 4 }) {
  const root = mkdtempSync(join(tmpdir(), "cortex-hybrid-"));
  roots.push(root);
  await Bun.write(join(root, "cortex.json"), JSON.stringify(embedCfg ? { embed: embedCfg } : {}));
  await Bun.write(join(root, "wiki/concepts/ferment.md"), page("Fermentation lactique", "Un procédé ancien.\n\n## Choucroute\n\nLe chou est salé et fermente en bocal.\n\n## Yaourt\n\nLe lait devient yaourt grâce aux bactéries.\n\n### Détail\n\nUne sous-section reste dans Yaourt.\n"));
  await Bun.write(join(root, "wiki/concepts/trou.md"), page("Trous noirs", "## Horizon\n\nLa lumière ne s'échappe pas.\n"));
  await Bun.write(join(root, "wiki/concepts/decentral.md"), page("Décentralisation", "Le fédivers et Mastodon."));
  await Bun.write(join(root, "raw/2026/s/source.md"), `---\ntitle: Brut\n---\nNotes sur le yaourt maison.\n`);
  return root;
}
const docs = (root: string) => {
  const db = new Database(join(root, ".cortex/search.db"), { readonly: true });
  try { return db.query("SELECT id, path, kind, title, (parent IS NOT NULL) AS child FROM docs ORDER BY id").all() as { id: number; path: string; kind: string; title: string; child: number }[]; }
  finally { db.close(); }
};

test("sections: one passage per ## section, code fences and sub-sections respected, the lead stays on the page", () => {
  expect(sections("Lead.\n\n## A\n\ntext a\n\n### sub\n\nmore\n\n```md\n## not a section\n```\n\n## [B](/x.md) `code`\n\nb\n\n## empty\n\n## C ##\n\nc")).toEqual([
    { title: "A", text: "text a\n\n### sub\n\nmore\n\n```md\n## not a section\n```" },
    { title: "B code", text: "b" }, { title: "C", text: "c" },
  ]);
  expect(sections("no section at all")).toEqual([]);
});

test("index: a page and a passage per section, raw sources as pages; only the changed file is indexed again", async () => {
  const root = await wiki(null);
  (await buildIndex(root)).close();
  const first = docs(root);
  expect(first.filter((d) => d.path === "wiki/concepts/ferment.md").map((d) => `${d.kind}:${d.title}`)).toEqual(["page:Fermentation lactique", "passage:Choucroute", "passage:Yaourt"]);
  expect(first.filter((d) => d.path === "wiki/concepts/trou.md").map((d) => d.kind)).toEqual(["page", "passage"]);
  expect(first.filter((d) => d.path === "wiki/concepts/decentral.md").map((d) => d.kind)).toEqual(["page"]);
  expect(first.filter((d) => d.path.startsWith("raw/")).map((d) => d.kind)).toEqual(["page"]); // no sections, no vectors for raw
  await Bun.write(join(root, "wiki/concepts/trou.md"), page("Trous noirs", "## Horizon\n\nLa lumière ne s'échappe pas.\n\n## Singularité\n\nUn point.\n"));
  (await buildIndex(root)).close();
  const next = docs(root);
  expect(next.filter((d) => d.path === "wiki/concepts/ferment.md").map((d) => d.id)).toEqual(first.filter((d) => d.path === "wiki/concepts/ferment.md").map((d) => d.id)); // untouched
  expect(next.filter((d) => d.path === "wiki/concepts/trou.md").map((d) => d.title)).toEqual(["Trous noirs", "Horizon", "Singularité"]);
  rmSync(join(root, "wiki/concepts/trou.md"));
  (await buildIndex(root)).close();
  expect(docs(root).some((d) => d.path.includes("trou"))).toBe(false);
});

test("words: accents folded, one result per page at the extract of its best section", async () => {
  const root = await wiki(null);
  const [h] = await search(root, "decentralisation", { in: "wiki" });
  expect(h).toMatchObject({ path: "wiki/concepts/decentral.md", title: "Décentralisation", match: "lexical" });
  const yaourt = await search(root, "yaourt", { in: "wiki" });
  expect(yaourt.map((x) => x.path)).toEqual(["wiki/concepts/ferment.md"]); // the page and its sections: one result
  expect(yaourt[0].title).toBe("Fermentation lactique"); // the page's title, not the section's
  expect(yaourt[0].snippet).toContain("«yaourt»");
  expect(yaourt[0].snippet).not.toContain("chou"); // the Yaourt section, not the Choucroute one
  expect((await search(root, "chou")).map((x) => x.path)).toEqual(["wiki/concepts/ferment.md"]);
  expect((await search(root, "yaourt")).map((x) => x.path)).toEqual(["wiki/concepts/ferment.md", "raw/2026/s/source.md"]); // wiki before raw
});

test("words: the last word of the query also matches the words it starts, in the body and in the titles", async () => {
  const root = await wiki(null);
  expect((await search(root, "yaou", { in: "wiki" })).map((h) => h.snippet.includes("«yaourt»"))).toEqual([true]); // being typed
  expect((await search(root, "decentral", { in: "wiki" })).map((h) => h.path)).toEqual(["wiki/concepts/decentral.md"]); // a title, accents folded
  expect((await search(root, "fédiv", { in: "wiki" })).map((h) => h.path)).toEqual(["wiki/concepts/decentral.md"]); // the body
  expect((await search(root, "un procédé anc", { in: "wiki" })).map((h) => h.path)).toEqual(["wiki/concepts/ferment.md"]); // after whole words
  expect(await search(root, "yaou le", { in: "wiki" })).toEqual([]); // a word of 2 letters is no prefix (and « yaou » alone is not a word)
  expect(await search(root, "yaou", { titles: true })).toEqual([]); // the duplicate check keeps whole words
});

test("title fragments: a typo in a word of 5 letters or more still finds the page; every word of the query must be there", async () => {
  const root = await wiki(null);
  expect((await search(root, "fermentaton")).map((x) => x.path)).toEqual(["wiki/concepts/ferment.md"]); // missing letter, no word matches
  expect((await search(root, "fermentaton lactique")).map((x) => x.path)).toEqual(["wiki/concepts/ferment.md"]);
  expect((await search(root, "decentralizaton")).map((x) => x.path)).toEqual(["wiki/concepts/decentral.md"]);
  expect(await search(root, "fermentaton quantique")).toEqual([]); // a word of the query is in no title
  expect(await search(root, "chat")).toEqual([]); // under 5 letters: exact only
  expect(await search(root, "fermentaton", { titles: true })).toEqual([]); // the duplicate check keeps exact words
});

test("hybrid: by meaning a page is found without any of the words, with the extract of its best section; a query unlike everything finds nothing", async () => {
  const root = await wiki();
  expect(await refresh(root)).toEqual({ embedded: 6, removed: 0 }); // 3 pages + 3 sections (an h3 is not one); raw is never embedded
  seen = [];
  const hits = await search(root, "produits laitiers", { in: "wiki" });
  expect(hits.map((h) => h.path)).toEqual(["wiki/concepts/ferment.md"]);
  expect(hits[0]).toMatchObject({ match: "semantic", title: "Fermentation lactique" });
  expect(hits[0].snippet).toStartWith("Le lait devient yaourt"); // the Yaourt section: the closest of the page, plain text
  expect(seen).toEqual(["query: produits laitiers"]); // e5: the query prefix
  const both = await search(root, "yaourt", { in: "wiki" });
  expect(both[0]).toMatchObject({ path: "wiki/concepts/ferment.md", match: "both" });
  expect((await search(root, "zzzzz", { in: "wiki" })).length).toBe(0);
  expect(await search(root, "yaourt", { in: "raw" })).toHaveLength(1); // raw: words only
});

test("the same answer with sqlite-vec and with the JS fallback", async () => {
  const root = await wiki();
  await refresh(root);
  const run = async () => ({
    hits: (await search(root, "produits laitiers", { in: "wiki" })).map((h) => [h.path, h.snippet]),
    near: await nearest(root, "bocal de chou", 3, false),
    similar: await similar(root, "wiki/concepts/ferment.md", 3),
  });
  const withVec = await run();
  process.env.CORTEX_SQLITE_VEC = "off";
  const ix = await buildIndex(root);
  expect(ix.vec).toBe(false);
  ix.close();
  expect(await run()).toEqual(withVec);
  // a refresh without the extension, then a search with it: vec_idx is rebuilt from the stored vectors
  await Bun.write(join(root, "wiki/concepts/trou.md"), page("Trous noirs", "## Horizon\n\nLa lumière du lait noir.\n"));
  await refresh(root);
  delete process.env.CORTEX_SQLITE_VEC;
  const again = await buildIndex(root);
  try { expect(again.vec).toBe(true); expect((again.db.query("SELECT count(*) AS n FROM vec_idx").get() as { n: number }).n).toBe((again.db.query("SELECT count(*) AS n FROM docs WHERE vkey IS NOT NULL").get() as { n: number }).n); }
  finally { again.close(); }
});

test("refresh: an edited page keeps the vectors of its unchanged sections; removed pages are counted; the old embeddings.json is deleted", async () => {
  const root = await wiki();
  await Bun.write(join(root, ".cortex/embeddings.json"), '{"model":"qwen3-embed","dims":256,"pages":{}}');
  expect(await refresh(root)).toEqual({ embedded: 6, removed: 0 });
  expect(existsSync(join(root, ".cortex/embeddings.json"))).toBe(false);
  expect(await refresh(root)).toEqual({ embedded: 0, removed: 0 });
  seen = [];
  await Bun.write(join(root, "wiki/concepts/ferment.md"), page("Fermentation lactique", "Un procédé ancien.\n\n## Choucroute\n\nLe chou est salé et fermente en bocal.\n\n## Yaourt\n\nLe lait devient yaourt grâce aux bactéries et au temps.\n"));
  expect((await refresh(root))!.embedded).toBe(2); // the page and Yaourt; Choucroute comes from the cache
  expect(seen.some((t) => t.startsWith("passage: Choucroute\n"))).toBe(false);
  rmSync(join(root, "wiki/concepts/trou.md"));
  expect(await refresh(root)).toEqual({ embedded: 0, removed: 1 });
  expect(docs(root).some((d) => d.path.includes("trou"))).toBe(false);
});

test("migration: an index of the first version is replaced, the vectors are recomputed", async () => {
  const root = await wiki();
  await Bun.write(join(root, ".cortex/search.db"), "");
  const v1 = new Database(join(root, ".cortex/search.db"));
  v1.run("CREATE VIRTUAL TABLE docs USING fts5(path UNINDEXED, area UNINDEXED, title, body)"); v1.run("CREATE TABLE files (path TEXT PRIMARY KEY, docid INTEGER, mtime REAL, size INTEGER)"); v1.run("PRAGMA user_version = 1");
  v1.close();
  expect((await search(root, "decentralisation")).map((h) => h.path)).toEqual(["wiki/concepts/decentral.md"]);
  expect(await refresh(root)).toEqual({ embedded: 6, removed: 0 });
});

test("another model or size: the vectors are made again; until then the search is by words, with one warning", async () => {
  const root = await wiki();
  await refresh(root);
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ embed: { provider: "local", dims: 4, model: "Xenova/multilingual-e5-base" } }));
  const err = console.error; const lines: string[] = [];
  console.error = (...a: unknown[]) => { lines.push(a.join(" ")); };
  try { expect((await search(root, "produits laitiers", { in: "wiki" })).length).toBe(0); expect(await nearest(root, "x", 3)).toBeUndefined(); }
  finally { console.error = err; }
  expect(lines.length).toBeLessThanOrEqual(1);
  expect(await refresh(root)).toEqual({ embedded: 6, removed: 0 });
  expect((await search(root, "produits laitiers", { in: "wiki" })).map((h) => h.path)).toEqual(["wiki/concepts/ferment.md"]);
});

test("no model (not downloaded, no runtime): words only, one warning, the search never fails", async () => {
  const root = await wiki();
  await refresh(root);
  const hook = embedHooks.local;
  embedHooks.local = async () => { throw new Error("the model could not be loaded"); };
  const err = console.error; const lines: string[] = [];
  console.error = (...a: unknown[]) => { lines.push(a.join(" ")); };
  try {
    expect((await search(root, "yaourt", { in: "wiki" })).map((h) => h.path)).toEqual(["wiki/concepts/ferment.md"]);
    expect((await search(root, "yaourt", { in: "wiki" })).map((h) => h.path)).toEqual(["wiki/concepts/ferment.md"]);
    await Bun.write(join(root, "wiki/concepts/trou.md"), page("Trous noirs", "Autre."));
    expect(await refresh(root)).toEqual({ embedded: 0, removed: 0 }); // does not throw either
  } finally { console.error = err; embedHooks.local = hook; }
  expect(lines.some((l) => /search is by words only/i.test(l))).toBe(true);
  expect(lines.filter((l) => /search is by words only/i.test(l)).length).toBeLessThanOrEqual(1);
  expect(lines.some((l) => l.includes('"openai"'))).toBe(true); // the way out is named
});

test("config: embed without a provider is the server mode and keeps its model; local is chosen explicitly; the schema stays strict", async () => {
  const root = await wiki({ base_url: "http://llama:8080/v1" });
  expect(await embedConfig(root)).toMatchObject({ provider: "openai", url: "http://llama:8080/v1", model: "qwen3-embed", dims: 256 });
  expect((await embedProfile(root))!.name).toBe("qwen3");
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ embed: { provider: "local" } }));
  expect(await embedConfig(root)).toMatchObject({ provider: "local", model: "Xenova/multilingual-e5-small", dims: 384, url: "" });
  expect((await embedConfig(root))!.threads).toBeGreaterThanOrEqual(1);
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ embed: { provider: "local", threads: 2, dims: 128 } }));
  expect(await embedConfig(root)).toMatchObject({ threads: 2, dims: 128 });
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ embed: { model: "Xenova/multilingual-e5-small", base_url: "http://x/v1" } })); // e5 behind a server
  expect(await embedConfig(root)).toMatchObject({ provider: "openai", model: "Xenova/multilingual-e5-small", dims: 384 });
  expect(lintConfig({ embed: { provider: "local", model: "m", dims: 384, threads: 4, base_url: null } })).toEqual([]);
  expect(lintConfig({ embed: { provider: "gguf" } })[0]).toMatchObject({ level: "error", msg: expect.stringContaining('unknown embed.provider "gguf"') });
  expect(lintConfig({ embed: { threads: 0 } })[0].level).toBe("error");
  expect(lintConfig({ embed: { provider: "local", base_url: "http://x" } })[0]).toMatchObject({ level: "warning" });
  expect(lintConfig({ embed: { threads: 2 } })[0]).toMatchObject({ level: "warning" });
});

test("embed: the local provider truncates to dims and renormalizes like the server one", async () => {
  const [a] = await embed(["chou"], { provider: "local", url: "", model: "m", dims: 2 });
  expect(Math.hypot(...a)).toBeCloseTo(1, 6);
  expect(a).toHaveLength(2);
});

test("model profiles: prefixes and thresholds depend on the model, not on the provider", async () => {
  expect(profileFor("qwen3-embed").name).toBe("qwen3");
  expect(profileFor("Xenova/multilingual-e5-small").name).toBe("e5");
  expect(profileFor("intfloat/multilingual-e5-large").name).toBe("e5");
  expect(PROFILES.qwen3.prefix.query).toStartWith("Instruct:");
  expect(PROFILES.qwen3.prefix.passage).toBe("");
  expect(PROFILES.e5.prefix).toEqual({ query: "query: ", passage: "passage: " });
  expect(PROFILES.qwen3.dups).toEqual({ cosine: 0.85, warn: 0.6 }); // unchanged for qwen3
  expect(PROFILES.e5.dups).toEqual({ cosine: 0.97, warn: 0.9 });
  const hits = (...s: number[]) => s.map((score, i) => ({ path: `p${i}`, score }));
  // qwen3: the fixed floor of 0.5
  expect(keep(hits(0.9, 0.55, 0.45), PROFILES.qwen3.related).map((h) => h.path)).toEqual(["p0", "p1"]);
  // e5: relative to the best, so a crowd just below the best is kept, unrelated pages (0.72-0.87) not
  expect(keep(hits(0.88, 0.86, 0.85, 0.83, 0.82, 0.81), PROFILES.e5.related).map((h) => h.path)).toEqual(["p0", "p1", "p2"]); // within 0.04 of the best (0.88), over the 0.8 floor, 5 at most
  expect(keep(hits(0.79, 0.78), PROFILES.e5.related)).toEqual([]);
  expect(keep(hits(0.95, 0.9, 0.88), PROFILES.e5.related).map((h) => h.path)).toEqual(["p0"]); // 0.9 and 0.88 are more than 0.04 under 0.95
  expect(keep([], PROFILES.e5.related)).toEqual([]);
  // through a wiki: the related pages use the rule of the configured model
  const root = await wiki();
  await refresh(root);
  const near = (await similar(root, "wiki/concepts/ferment.md", 5))!;
  expect(near.length).toBeGreaterThan(0);
  expect((await keepRelated(root, near)).every((n) => n.score >= 0.8)).toBe(true);
  expect(await keepRelated(await wiki(null), near)).toEqual([]);
});

test("page-like texts (duplicate check) are embedded as passages for e5, with no prefix for qwen3", async () => {
  const root = await wiki();
  await refresh(root);
  seen = [];
  const n = (await nearest(root, "Fermentation\nUn procédé de bocal", 2, false))!;
  expect(seen).toEqual(["passage: Fermentation\nUn procédé de bocal"]);
  expect(n[0].path).toBe("wiki/concepts/ferment.md"); // pages only, whole-page vectors
  expect(n.every((x) => !x.path.startsWith("raw/"))).toBe(true);
});

// A real run of the model, only where it is already downloaded (CORTEX_MODEL_CACHE, or the user's cache): never downloads in a test.
const cached = (() => { const dir = process.env.CORTEX_MODEL_CACHE ?? join(process.env.XDG_CACHE_HOME ?? join(process.env.HOME ?? "", ".cache"), "cortex/models"); return existsSync(join(dir, "Xenova/multilingual-e5-small/onnx/model_quantized.onnx")); })();
test.skipIf(!cached)("the real multilingual-e5-small: meaning finds a page with none of the words", async () => {
  const hook = embedHooks.local;
  embedHooks.local = undefined;
  try {
    const root = mkdtempSync(join(tmpdir(), "cortex-hybrid-")); roots.push(root);
    await Bun.write(join(root, "cortex.json"), JSON.stringify({ embed: { provider: "local" } }));
    await Bun.write(join(root, "wiki/concepts/a.md"), page("Fermentation lactique", "## Choucroute\n\nLe chou finement émincé est salé puis fermente plusieurs semaines dans un bocal fermé grâce aux bactéries lactiques."));
    await Bun.write(join(root, "wiki/concepts/b.md"), page("Trous noirs", "## Horizon\n\nLa gravité d'un trou noir est si intense que même la lumière ne peut s'en échapper."));
    expect((await refresh(root))!.embedded).toBe(4);
    const hits = await search(root, "comment conserver des légumes avec des microbes", { in: "wiki" });
    expect(hits[0]).toMatchObject({ path: "wiki/concepts/a.md", match: "semantic" });
    expect(hits[0].snippet).toContain("chou");
  } finally { embedHooks.local = hook; }
}, 60_000);

test("the index file stays small and in .cortex", async () => {
  const root = await wiki();
  await refresh(root);
  expect(statSync(join(root, ".cortex/search.db")).size).toBeLessThan(2_000_000);
});
