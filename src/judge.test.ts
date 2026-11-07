import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintConfig } from "./config";
import { refresh } from "./embed";
import { judge, judgeConfig } from "./judge";
import { newPageCtx } from "./naming";
import { openWiki } from "./context";
import { routeCandidates } from "./agent";
import { compilePrompt } from "./prompts";

// Fake servers: llama.cpp's /embeddings (3 meaningful dims: "chat", "chien", "mi-chat" in between, anything else) and
// /systemone (TypeSafe's format), whose verdicts each test sets.
const topic = (t: string) => (/mi-chat/i.test(t) ? [0.7, 0.714, 0] : /chat|f[ée]lin|minou/i.test(t) ? [1, 0, 0] : /chien/i.test(t) ? [0, 1, 0] : [0, 0, 1]);
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
  expect(lintConfig({ judge: { model: "m", base_url: null } })).toEqual([]);
  expect(lintConfig({ judge: { nope: 1 } })[0].level).toBe("error");
});

test("judge: POST <base>/systemone with model, state and questions; answers by id; a malformed answer or a down server = undefined, then left alone", async () => {
  const s = fake(), root = await wiki(s.port!);
  verdict = () => ({ a: { type: "noul", noul: 0.9 } });
  expect(await judge(root, { x: 1 }, { a: { type: "noul", instructions: "Is it?" } })).toEqual({ a: { type: "noul", noul: 0.9 } });
  expect(calls[0].body).toEqual({ model: "d3-mini", state: { x: 1 }, questions: { a: { type: "noul", instructions: "Is it?" } } });
  verdict = () => ({ a: { type: "choice", choice: "x" } }); // not what was asked
  expect(await judge(root, "s", { a: { type: "noul", instructions: "?" } })).toBeUndefined();
  const n = calls.length;
  expect(await judge(root, "s", { a: { type: "noul", instructions: "?" } })).toBeUndefined();
  expect(calls.length).toBe(n); // cooldown: the server is not called again
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
  expect(notes[0]).toContain("close in meaning: "); // cosine 0.7: under dupCosine, over dupWarn
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
