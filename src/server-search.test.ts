import { beforeEach, expect, test } from "bun:test";
import { parseQuery } from "../site/src/lib/query";
import { buildTerms, createEngine, facetsOf, highlight, search } from "../site/src/lib/search-engine";
import { cachedHybrid, hybrid, judged, probe, resetServerSearch, rows, sections, semanticOnly, worthAsking, type Hybrid, type ServerHit } from "../site/src/lib/server-search";

// The site's client of /api/search (site/src/lib/server-search.ts): probe, caches, the single retry on 429, the mapping of the
// server's hits onto the site's pages. No server, no browser: `fetcher` is a stub.
const doc = (id: string, title: string, o: Record<string, unknown> = {}) =>
  ({ id, title, description: "", type: "Concept", tags: [] as string[], status: "stable", verified: true, text: "", ...o });
const hit = (id: string, o: Partial<ServerHit> = {}): ServerHit => ({ id, title: id, type: "Concept", extract: "", match: "lexical", ...o });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ctl = () => new AbortController();

async function engine(docs: ReturnType<typeof doc>[]) {
  const Fuse = (await import("fuse.js")).default;
  return createEngine({ docs, terms: buildTerms(docs), vocab: [] }, Fuse);
}

beforeEach(() => resetServerSearch());

test("probe: HEAD once, memoized; 404 means a static host; a network failure is not memoized for good", async () => {
  const calls: string[] = [];
  const f = (async (u: string, init?: RequestInit) => { calls.push(`${init?.method} ${u}`); return new Response(null, { status: 204 }); }) as unknown as typeof fetch;
  expect(await probe(f)).toBe(true);
  expect(await probe(f)).toBe(true);
  expect(calls).toEqual(["HEAD /api/search"]);

  resetServerSearch();
  expect(await probe((async () => new Response(null, { status: 404 })) as unknown as typeof fetch)).toBe(false);
  expect(await probe(f)).toBe(false); // the 404 is the answer for this page's life

  resetServerSearch();
  expect(await probe((async () => { throw new TypeError("offline"); }) as unknown as typeof fetch)).toBe(false);
});

test("hybrid: asks without judge, caches by query; judged: asks judge=1 and keeps `unavailable` out of the cache", async () => {
  const urls: string[] = [];
  const f = (async (u: string) => { urls.push(u); return json({ hits: [hit("a")], judged: false, reason: "unavailable" }); }) as unknown as typeof fetch;
  expect((await hybrid("alpha beta", ctl().signal, f)).hits.map((h) => h.id)).toEqual(["a"]);
  await hybrid(" alpha beta ", ctl().signal, f);
  expect(urls).toEqual(["/api/search?q=alpha%20beta&limit=50"]);
  expect(cachedHybrid("alpha beta")?.ignored).toEqual([]);

  const j = await judged("alpha beta", ctl().signal, f, 0);
  expect(j.reason).toBe("unavailable");
  expect(urls[1]).toBe("/api/search?q=alpha%20beta&limit=50&judge=1");
  await judged("alpha beta", ctl().signal, f, 0);
  expect(urls).toHaveLength(3); // asked again: a passing state is not remembered

  const ok = (async () => json({ hits: [hit("a", { group: "retained", relevance: 0.9 })], judged: true, model: "jev-1", ignored: ["is:fav"] })) as unknown as typeof fetch;
  const r = await judged("other", ctl().signal, ok, 0);
  expect(r).toMatchObject({ judged: true, model: "jev-1", ignored: ["is:fav"] });
  const never = (async () => { throw new Error("must come from the cache"); }) as unknown as typeof fetch;
  expect((await judged("other", ctl().signal, never, 0)).model).toBe("jev-1");
});

test("judged: a busy server (429) gets one new attempt, then gives up; an abort during the wait rejects", async () => {
  let n = 0;
  const once = (async () => (++n === 1 ? json({ error: "busy" }, 429) : json({ hits: [], judged: true }))) as unknown as typeof fetch;
  expect((await judged("q one", ctl().signal, once, 5)).judged).toBe(true);
  expect(n).toBe(2);

  n = 0;
  const always = (async () => { n++; return json({ error: "busy" }, 429); }) as unknown as typeof fetch;
  await expect(judged("q two", ctl().signal, always, 5)).rejects.toThrow();
  expect(n).toBe(2);

  n = 0;
  const c = ctl();
  const p = judged("q three", c.signal, always, 10_000);
  setTimeout(() => c.abort(), 20);
  await expect(p).rejects.toMatchObject({ name: "AbortError" });
  expect(n).toBe(1);
});

test("rows: the server's order, unknown pages left out, is:fav applied here (and only that operator)", async () => {
  const e = await engine([doc("concepts/a", "A", { text: "alpha" }), doc("concepts/b", "B", { text: "beta" }), doc("entities/c", "C", { type: "Entity" })]);
  const res: Hybrid = { hits: [hit("entities/c"), hit("concepts/gone"), hit("concepts/a", { match: "semantic" }), hit("concepts/b")], ignored: [] };
  expect(rows(e, parseQuery("alpha"), res, () => false).map((r) => r.doc.id)).toEqual(["entities/c", "concepts/a", "concepts/b"]);
  const fav = { ...res, ignored: ["is:fav"] };
  expect(rows(e, parseQuery("alpha is:fav"), fav, (id) => id === "concepts/a").map((r) => r.doc.id)).toEqual(["concepts/a"]);
  expect(rows(e, parseQuery('"phrase absent" alpha is:fav'), fav, () => true)).toHaveLength(3); // phrases were the server's to check
});

test("rows: is:fav inside a group or an OR branch is evaluated here with the whole Boolean structure of the query, the server's order kept", async () => {
  const e = await engine([doc("concepts/a", "A", { text: "alpha" }), doc("concepts/b", "B", { text: "alpha" }), doc("concepts/c", "C", { text: "beta" }), doc("concepts/d", "D", { text: "gamma" })]);
  const fav = { hits: [hit("concepts/d"), hit("concepts/c"), hit("concepts/b"), hit("concepts/a")], ignored: ["is:fav"] }; // what the server finds once is:fav is stripped
  const isFav = (id: string) => id === "concepts/a" || id === "concepts/c";
  const ids = (q: string) => rows(e, parseQuery(q), fav, isFav).map((r) => r.doc.id);
  expect(ids("(alpha is:fav)")).toEqual(["concepts/a"]); // b is alpha but not a favorite
  expect(ids("(beta OR alpha is:fav)")).toEqual(["concepts/c", "concepts/a"]); // beta, or alpha and favorite
  expect(ids("alpha OR is:fav")).toEqual(["concepts/c", "concepts/b", "concepts/a"]); // alpha, or favorite: d is neither
  expect(ids("-is:fav")).toEqual(["concepts/d", "concepts/b"]);
});

test("rows: `alpha OR is:fav` adds the favorites the server did not find, after its hits, without duplicates, and only those the whole query accepts", async () => {
  const e = await engine([doc("concepts/a", "A", { text: "alpha" }), doc("concepts/b", "B", { text: "beta" }), doc("concepts/c", "C", { text: "gamma" }), doc("concepts/d", "D", { text: "gamma" }), doc("entities/e", "E", { type: "Entity", text: "gamma" })]);
  const fav = { hits: [hit("concepts/a")], ignored: ["is:fav"] }; // alpha alone, once is:fav is stripped
  const isFav = (id: string) => id === "concepts/a" || id === "concepts/c" || id === "entities/e";
  const ids = (q: string, res = fav) => rows(e, parseQuery(q), res, isFav).map((r) => r.doc.id);
  expect(ids("alpha OR is:fav")).toEqual(["concepts/a", "concepts/c", "entities/e"]); // c and e: favorites without « alpha »; b, d: neither
  expect(rows(e, parseQuery("alpha OR is:fav"), fav, isFav).at(-1)!.hit.match).toBe("filter");
  expect(ids("alpha OR (is:fav type:entity)")).toEqual(["concepts/a"]); // `type:entity` stays in the server's query (it lists those pages): nothing to add
  expect(ids("alpha OR is:fav", { hits: [hit("concepts/c"), hit("concepts/a")], ignored: ["is:fav"] })).toEqual(["concepts/c", "concepts/a", "entities/e"]); // no duplicate
  expect(ids("(alpha is:fav)")).toEqual(["concepts/a"]); // no branch that is is:fav alone: nothing added
});

test("sections: retained, related, then the rest (below the bars and not judged) in the order given", () => {
  const e = [hit("a", { group: "other" }), hit("b", { group: "retained" }), hit("c", { group: "unjudged" }), hit("d", { group: "related" }), hit("f", { group: "retained" })]
    .map((h) => ({ doc: doc(h.id, h.id), hit: h }));
  const s = sections(e);
  expect([s.retained, s.related, s.other].map((x) => x.map((r) => r.doc.id).join(""))).toEqual(["bf", "d", "ac"]);
});

test("semanticOnly: only what the meaning alone found, never a page already shown, at most `max`", () => {
  const rs = ["a", "b", "c", "d", "e"].map((id, i) => ({ doc: doc(id, id), hit: hit(id, { match: i === 1 ? "both" : "semantic" }) }));
  expect(semanticOnly(rs, new Set(["c"]), 2).map((r) => r.doc.id)).toEqual(["a", "d"]);
});

test("worthAsking: free text only (a filter alone is the local index's business)", () => {
  expect([worthAsking("alpha"), worthAsking('"exact phrase"'), worthAsking("#tag"), worthAsking("type:source"), worthAsking("-bruit"), worthAsking("")]).toEqual([true, true, false, false, false, false]);
  expect(worthAsking("(#a OR beta)")).toBe(true);
});

test("highlight: words as word starts and phrases, escaped, accents kept; facetsOf counts a list of pages", () => {
  expect(highlight("La fenêtre de contexte <b>", parseQuery("fene cont"))).toBe("La <mark>fenêtre</mark> de <mark>contexte</mark> &lt;b&gt;");
  expect(highlight("a b c", parseQuery("zzz"))).toBe("a b c");
  expect(highlight("Alpha beta", parseQuery('"alpha beta"'))).toBe("<mark>Alpha beta</mark>");
  const f = facetsOf([doc("a", "A", { tags: ["x", "Y"], partial: true }), doc("b", "B", { type: "Source", status: "draft", verified: false, tags: ["x"] })], (id) => id === "a");
  expect(f).toMatchObject({ total: 2, type: { Concept: 1, Source: 1 }, status: { stable: 1, draft: 1 }, flags: { fav: 1, unverified: 1, review: 0, partial: 1 }, tags: [{ tag: "x", count: 2 }, { tag: "Y", count: 1 }] });
});

test("more matches than the server ranks: the rest stays reachable, with an exact total, and the counters cover the whole list", async () => {
  // 120 pages match; the server ranks SERVER_LIMIT of them, the rest must not vanish
  const docs = Array.from({ length: 120 }, (_, i) => doc(`concepts/p${String(i).padStart(3, "0")}`, `Page ${i}`, { text: "gizmo", tags: [i % 2 ? "odd" : "even"] }));
  const e = await engine(docs);
  const { SERVER_LIMIT } = await import("../site/src/lib/server-search");
  expect(SERVER_LIMIT).toBe(50);
  const res: Hybrid = { hits: docs.slice(60, 60 + SERVER_LIMIT).map((d) => hit(d.id)), ignored: [] };
  const p = parseQuery("gizmo");
  const ranked = rows(e, p, res, () => false);
  expect(ranked).toHaveLength(50);
  const ids = new Set(ranked.map((r) => r.doc.id));

  const rest = search(e, "gizmo", () => false, 30, ids);
  expect(rest.total).toBe(70); // exact, beyond the slice
  expect(rest.hits).toHaveLength(30);
  expect(rest.hits.every((h) => !ids.has(h.doc.id))).toBe(true);
  expect(ranked.length + rest.total).toBe(search(e, "gizmo", () => false, 1).total); // nothing lost, nothing counted twice
  expect(search(e, "gizmo", () => false, 200, ids).hits.map((h) => h.doc.id).filter((id) => ids.has(id))).toEqual([]);

  const f = facetsOf([...ranked.map((r) => r.doc), ...docs.filter((d) => !ids.has(d.id))], () => false);
  expect(f.total).toBe(120);
  expect(f.tags).toEqual([{ tag: "even", count: 60 }, { tag: "odd", count: 60 }]);
});
