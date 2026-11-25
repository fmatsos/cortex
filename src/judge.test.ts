import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintConfig } from "./config";
import { refresh } from "./embed";
import { jevEnv, judge, judgeConfig } from "./judge";
import { LIMITS } from "./limits";
import { newPageCtx } from "./naming";
import { openWiki } from "./context";
import { routeCandidates } from "./agent";
import { compilePrompt } from "./prompts";

// Fake servers: llama.cpp's /embeddings (3 meaningful dims: "chat", "chien", "mi-chat" in between, anything else) and
// /systemone (TypeSafe's format), whose verdicts each test sets.
const topic = (t: string) => (/mi-chat/i.test(t) ? [0.8, 0.6, 0] : /chat|f[ée]lin|minou/i.test(t) ? [1, 0, 0] : /chien/i.test(t) ? [0, 1, 0] : [0, 0, 1]);
type Body = { model: string; state: any; questions: Record<string, { type: string; instructions: string; criteria?: Record<string, string> }> };
let calls: { auth: string | null; body: Body }[] = [], verdict: (b: Body) => Response | object = () => ({}), embedCalls = 0;
function fake() {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url), b = (await req.json()) as any;
      if (url.pathname === "/v1/embeddings") {
        embedCalls++;
        return Response.json({ data: (b.input as string[]).map((t, index) => ({ index, embedding: [...topic(t), 0.1, 0.1] })) });
      }
      if (url.pathname !== "/v1/systemone") return new Response("no", { status: 404 });
      calls.push({ auth: req.headers.get("authorization"), body: b });
      const r = verdict(b);
      return r instanceof Response ? r : Response.json({ model: b.model, answers: r, usage: { input_tokens: 1, output_tokens: 0 } });
    },
  });
}
const choice = (pick: string, p: number, n: number) => ({ type: "choice", choice: pick, confidence: p, probabilities: { ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i + 1}`, 0])), none: 0, [pick]: p } });
const page = (title: string, description: string, type = "Concept") => `---\ntype: ${type}\ntitle: ${title}\ndescription: ${description}\n---\nx\n`;
const roots: string[] = [];
async function wiki(port: number, cfg: Record<string, unknown> = { judge: {} }) {
  const root = mkdtempSync(join(tmpdir(), "cortex-judge-"));
  roots.push(root);
  const base_url = `http://localhost:${port}/v1`;
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ embed: { base_url, dims: 3 }, ...(cfg.judge ? { judge: { base_url, ...(cfg.judge as object) } } : {}) }));
  await Bun.write(join(root, "wiki/concepts/cat1.md"), page("Chat", "Le chat dort."));
  await Bun.write(join(root, "wiki/concepts/cat2.md"), page("Félin", "Un animal domestique."));
  await Bun.write(join(root, "wiki/concepts/dog.md"), page("Chien", "Le chien aboie."));
  await Bun.write(join(root, "wiki/entities/cat3.md"), page("Garfield", "Un chat orange.", "Entity"));
  await refresh(root);
  return root;
}
afterEach(() => { calls = []; embedCalls = 0; verdict = () => ({}); for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
const create = (root: string, type: string, title: string, description: string, init: { force?: boolean; notes?: string[] } = {}) =>
  newPageCtx(openWiki(root), type, title, new Date(), { fm: { description }, ...init });

test("judge config: absent = off, defaults, same base_url rule as embed, strict keys", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-judge-")); roots.push(root);
  await Bun.write(join(root, "cortex.json"), "{}");
  expect(await judgeConfig(root)).toBeUndefined();
  expect(await judge(root, "s", { q: { type: "noul", instructions: "?" } })).toBeUndefined();
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ base_url: "http://elsewhere/v1/", judge: {} }));
  expect(await judgeConfig(root)).toMatchObject({ url: "http://elsewhere/v1", model: "d3-mini", key: undefined });
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ base_url: "http://elsewhere/v1/", judge: { base_url: "http://j/v1", model: "x" } }));
  expect(await judgeConfig(root)).toMatchObject({ url: "http://j/v1", model: "x" });
  const env = { u: process.env.CORTEX_JEV_BASE_URL, k: process.env.CORTEX_JEV_API_KEY };
  try { // $CORTEX_JEV_API_KEY only to $CORTEX_JEV_BASE_URL
    process.env.CORTEX_JEV_BASE_URL = "https://api.typesafe.ai/v1/"; process.env.CORTEX_JEV_API_KEY = "sk-judge";
    await Bun.write(join(root, "cortex.json"), JSON.stringify({ base_url: "http://elsewhere/v1/", judge: { model: "jev-1.13.0" } }));
    expect(await judgeConfig(root)).toMatchObject({ url: "https://api.typesafe.ai/v1", key: "sk-judge", model: "jev-1.13.0" });
    await Bun.write(join(root, "cortex.json"), JSON.stringify({ judge: { base_url: "https://api.typesafe.ai/v1" } }));
    expect((await judgeConfig(root))?.key).toBe("sk-judge");
    await Bun.write(join(root, "cortex.json"), JSON.stringify({ judge: { base_url: "http://evil/v1" } }));
    expect(await judgeConfig(root)).toMatchObject({ url: "http://evil/v1", key: undefined });
  } finally {
    for (const [k, v] of [["CORTEX_JEV_BASE_URL", env.u], ["CORTEX_JEV_API_KEY", env.k]] as const) v === undefined ? delete process.env[k] : process.env[k] = v;
  }
});

test("judge settings: cortex.json, else $CORTEX_JEV_<NAME>, else limits.ts; an invalid env value is ignored", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-judge-")); roots.push(root);
  const names = ["CORTEX_JEV_MODEL", "CORTEX_JEV_ROUTE_YES", "CORTEX_JEV_DUP_YES", "CORTEX_JEV_ROUTE_CANDIDATES", "CORTEX_JEV_ROUTE_CHARS"];
  const saved = names.map((k) => process.env[k]);
  try {
    for (const k of names) delete process.env[k];
    await Bun.write(join(root, "cortex.json"), JSON.stringify({ judge: {} }));
    expect(await judgeConfig(root)).toMatchObject({ model: "d3-mini", routeYes: LIMITS.routeYes, dupYes: LIMITS.dupJudge, routeCandidates: LIMITS.routeCandidates, dupCandidates: LIMITS.dupCandidates, routeChars: LIMITS.routeChars });
    Object.assign(process.env, { CORTEX_JEV_MODEL: "jev-1.13.0", CORTEX_JEV_ROUTE_YES: "0.65", CORTEX_JEV_DUP_YES: "1.5", CORTEX_JEV_ROUTE_CANDIDATES: "3.5", CORTEX_JEV_ROUTE_CHARS: "4000" });
    expect(await judgeConfig(root)).toMatchObject({ model: "jev-1.13.0", routeYes: 0.65, dupYes: LIMITS.dupJudge, routeCandidates: LIMITS.routeCandidates, routeChars: 4000 });
    await Bun.write(join(root, "cortex.json"), JSON.stringify({ judge: { model: "m", route_yes: 0.4, dup_candidates: 7 } }));
    expect(await judgeConfig(root)).toMatchObject({ model: "m", routeYes: 0.4, dupCandidates: 7, routeChars: 4000 });
  } finally {
    names.forEach((k, i) => saved[i] === undefined ? delete process.env[k] : process.env[k] = saved[i]);
  }
  expect(lintConfig({ judge: { route_yes: 0.5, route_chars: 2000 } })).toEqual([]);
  expect(lintConfig({ judge: { route_yes: 2 } })[0].level).toBe("error");
  expect(lintConfig({ judge: { dup_candidates: 0 } })[0].level).toBe("error");
  expect(lintConfig({ judge: { model: "m", base_url: null } })).toEqual([]);
  expect(lintConfig({ judge: { nope: 1 } })[0].level).toBe("error");
});

test("judge: POST <base>/systemone with model, state and questions; answers by id; a malformed answer or a down server = undefined, then left alone", async () => {
  const s = fake(), root = await wiki(s.port!);
  verdict = () => ({ a: { type: "noul", noul: 0.9 } });
  const logged: string[] = [], error = console.error;
  console.error = (m: string) => { logged.push(String(m)); };
  try {
    expect(await judge(root, { x: 1 }, { a: { type: "noul", instructions: "Is it?" } }, undefined, "test call")).toEqual({ a: { type: "noul", noul: 0.9 } });
    expect(calls[0].body).toEqual({ model: "d3-mini", state: { x: 1 }, questions: { a: { type: "noul", instructions: "Is it?" } } });
    verdict = () => ({ a: { type: "choice", choice: "x" } }); // not what was asked
    expect(await judge(root, "s", { a: { type: "noul", instructions: "?" } })).toBeUndefined();
    const n = calls.length;
    expect(await judge(root, "s", { a: { type: "noul", instructions: "?" } })).toBeUndefined();
    expect(calls.length).toBe(n); // cooldown: the server is not called again
  } finally { console.error = error; }
  // one log line per call: what, model, server, answers; then the failure and the skipped call
  expect(logged[0]).toMatch(/^judge: test call, d3-mini at localhost:\d+, 1 question, [\d.]+ s, \d+ tokens: a 0\.90$/);
  expect(logged.some((l) => /judge: judge, .*: failed \(.*no usable answer/.test(l))).toBe(true);
  expect(logged.at(-1)).toMatch(/: skipped \(server down a moment ago\)$/);
  s.stop(true);
});

test("duplicate guard: the judge picks a close page → refused; picks none → created; unsure → created with a note", async () => {
  const s = fake(), root = await wiki(s.port!);
  verdict = (b) => ({ dup: choice("p1", 0.95, Object.keys(b.questions.dup.criteria!).length - 1) });
  const err = await create(root, "Concept", "Minou", "Un petit chat.").catch((e: Error) => e.message);
  expect(err).toMatch(/^a Concept page covers the same subject: wiki\/concepts\/cat[12]\.md « (Chat|Félin) »/);
  const sent = calls[0].body;
  expect(sent.state.new_page).toEqual({ type: "Concept", title: "Minou", description: "Un petit chat." });
  expect(sent.state.candidates.map((c: { title: string }) => c.title).sort()).toEqual(["Chat", "Chien", "Félin"].sort()); // same type only: the Entity is left out
  expect(Object.keys(sent.questions.dup.criteria!)).toEqual(["p1", "p2", "p3", "none"]);

  verdict = () => ({ dup: choice("none", 0.95, 3) });
  const notes: string[] = [];
  expect(await create(root, "Concept", "Minou", "Un petit chat.", { notes })).toMatch(/^wiki\/concepts\//);
  expect(notes).toEqual([]);

  verdict = () => ({ dup: choice("p2", 0.5, 3) });
  const unsure: string[] = [];
  await create(root, "Concept", "Minette", "Un petit chat.", { notes: unsure });
  expect(unsure[0]).toMatch(/^close in meaning: wiki\/concepts\/cat1\.md « Chat »/);
  s.stop(true);
});

test("duplicate guard without the judge: a very close cosine refuses, a close one warns, a distant one passes; --force, Source and another type skip it", async () => {
  const s = fake(), root = await wiki(s.port!, {});
  expect(await create(root, "Concept", "Minou", "chat").catch((e: Error) => e.message)).toContain("covers the same subject: wiki/concepts/cat");
  const notes: string[] = [];
  await create(root, "Concept", "Entre deux", "mi-chat", { notes });
  expect(notes[0]).toContain("close in meaning: "); // cosine 0.8 with « chat »: under dups.cosine (0.9), over dups.warn (0.75)
  const far: string[] = [];
  await create(root, "Concept", "Zébu", "Un bovin.", { notes: far });
  expect(far).toEqual([]);
  expect(await create(root, "Concept", "Minet", "chat", { force: true })).toMatch(/^wiki\/concepts\//);
  expect(await create(root, "Source", "Mimi", "chat")).toMatch(/^wiki\/sources\//);
  expect(await create(root, "Entity", "Rex", "chien")).toMatch(/^wiki\/entities\//); // the Concept « Chien » is not an Entity
  s.stop(true);
});

test("duplicate guard: embeddings or judge down = the page is created as before", async () => {
  const s = fake(), root = await wiki(s.port!);
  s.stop(true);
  expect(await create(root, "Concept", "Minou", "chat")).toMatch(/^wiki\/concepts\//);
});

test("ingest routing: the judge keeps the near pages the source brings something to; none without embeddings or judge", async () => {
  const s = fake(), root = await wiki(s.port!);
  verdict = (b) => Object.fromEntries(Object.keys(b.questions).map((id) => [id, { type: "noul", noul: b.state.pages[Number(id.slice(1))].title === "Chat" ? 0.9 : 0.1 }]));
  const raw = { path: "raw/2026/11/a/source.md", fm: { title: "Les chats" }, body: "Un long texte sur le chat. ".repeat(500) } as any;
  expect(await routeCandidates(openWiki(root), raw)).toEqual(["/wiki/concepts/cat1.md « Chat »"]);
  const { body } = calls[0];
  expect(body.state.source.length).toBeLessThanOrEqual(1501);
  expect(body.state.pages.map((p: { title: string }) => p.title).sort()).toEqual(["Chat", "Chien", "Félin", "Garfield"]); // Concept and Entity pages
  expect(Object.keys(body.questions)).toEqual(["p0", "p1", "p2", "p3"]);
  expect(body.questions.p0.type).toBe("noul");
  // no judge configured: nothing to say
  const bare = await wiki(s.port!, {});
  expect(await routeCandidates(openWiki(bare), raw)).toEqual([]);
  // no embeddings: the judge is not even asked
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ judge: { base_url: `http://localhost:${s.port}/v1` } }));
  calls = [];
  expect(await routeCandidates(openWiki(root), raw)).toEqual([]);
  expect(calls).toEqual([]);
  s.stop(true);
});

test("compile prompt: the candidates are listed when there are some, nothing (and no stray space) otherwise", () => {
  const o = { agentFile: "CLAUDE.md", source: "/raw/x/source.md", id: "x" };
  expect(compilePrompt({ ...o, candidates: ["/wiki/concepts/a.md « A »", "/wiki/entities/b.md « B »"] })).toContain("probably updates (judged by meaning; look at them before creating any page): /wiki/concepts/a.md « A »; /wiki/entities/b.md « B ».");
  expect(compilePrompt(o)).toBe(compilePrompt({ ...o, candidates: [] }));
  expect(compilePrompt(o)).not.toMatch(/probably updates|\{\{|  /);
});

test("site question: each page judged alone, retained and related by threshold, scores cached, a failure falls back to no judge", async () => {
  const { relevantPages } = await import("./ask-site");
  const server = fake();
  try {
    const root = await wiki(server.port!, { judge: { ask_retained: 0.6, ask_related: 0.3 } });
    verdict = (b) => ({ relevant: { type: "noul", noul: b.state.page.title === "Chat" ? 0.9 : b.state.page.title === "Félin" ? 0.4 : 0.1 } });
    const core = await relevantPages(root, "Le chat dort-il ?", "Et le chien ?");
    expect(core?.retained.map((r) => r.id)).toEqual(["concepts/cat1"]);
    expect(core?.related.map((r) => r.id)).toEqual(["concepts/cat2"]);
    expect(core?.documents[0]?.text).toBe("x");
    expect(calls.every((c) => Object.keys(c.body.questions).length === 1 && c.body.state.request.earlier === "Et le chien ?")).toBe(true);
    const n = calls.length;
    expect(n).toBeGreaterThanOrEqual(2);
    await relevantPages(root, "Le chat dort-il ?", "Et le chien ?");
    expect(calls.length).toBe(n); // the same question: no new call
    verdict = () => new Response("down", { status: 500 });
    expect(await relevantPages(root, "Le félin mange-t-il ?")).toBeUndefined();
  } finally { server.stop(true); }
});

test("site question: a page sharing only some words with the question is a candidate, with or without vectors pushing other pages", async () => {
  const { relevantPages } = await import("./ask-site");
  const server = fake();
  try {
    const question = "Peut-on faire tourner un modèle sur une vieille carte graphique ?";
    for (const withVectors of [false, true]) {
      const root = mkdtempSync(join(tmpdir(), "cortex-judge-")); roots.push(root);
      const base_url = `http://localhost:${server.port}/v1`;
      await Bun.write(join(root, "cortex.json"), JSON.stringify({ ...(withVectors ? { embed: { base_url, dims: 3 } } : {}), judge: { base_url, ask_candidates: 4 } }));
      // the fake vectors are all equal: the semantic ranking falls back to index order, so the fillers (a-*) fill the candidates
      for (let i = 0; i < 6; i++) await Bun.write(join(root, `wiki/concepts/a-${i}.md`), page(`Sonde ${i}`, "Une sonde spatiale."));
      await Bun.write(join(root, "wiki/concepts/z-gtx.md"), page("Qwen3.6 35B sur une GTX 1070", "Faire tourner un modèle de langage sur une vieille carte."));
      if (withVectors) await refresh(root);
      verdict = () => ({ relevant: { type: "noul", noul: 0.1 } });
      calls = [];
      await relevantPages(root, question);
      const judged = calls.map((c) => c.body.state.page.title);
      expect(judged).toContain("Qwen3.6 35B sur une GTX 1070");
      expect(judged.length).toBeLessThanOrEqual(4);
    }
  } finally { server.stop(true); }
});

test("site question: one failed call no longer cancels the batch (the judged pages count), scores persist in .cortex/judge.db", async () => {
  const { relevantPages } = await import("./ask-site");
  const server = fake();
  try {
    const root = await wiki(server.port!, { judge: { ask_retained: 0.6, ask_related: 0.3 } });
    verdict = (b) => b.state.page.title === "Félin" ? new Response("boom", { status: 500 }) : ({ relevant: { type: "noul", noul: b.state.page.title === "Chat" ? 0.9 : 0.4 } });
    const core = await relevantPages(root, "Le chat dort-il ?");
    expect(core?.retained.map((r) => r.id)).toEqual(["concepts/cat1"]); // Félin is left out, not fatal
    expect(core?.related.map((r) => r.id)).not.toContain("concepts/cat2");
    expect(core?.related.length).toBeGreaterThan(0);
    const first = calls.length;
    expect(existsSync(join(root, ".cortex/judge.db"))).toBe(true);
    // the same question again: the pages already judged are not asked again, the failed one is (the server was not marked down)
    verdict = (b) => ({ relevant: { type: "noul", noul: b.state.page.title === "Félin" ? 0.5 : 0.1 } });
    const again = await relevantPages(root, "Le chat dort-il ?");
    expect(calls.slice(first).map((c) => c.body.state.page.title)).toEqual(["Félin"]);
    expect(again?.retained.map((r) => r.id)).toEqual(["concepts/cat1"]);
    expect(again?.related.map((r) => r.id)).toContain("concepts/cat2");
    // every page failing: no core, the agent works from the search hits as before
    verdict = () => new Response("down", { status: 503 });
    expect(await relevantPages(root, "Le félin mange-t-il ?")).toBeUndefined();
  } finally { server.stop(true); }
});

// The environment of the judge: $CORTEX_JEV_*, with the former $CORTEX_JUDGE_* names accepted (deprecated) when the new one is absent.
const ENV_NAMES = ["BASE_URL", "API_KEY", "MODEL", "ROUTE_YES"].flatMap((n) => [`CORTEX_JEV_${n}`, `CORTEX_JUDGE_${n}`]);
async function withEnv(vars: Record<string, string>, fn: (lines: string[]) => Promise<void>) {
  const saved = ENV_NAMES.map((k) => process.env[k]), lines: string[] = [], error = console.error;
  console.error = (...a: unknown[]) => { lines.push(a.join(" ")); };
  try { for (const k of ENV_NAMES) delete process.env[k]; Object.assign(process.env, vars); await fn(lines); }
  finally { console.error = error; ENV_NAMES.forEach((k, i) => saved[i] === undefined ? delete process.env[k] : process.env[k] = saved[i]); }
}
const cfgRoot = async (judgeCfg: object = {}) => {
  const root = mkdtempSync(join(tmpdir(), "cortex-judge-")); roots.push(root);
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ judge: judgeCfg }));
  return root;
};

test("jevEnv: the new name; the old name as a fallback with one warning per variable; the new name wins", async () => {
  await withEnv({ CORTEX_JEV_UNIT_A: " new ", CORTEX_JUDGE_UNIT_A: "old", CORTEX_JUDGE_UNIT_B: "legacy" }, async (lines) => {
    expect(jevEnv("UNIT_A")).toEqual({ value: "new", name: "CORTEX_JEV_UNIT_A", old: false });
    expect(lines).toEqual([]); // the old one is not even looked at, so no warning
    for (let i = 0; i < 3; i++) expect(jevEnv("UNIT_B")).toEqual({ value: "legacy", name: "CORTEX_JUDGE_UNIT_B", old: true });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("$CORTEX_JUDGE_UNIT_B is deprecated, use $CORTEX_JEV_UNIT_B");
    expect(jevEnv("UNIT_NONE")).toBeUndefined();
    process.env.CORTEX_JUDGE_UNIT_C = "  "; // blank = unset
    expect(jevEnv("UNIT_C")).toBeUndefined();
    delete process.env.CORTEX_JUDGE_UNIT_B; delete process.env.CORTEX_JUDGE_UNIT_C;
  });
});

test("judge env: the new names, the old ones as a fallback, the new one first", async () => {
  const root = await cfgRoot();
  await withEnv({ CORTEX_JEV_BASE_URL: "https://new.example/v1/", CORTEX_JEV_API_KEY: "sk-new", CORTEX_JEV_MODEL: "jev-new", CORTEX_JEV_ROUTE_YES: "0.61" }, async (lines) => {
    expect(await judgeConfig(root)).toMatchObject({ url: "https://new.example/v1", key: "sk-new", model: "jev-new", routeYes: 0.61 });
    expect(lines).toEqual([]);
  });
  await withEnv({ CORTEX_JUDGE_BASE_URL: "https://old.example/v1", CORTEX_JUDGE_API_KEY: "sk-old", CORTEX_JUDGE_MODEL: "jev-old", CORTEX_JUDGE_ROUTE_YES: "0.55" }, async (lines) => {
    expect(await judgeConfig(root)).toMatchObject({ url: "https://old.example/v1", key: "sk-old", model: "jev-old", routeYes: 0.55 });
    await judgeConfig(root); await judgeConfig(root);
    const dep = lines.filter((l) => l.includes("is deprecated"));
    expect(dep.length).toBeLessThanOrEqual(4); // at most once per old variable, however many calls (an earlier test in the process may have told some)
    expect(new Set(dep).size).toBe(dep.length);
  });
  await withEnv({ CORTEX_JEV_MODEL: "jev-new", CORTEX_JUDGE_MODEL: "jev-old", CORTEX_JEV_ROUTE_YES: "0.8", CORTEX_JUDGE_ROUTE_YES: "0.1" }, async (lines) => {
    expect(await judgeConfig(root)).toMatchObject({ model: "jev-new", routeYes: 0.8 });
    expect(lines).toEqual([]);
  });
});

test("judge env: the key goes only to the URL it was paired with (old key: old URL, or the new URL when no old URL is set)", async () => {
  const root = await cfgRoot();
  const key = async (vars: Record<string, string>, cfgJudge?: object) => { let k: string | undefined, u: string | undefined; await withEnv(vars, async () => { const c = await judgeConfig(cfgJudge ? await cfgRoot(cfgJudge) : root); k = c?.key; u = c?.url; }); return [u, k]; };
  // new URL + new key
  expect(await key({ CORTEX_JEV_BASE_URL: "http://n/v1", CORTEX_JEV_API_KEY: "kn" })).toEqual(["http://n/v1", "kn"]);
  // old URL + old key (production today)
  expect(await key({ CORTEX_JUDGE_BASE_URL: "http://o/v1", CORTEX_JUDGE_API_KEY: "ko" })).toEqual(["http://o/v1", "ko"]);
  // new URL, old key, no old URL: the old key follows the new URL
  expect(await key({ CORTEX_JEV_BASE_URL: "http://n/v1", CORTEX_JUDGE_API_KEY: "ko" })).toEqual(["http://n/v1", "ko"]);
  // new URL beside a different old URL, old key only: the key was written for the old URL, so it is not sent to the new one
  expect(await key({ CORTEX_JEV_BASE_URL: "http://n/v1", CORTEX_JUDGE_BASE_URL: "http://o/v1", CORTEX_JUDGE_API_KEY: "ko" })).toEqual(["http://n/v1", undefined]);
  // ... but a new key does go to the new URL
  expect(await key({ CORTEX_JEV_BASE_URL: "http://n/v1", CORTEX_JUDGE_BASE_URL: "http://o/v1", CORTEX_JEV_API_KEY: "kn", CORTEX_JUDGE_API_KEY: "ko" })).toEqual(["http://n/v1", "kn"]);
  // a new key with an old URL: the key goes to the URL the variables name
  expect(await key({ CORTEX_JUDGE_BASE_URL: "http://o/v1", CORTEX_JEV_API_KEY: "kn" })).toEqual(["http://o/v1", "kn"]);
  // a judge.base_url of cortex.json that differs from the environment URL gets no key, old names or new
  expect(await key({ CORTEX_JUDGE_BASE_URL: "http://o/v1", CORTEX_JUDGE_API_KEY: "ko" }, { base_url: "http://evil/v1" })).toEqual(["http://evil/v1", undefined]);
  expect(await key({ CORTEX_JEV_BASE_URL: "http://n/v1", CORTEX_JEV_API_KEY: "kn" }, { base_url: "http://evil/v1" })).toEqual(["http://evil/v1", undefined]);
  // a judge.base_url equal to the old environment URL does get the old key
  expect(await key({ CORTEX_JUDGE_BASE_URL: "http://o/v1/", CORTEX_JUDGE_API_KEY: "ko" }, { base_url: "http://o/v1" })).toEqual(["http://o/v1", "ko"]);
});
