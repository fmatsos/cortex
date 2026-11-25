import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSiteData } from "./export";
import { freeText, plainText, searchSite, withoutFav, type SearchHit } from "./search-api";
import { serve } from "./serve";
import { matches, parseQuery } from "../site/src/lib/query";
import { LIMITS } from "./limits";

// A wiki of five pages, a fake System One server (POST /v1/systemone: the verdicts, the calls and the calls in flight are recorded).
type Call = { state: { request: { query: string }; page: { title: string; description: string; text: string } }; questions: Record<string, { type: string; instructions: string }> };
let calls: Call[] = [], inflight = 0, peak = 0, delay = 0, verdict: (c: Call) => number | Response = () => 0.5;
const fake = () => Bun.serve({
  port: 0,
  async fetch(req) {
    const body = (await req.json()) as Call & { model: string };
    calls.push(body); inflight++; peak = Math.max(peak, inflight);
    try {
      if (delay) await Bun.sleep(delay);
      const v = verdict(body);
      return v instanceof Response ? v : Response.json({ model: body.model, answers: { relevant: { type: "noul", noul: v } }, usage: { input_tokens: 1, output_tokens: 0 } });
    } finally { inflight--; }
  },
});
/** An export that writes a page and succeeds: the site is not what these tests are about. */
const fakeExport = (_: string, out: string) => [process.execPath, "-e", `require("fs").mkdirSync(process.argv[1],{recursive:true});require("fs").writeFileSync(process.argv[1]+"/index.html","x")`, out];
const roots: string[] = [], servers: { stop(force?: boolean): unknown }[] = [];
afterEach(() => {
  calls = []; inflight = 0; peak = 0; delay = 0; verdict = () => 0.5;
  servers.splice(0).forEach((s) => s.stop(true));
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const page = (fm: Record<string, unknown>, body: string) => `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n\n${body}\n`;
const TITLES: Record<string, number> = { Chat: 0.9, Garfield: 0.4, Chien: 0.1 };
async function wiki(config: Record<string, unknown> = {}, port?: number) {
  const root = mkdtempSync(join(tmpdir(), "cortex-search-api-"));
  roots.push(root);
  mkdirSync(join(root, "wiki/concepts"), { recursive: true }); mkdirSync(join(root, "wiki/entities"), { recursive: true }); mkdirSync(join(root, "wiki/sources"), { recursive: true }); mkdirSync(join(root, "raw/x"), { recursive: true });
  const base_url = `http://localhost:${port}/v1`;
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ drafts: true, review: true, ...config, ...(port ? { judge: { base_url, ...(config.judge as object) } } : { judge: undefined }) }));
  const w = (path: string, fm: Record<string, unknown>, body: string) => writeFileSync(join(root, path), page({ type: "Concept", status: "stable", ...fm }, body));
  w("wiki/concepts/chat.md", { title: "Chat", description: "Le chat dort.", tags: ["animal", "pet"], verified: { by: "human:me", at: "2026-02-01" }, generated: { by: "agent", at: "2026-01-01" } }, "Le chat dort sur le canapé toute la journée.\n\n## Alimentation\n\nCroquettes.");
  w("wiki/concepts/chien.md", { title: "Chien", description: "Le chien aboie.", tags: ["animal"], status: "draft" }, "Le chien aboie et poursuit le chat.");
  w("wiki/entities/garfield.md", { type: "Entity", title: "Garfield", description: "Un matou.", tags: ["pet"], generated: { by: "agent", at: "2026-03-01" }, verified: { by: "human:me", at: "2026-02-01" } }, "Un chat orange, fan de **lasagnes**.");
  w("wiki/concepts/lasagnes.md", { type: "Synthesis", title: "Lasagnes", description: "Un plat.", tags: [] }, "Pâtes, sauce, fromage.");
  w("wiki/sources/src.md", { type: "Source", title: "Source du chat", description: "Un article.", tags: ["pet"], sources: [{ id: "s1", title: "Article", resource: "/raw/x/source.md" }] }, "Le chat en bref.");
  writeFileSync(join(root, "raw/x/source.md"), "---\nid: s1\ntitle: Article\npartial: true\n---\n\nTexte tronqué.\n");
  return root;
}
const ids = async (root: string, q: string, o: Parameters<typeof searchSite>[2] = {}) => ((await searchSite(root, q, o)).body.hits as SearchHit[]).map((h) => h.id);

test("operators: the site's own matcher on the site's own metadata (tags, type, status, review, groups, phrases, exclusions)", async () => {
  const root = await wiki();
  // the reference: what the site's search index says of each page, and the site's matcher over it
  const site = (await buildSiteData(root, () => {})).search.docs;
  const queries = [
    "#animal", "-#animal", "tag:pet", "type:entity", "type:entités", "-type:source", "status:draft", "statut:stable", "is:verified", "est:relue", "is:unverified", "is:review", "is:partial",
    "#pet type:concept", "(#animal OR #pet) -type:source", "#animal OR type:synthesis", "-(#animal OR #pet)", "#nope",
  ];
  for (const q of queries) {
    const expected = site.filter((d) => matches(d, parseQuery(q), () => false)).map((d) => d.id).sort();
    expect([q, (await ids(root, q, { limit: 50 })).sort()]).toEqual([q, expected]);
  }
  // the phrases and the exclusions are checked on the page text; the free words go through the search
  expect(await ids(root, `"chat orange"`)).toEqual(["entities/garfield"]);
  expect(await ids(root, `"chat orange" -lasagnes`)).toEqual([]);
  expect((await ids(root, "chat -lasagnes")).sort()).toEqual(["concepts/chat", "concepts/chien", "sources/src"]);
  expect((await ids(root, "chat #pet")).sort()).toEqual(["concepts/chat", "entities/garfield", "sources/src"]);
  expect((await ids(root, "chat #pet type:entity"))).toEqual(["entities/garfield"]);
  expect((await ids(root, "lasagnes OR chien")).sort()).toEqual(["concepts/chien", "concepts/lasagnes", "entities/garfield"]);
  // a query with operators only lists the pages by title, as the site does
  const only = (await searchSite(root, "#animal")).body.hits as SearchHit[];
  expect(only.map((h) => h.title)).toEqual(["Chat", "Chien"]);
  expect(only[0]).toMatchObject({ id: "concepts/chat", path: "wiki/concepts/chat.md", type: "Concept", match: "filter", extract: "Le chat dort." });
  // without `drafts` and `review` in cortex.json the site shows draft pages as stable and has no review state: so does the server
  writeFileSync(join(root, "cortex.json"), "{}");
  const bare = (await buildSiteData(root, () => {})).search.docs;
  for (const q of ["status:draft", "status:stable", "is:verified"]) expect([q, (await ids(root, q, { limit: 50 })).sort()]).toEqual([q, bare.filter((d) => matches(d, parseQuery(q), () => false)).map((d) => d.id).sort()]);
});

test("an OR branch without free text (`lasagnes OR type:source`) also lists the pages that satisfy it, after the words' hits", async () => {
  const root = await wiki();
  const hits = (await searchSite(root, "lasagnes OR type:source", { limit: 50 })).body.hits as SearchHit[];
  expect(hits.map((h) => h.id)).toEqual(["concepts/lasagnes", "entities/garfield", "sources/src"]); // the words' hits first, then the Source page that has no "lasagnes"
  expect(hits.map((h) => h.match)).toEqual(["lexical", "lexical", "filter"]);
  expect((await ids(root, "lasagnes OR #nope"))).toEqual(["concepts/lasagnes", "entities/garfield"]); // a branch that no page satisfies adds nothing
});

test("is:fav belongs to the browser: ignored, said so, never excluding anything; empty and oversized queries are refused", async () => {
  const root = await wiki();
  const r = await searchSite(root, "chat is:fav -is:fav (is:fav OR #pet)");
  expect(r.body.ignored).toEqual(["is:fav"]);
  expect((r.body.hits as SearchHit[]).map((h) => h.id).sort()).toEqual(["concepts/chat", "entities/garfield", "sources/src"]); // the group asks for #pet alone
  expect((await searchSite(root, "is:fav")).body).toMatchObject({ hits: [], ignored: ["is:fav"] });
  expect((await searchSite(root, "chat")).body.ignored).toBeUndefined();
  expect(withoutFav(parseQuery("-(is:fav)")).parsed.groups).toEqual([]);
  expect((await searchSite(root, "  ")).status).toBe(400);
  expect((await searchSite(root, "x".repeat(LIMITS.searchQueryChars + 1))).status).toBe(400);
});

test("free text: what the query looks for, without operators, exclusions and groups; plain text of a page", () => {
  expect(freeText(`Chat #pet type:entity -lasagnes "chat orange" (a OR b) -(c OR d) é`)).toBe("Chat chat orange a b é");
  expect(freeText("chain-of-thought")).toBe("chain-of-thought");
  expect(plainText("# T\n\nUn **chat** & [lien](/x) <b>gras</b>\n")).toBe("T Un chat & lien gras");
});

test("limit: 20 by default, never more than 50, one result per page, extract in plain text", async () => {
  const root = await wiki();
  for (let i = 0; i < 60; i++) writeFileSync(join(root, `wiki/concepts/m${i}.md`), page({ type: "Concept", title: `Matou ${i}`, description: "d", tags: [], status: "stable" }, "Le matou ronronne."));
  expect(((await searchSite(root, "matou")).body.hits as SearchHit[]).length).toBe(LIMITS.searchLimit);
  expect(((await searchSite(root, "matou", { limit: 500 })).body.hits as SearchHit[]).length).toBe(50);
  expect(((await searchSite(root, "matou", { limit: 3 })).body.hits as SearchHit[]).length).toBe(3);
  const hits = (await searchSite(root, "chat")).body.hits as SearchHit[];
  expect(new Set(hits.map((h) => h.id)).size).toBe(hits.length);
  expect(hits.find((h) => h.id === "concepts/chat")).toMatchObject({ match: "lexical", extract: expect.stringContaining("«".length ? "chat" : "") });
  expect(hits.every((h) => !/[«»]/.test(h.extract) && typeof h.score === "number")).toBe(true);
});

test("GET /api/search in serve: no-store, probe, method, query and limit validated; no judge unless asked", async () => {
  const root = await wiki();
  const server = await serve(root, { port: 0, sync: false, reviewer: "t", say: () => {}, embeddings: async () => undefined, exportCmd: fakeExport });
  servers.push(server);
  const at = (path: string, init?: RequestInit) => fetch(`http://localhost:${server.port}/api/search${path}`, init);
  const r = await at("?q=chat&limit=2");
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("no-store");
  const body = (await r.json()) as { hits: SearchHit[]; judged: boolean };
  expect(body.judged).toBe(false);
  expect(body.hits).toHaveLength(2);
  expect((await at("?q=chat&limit=abc")).status).toBe(200);
  const probe = await at("", { method: "HEAD" });
  expect([probe.status, probe.headers.get("cache-control")]).toEqual([204, "no-store"]);
  expect((await at("?q=chat", { method: "POST" })).status).toBe(405);
  const missing = await at("");
  expect([missing.status, missing.headers.get("cache-control")]).toEqual([400, "no-store"]);
  expect(((await (await at("?q=chat&judge=1")).json()) as { reason: string })).toMatchObject({ judged: false, reason: "not-configured" });
  expect((await at("?q=chat&judge=1", { headers: { origin: "http://evil" } })).status).toBe(403);
  expect((await at("?q=chat", { headers: { origin: "http://evil" } })).status).toBe(200); // reading without the judge: no cost
});

test("judge: the operators come first, the candidates are capped, no free text means no judge, the judge may be absent", async () => {
  const s = fake();
  servers.push(s);
  const root = await wiki({ judge: { search_candidates: 2 } }, s.port);
  verdict = (c) => TITLES[c.state.page.title] ?? 0.2;
  // `chat` finds four pages (Chat, Chien, Garfield, Source du chat): two are judged, the best of the hybrid ranking
  const all = (await searchSite(root, "chat", { judge: true })).body as { hits: SearchHit[]; unjudged: number };
  expect(calls).toHaveLength(2);
  expect(all.hits).toHaveLength(4);
  expect(all.unjudged).toBe(2);
  expect(all.hits.filter((h) => h.relevance === undefined).every((h) => h.group === "unjudged")).toBe(true);
  // the operators filter before the judge: one candidate left, one call, and what they drop is never paid for
  calls = [];
  const only = (await searchSite(root, "chat type:entity", { judge: true })).body as { hits: SearchHit[] };
  expect(calls).toHaveLength(1);
  expect(calls[0]!.state.page.title).toBe("Garfield");
  expect(only.hits.map((h) => h.id)).toEqual(["entities/garfield"]);
  // the judge reads the query without its operators, and a question made for a search
  expect(calls[0]!.state.request).toEqual({ query: "chat" });
  expect(calls[0]!.questions.relevant.type).toBe("noul");
  expect(calls[0]!.questions.relevant.instructions).toContain("`request.query`");
  expect(calls[0]!.questions.relevant.instructions).toContain("Yes:");
  expect(calls[0]!.questions.relevant.instructions).toContain("No:");
  // operators only: no judge
  calls = [];
  const none = (await searchSite(root, "#animal type:concept", { judge: true })).body;
  expect(none).toMatchObject({ judged: false, reason: "no-text" });
  expect(calls).toHaveLength(0);
  // nothing found: nothing to judge
  expect((await searchSite(root, "zzzinconnu", { judge: true })).body).toMatchObject({ judged: false, reason: "no-hits", hits: [] });
  expect(calls).toHaveLength(0);
  // without a `judge` block the same request answers with the search and says why
  const bare = await wiki({}, undefined);
  expect((await searchSite(bare, "chat", { judge: true })).body).toMatchObject({ judged: false, reason: "not-configured" });
});

test("judge: groups and order (retained, related by score, the rest in the hybrid order), model and relevance in the answer", async () => {
  const s = fake();
  servers.push(s);
  const root = await wiki({ judge: { model: "jev-test" } }, s.port);
  verdict = (c) => TITLES[c.state.page.title] ?? 0.2;
  const hybrid = await ids(root, "chat");
  const r = (await searchSite(root, "chat", { judge: true })).body as { hits: SearchHit[]; judged: boolean; model: string; unjudged: number };
  expect(r).toMatchObject({ judged: true, model: "jev-test", unjudged: 0 });
  expect(r.hits.slice(0, 2).map((h) => [h.title, h.group, h.relevance])).toEqual([["Chat", "retained", 0.9], ["Garfield", "related", 0.4]]);
  // the others (below the bars) keep the hybrid order
  const rest = r.hits.slice(2);
  expect(rest.map((h) => h.group)).toEqual(["other", "other"]);
  expect(rest.map((h) => h.id)).toEqual(hybrid.filter((i) => rest.some((h) => h.id === i)));
  // a limit smaller than the candidates still judges the candidates, then cuts
  expect(((await searchSite(root, "chat", { judge: true, limit: 2 })).body.hits as SearchHit[]).map((h) => h.title)).toEqual(["Chat", "Garfield"]);
  // the order among retained and related: by decreasing relevance, not hybrid
  verdict = (c) => ({ Chat: 0.6, Garfield: 0.95, Chien: 0.35, "Source du chat": 0.55 })[c.state.page.title] ?? 0.1;
  const tops = (await searchSite(await wiki({}, s.port), "chat", { judge: true })).body.hits as SearchHit[];
  expect(tops.map((h) => [h.title, h.group])).toEqual([["Garfield", "retained"], ["Chat", "retained"], ["Source du chat", "retained"], ["Chien", "related"]]);
});

test("judge: scores cached on disk as they arrive, an edited page judged again, the query normalized, one entry per purpose", async () => {
  const s = fake();
  servers.push(s);
  const root = await wiki({}, s.port);
  verdict = (c) => TITLES[c.state.page.title] ?? 0.2;
  await searchSite(root, "chat", { judge: true });
  const n = calls.length;
  expect(n).toBe(4);
  expect(existsSync(join(root, ".cortex/judge.db"))).toBe(true);
  await searchSite(root, "  CHAT ", { judge: true }); // same free text once normalized
  await searchSite(root, "chat #pet", { judge: false });
  expect(calls.length).toBe(n);
  const again = await searchSite(root, "chat -lasagnes", { judge: true }); // exclusions are not part of what is judged: same scores, one hit fewer or equal
  expect(calls.length).toBe(n);
  expect((again.body as { judged: boolean }).judged).toBe(true);
  // a page edited (what the judge reads of it): judged again, alone
  writeFileSync(join(root, "wiki/entities/garfield.md"), page({ type: "Entity", title: "Garfield", description: "Un matou.", tags: ["pet"], status: "stable" }, "Un chat orange, fan de pizza."));
  await searchSite(root, "chat", { judge: true });
  expect(calls.slice(n).map((c) => c.state.page.title)).toEqual(["Garfield"]);
  // another model: its own scores
  const before = calls.length;
  writeFileSync(join(root, "cortex.json"), JSON.stringify({ judge: { base_url: `http://localhost:${s.port}/v1`, model: "other" } }));
  await searchSite(root, "chat", { judge: true });
  expect(calls.length - before).toBe(4);
  // the site's questions and the search do not share entries: same words, two wordings
  const { relevantPages } = await import("./ask-site");
  const k = calls.length;
  await relevantPages(root, "chat");
  expect(calls.length).toBeGreaterThan(k);
});

test("judge: a failed call leaves that hit unjudged, the others are kept; every score is written as it arrives", async () => {
  const s = fake();
  servers.push(s);
  const root = await wiki({}, s.port);
  verdict = (c) => (c.state.page.title === "Garfield" ? new Response("boom", { status: 500 }) : TITLES[c.state.page.title] ?? 0.2);
  const r = (await searchSite(root, "chat", { judge: true })).body as { hits: SearchHit[]; judged: boolean; unjudged: number };
  expect(r.judged).toBe(true);
  expect(r.unjudged).toBe(1);
  expect(r.hits).toHaveLength(4);
  const g = r.hits.find((h) => h.title === "Garfield")!;
  expect([g.group, g.relevance]).toEqual(["unjudged", undefined]);
  expect(r.hits[0]).toMatchObject({ title: "Chat", group: "retained" });
  // the next search only asks again for the one that failed
  calls = []; verdict = () => 0.4;
  const next = (await searchSite(root, "chat", { judge: true })).body as { unjudged: number };
  expect(calls.map((c) => c.state.page.title)).toEqual(["Garfield"]);
  expect(next.unjudged).toBe(0);
  // a server that fails everything: the search answers as without the judge, saying why, and stops trying
  calls = [];
  const dead = await wiki({}, s.port);
  verdict = () => new Response("down", { status: 503 });
  const d = (await searchSite(dead, "chat", { judge: true })).body as { hits: SearchHit[]; judged: boolean; reason: string };
  expect([d.judged, d.reason, d.hits.length]).toEqual([false, "unavailable", 4]);
  // a server that stays down: the batch gives up after a few failures instead of trying every candidate
  const many = await wiki({ judge: { concurrency: 2, search_candidates: 12 } }, s.port);
  for (let i = 0; i < 12; i++) writeFileSync(join(many, `wiki/concepts/m${i}.md`), page({ type: "Concept", title: `Matou ${i}`, description: "d", tags: [], status: "stable" }, "Le matou ronronne."));
  calls = [];
  expect(((await searchSite(many, "matou", { judge: true })).body as { judged: boolean }).judged).toBe(false);
  expect(calls.length).toBeLessThan(12);
});

test("judge: at most `concurrency` calls at once, several of them in parallel", async () => {
  const s = fake();
  servers.push(s);
  const root = await wiki({ judge: { concurrency: 3, search_candidates: 12 } }, s.port);
  for (let i = 0; i < 10; i++) writeFileSync(join(root, `wiki/concepts/m${i}.md`), page({ type: "Concept", title: `Matou ${i}`, description: "d", tags: [], status: "stable" }, "Le matou ronronne."));
  delay = 40;
  const r = (await searchSite(root, "matou", { judge: true })).body as { judged: boolean };
  expect(r.judged).toBe(true);
  expect(calls).toHaveLength(11); // Garfield's description says « matou » too
  expect(peak).toBeLessThanOrEqual(3);
  expect(peak).toBeGreaterThan(1);
  // default: 6
  peak = 0; calls = [];
  const dflt = await wiki({}, s.port);
  for (let i = 0; i < 10; i++) writeFileSync(join(dflt, `wiki/concepts/m${i}.md`), page({ type: "Concept", title: `Matou ${i}`, description: "d", tags: [], status: "stable" }, "Le matou ronronne."));
  await searchSite(dflt, "matou", { judge: true });
  expect(peak).toBe(LIMITS.judgeConcurrency);
});

test("judge: one judged search at a time (429), through the lock and through the route", async () => {
  const s = fake();
  servers.push(s);
  const root = await wiki({}, s.port);
  verdict = () => 0.6;
  expect((await searchSite(root, "chat", { judge: true, lock: () => undefined })).status).toBe(429);
  expect(calls).toHaveLength(0);
  const server = await serve(root, { port: 0, sync: false, reviewer: "t", say: () => {}, embeddings: async () => undefined, exportCmd: fakeExport });
  servers.push(server);
  delay = 200;
  const url = `http://localhost:${server.port}/api/search?q=chat&judge=1`;
  const first = fetch(url);
  await Bun.sleep(100);
  const second = await fetch(url);
  expect(second.status).toBe(429);
  expect(second.headers.get("cache-control")).toBe("no-store");
  const ok = await first;
  expect(ok.status).toBe(200);
  expect(((await ok.json()) as { judged: boolean }).judged).toBe(true);
  expect((await fetch(url)).status).toBe(200); // the slot is free again
});

test("config: search thresholds validated (0 to 1, related not above retained), lowered at run time when the environment says otherwise", async () => {
  const { lintConfig } = await import("./config");
  const { judgeConfig } = await import("./judge");
  expect(lintConfig({ judge: { search_retained: 0.6, search_related: 0.2, search_candidates: 10, concurrency: 2 } })).toEqual([]);
  expect(lintConfig({ judge: { search_retained: 1.2 } })[0]!.level).toBe("error");
  expect(lintConfig({ judge: { search_candidates: 0 } })[0]!.level).toBe("error");
  expect(lintConfig({ judge: { concurrency: 1.5 } })[0]!.level).toBe("error");
  const bad = lintConfig({ judge: { search_retained: 0.4, search_related: 0.5 } });
  expect([bad[0]!.level, bad[0]!.msg]).toEqual(["error", expect.stringContaining("cannot exceed")]);
  expect(lintConfig({ judge: { search_retained: 0.2 } })[0]!.level).toBe("warning"); // the default related bar (0.3) is above it
  expect(lintConfig({ judge: { nope: 1 } })[0]!.msg).toContain("search_candidates");
  const root = await wiki({ judge: { search_retained: 0.2 } }, 1);
  expect(await judgeConfig(root)).toMatchObject({ searchRetained: 0.2, searchRelated: 0.2, searchCandidates: 20, concurrency: 6 });
  process.env.CORTEX_JEV_SEARCH_CANDIDATES = "7";
  try { expect(await judgeConfig(root)).toMatchObject({ searchCandidates: 7 }); } finally { delete process.env.CORTEX_JEV_SEARCH_CANDIDATES; }
});

test("score cache: old scores and the oldest beyond the cap are forgotten when it opens; an unwritable folder falls back to memory", async () => {
  const { Database } = await import("bun:sqlite");
  const { openScores } = await import("./judge-scores");
  const root = mkdtempSync(join(tmpdir(), "cortex-scores-")); roots.push(root);
  const first = openScores(root);
  first.set("fresh", 0.7);
  first.close();
  const db = new Database(join(root, ".cortex/judge.db"));
  const now = Date.now();
  db.run("INSERT INTO scores VALUES ('old', 0.1, ?)", [now - (LIMITS.judgeCacheDays + 1) * 86_400_000]);
  db.transaction(() => { for (let i = 0; i < LIMITS.judgeCacheRows; i++) db.run("INSERT INTO scores VALUES (?, 0.2, ?)", [`k${i}`, now - 60_000 - i]); })();
  db.close();
  const again = openScores(root);
  expect([again.get("fresh"), again.get("old"), again.get("k0"), again.get(`k${LIMITS.judgeCacheRows - 1}`)]).toEqual([0.7, undefined, 0.2, undefined]); // `fresh` is the newest, the last `k` the oldest
  again.close();
  // a file where the folder should be: nothing can be written, the scores still serve this call
  const blocked = mkdtempSync(join(tmpdir(), "cortex-scores-")); roots.push(blocked);
  writeFileSync(join(blocked, ".cortex"), "not a folder");
  const mem = openScores(blocked);
  mem.set("a", 0.3);
  expect(mem.get("a")).toBe(0.3);
  mem.close();
});
