import { expect, test } from "bun:test";

test("search engine: inverted index (exact, prefix, typo), filters, phrases, ranking, instant at scale", async () => {
  const { buildTerms, createEngine, expand, rank } = await import("../site/src/lib/search-engine");
  const { parseQuery } = await import("../site/src/lib/query");
  const Fuse = (await import("fuse.js")).default;
  const doc = (id: string, title: string, text: string, tags: string[] = [], type = "Concept") =>
    ({ id, title, description: "", type, tags, status: "stable", verified: true, text });
  const docs = [
    doc("a", "Context rot", "La fenêtre de contexte se dégrade."),
    doc("b", "Harnais", "Un long texte. ".repeat(2000) + "Le contexte compte aussi ici.", ["llm"]),
    doc("c", "Décentralisation", "Le fédivers et Mastodon.", ["reseau"], "Entity"),
    doc("d", "Constructor", "Le constructor et toString d'une classe."), // words that are also Object properties
  ];
  const e = createEngine({ docs, terms: buildTerms(docs), vocab: [] }, Fuse);
  const ids = (q: string) => rank(e, parseQuery(q), () => false).map((r) => r.doc.id);
  expect(ids("contexte")).toEqual(["a", "b"]); // word at the end of a long page found; « Context » in the title ranks a first
  expect(ids("conte")).toContain("b"); // prefix while typing
  expect(ids("contexet")).toContain("a"); // typo
  expect(ids("dégrade")).toEqual(["a"]); // known word: no fuzziness (« degrade » does not bring back an approximate neighbor)
  expect([...expand(e, "fenetre").keys()]).toEqual(["fenetre"]);
  expect(ids("decentralisation")).toEqual(["c"]); // accents ignored
  expect(ids("contexte #llm")).toEqual(["b"]);
  expect(ids("contexte -fenetre")).toEqual(["b"]);
  expect(ids('"fediverse"')).toEqual([]);
  expect(ids('"le federivers"')).toEqual([]);
  expect(ids('"et mastodon"')).toEqual(["c"]);
  expect(ids("type:entity")).toEqual(["c"]);
  expect(ids("constructor")).toEqual(["d"]);
  expect(ids("tostring")).toEqual(["d"]);
  expect(ids("hasownproperty")).toEqual([]);

  // ~3,000 pages of ~1,500 characters: each query must stay instantaneous
  const words = Array.from({ length: 4000 }, (_, i) => `mot${i.toString(36)}`);
  const big = Array.from({ length: 3000 }, (_, i) => doc(`p${i}`, `Page ${i}`, Array.from({ length: 200 }, (_, k) => words[(i * 7 + k * 13) % words.length]).join(" ")));
  const E = createEngine({ docs: big, terms: buildTerms(big), vocab: [] }, Fuse);
  rank(E, parseQuery("motzz"), () => false); // builds the fuzzy index once
  let worst = 0;
  for (const q of ["mot1a", "mot2 mot3b", "motab", "page 12", "mot1q mot2r mot3s"]) {
    const t = performance.now(); rank(E, parseQuery(q), () => false); worst = Math.max(worst, performance.now() - t);
  }
  expect(worst).toBeLessThan(200); // ~10 ms in practice; margin for a loaded machine (the old engine: ~900 ms)
});

test("search engine: title suggestions and results obey the same conditions, exact total", async () => {
  const { buildTerms, createEngine, rank, search, suggest, suggestTitles } = await import("../site/src/lib/search-engine");
  const { parseQuery } = await import("../site/src/lib/query");
  const Fuse = (await import("fuse.js")).default;
  const doc = (id: string, title: string, tags: string[], type = "Concept", text = "") =>
    ({ id, title, description: "", type, tags, status: "stable", verified: true, text });
  const docs = [
    doc("a", "Harnais d'agent", ["llm"]),
    doc("b", "Hermes Agent", ["outil"], "Entity", "un agent qui apprend"),
    doc("c", "Harnais de test", ["llm"]),
    doc("d", "Agent Skills", ["llm"], "Concept", "le format open source des agents"),
    ...Array.from({ length: 120 }, (_, i) => doc(`p${i}`, `Page ${i}`, [], "Source", "bruit")),
  ];
  const e = createEngine({ docs, terms: buildTerms(docs), vocab: [] }, Fuse);
  const none = (_id: string) => false, fav = (id: string) => id === "d";
  const titles = (q: string, isFav = none) => suggestTitles(e, parseQuery(q), isFav).map((d) => d.id);
  const found = (q: string, isFav = none) => rank(e, parseQuery(q), isFav).map((r) => r.doc.id);

  expect(titles("har")).toEqual(["a", "c"]);
  expect(titles("har -agent")).toEqual(["c"]); // exclusion: no more « Harnais d'agent »
  expect(titles("-agent")).toEqual([]); // without a free word, no title
  expect(titles("#llm har")).toEqual(["a", "c"]);
  expect(titles("type:entity age")).toEqual(["b"]); // structured filter
  expect(titles('age "format open"')).toEqual(["d"]); // exact phrase
  expect(titles("age is:fav", fav)).toEqual(["d"]);
  expect(titles("age is:fav")).toEqual([]);
  // consistency: every suggested title appears among the results of the same query
  for (const q of ["har", "har -agent", "#llm har", "type:entity age", 'age "format open"', "-#llm age", "age -type:concept"])
    for (const id of titles(q)) expect(found(q)).toContain(id);
  expect(suggest(e, "har -agent", none).titles.map((d) => d.id)).toEqual(["c"]);

  // exact total beyond the limit, excerpts only up to the limit
  const r = search(e, "type:source", none, 50);
  expect([r.hits.length, r.total]).toEqual([50, 120]);
  expect(search(e, "  ", none, 50)).toEqual({ hits: [], total: 0 });
});
