import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import openai from "./backends/openai";
import { structured, stripSchema } from "./llm";
import { LIMITS } from "./limits";

const schema = {
  type: "object", additionalProperties: false, required: ["title", "n"],
  properties: { title: { type: "string", minLength: 3, pattern: "^[A-Z]" }, n: { type: "integer", minimum: 0 } },
};
const Out = z.object({ title: z.string().min(3), n: z.number().int().min(0) });
const reply = (content: string, extra: object = {}, finish = "stop") => Response.json({ choices: [{ finish_reason: finish, message: { role: "assistant", content } }], ...extra });
const call = (cfg: object, extra: object = {}) => structured({ model: "m", ...cfg }, { name: "extract", system: "S", user: "U", schema, zod: Out, maxTokens: 123, ...extra });

/** Fake server: `answers[i]` is the response to the i-th request (a function sees the parsed body). */
async function serve(answers: ((b: any, req: Request) => Response)[]) {
  const seen: any[] = [], reqs: Request[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) { const b = await req.json(); seen.push(b); reqs.push(req); return answers[Math.min(seen.length, answers.length) - 1](b, req); } });
  return { seen, reqs, cfg: { base_url: `http://127.0.0.1:${server.port}/v1` }, stop: () => server.stop(true) };
}

test("structured: json_schema in the OpenAI form, thinking off, cache_prompt, temperature 0, validated value returned", async () => {
  const s = await serve([() => reply('{"title":"Abc","n":2}')]);
  try {
    expect(await call(s.cfg)).toEqual({ title: "Abc", n: 2 });
    const b = s.seen[0];
    expect(b.response_format).toEqual({ type: "json_schema", json_schema: { name: "extract", schema, strict: true } });
    expect(b).toMatchObject({ model: "m", temperature: 0, max_tokens: 123, cache_prompt: true, think: false, chat_template_kwargs: { enable_thinking: false } });
    expect(b.reasoning_effort).toBeUndefined();
    expect(b.messages).toEqual([{ role: "system", content: "S" }, { role: "user", content: "U" }]);
  } finally { s.stop(); }
});

test("structured: the schema is derived from zod when none is given; a model is required", async () => {
  const s = await serve([() => reply('{"title":"Abc","n":2}')]);
  try {
    await call(s.cfg, { schema: undefined });
    expect(s.seen[0].response_format.json_schema.schema.required).toEqual(["title", "n"]);
    await expect(structured({}, { name: "x", system: "", user: "", zod: Out, maxTokens: 1 })).rejects.toThrow("needs a model");
  } finally { s.stop(); }
});

test("structured: invalid JSON and zod errors are sent back, then it succeeds; retries are counted in the metrics", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "cortex-llm-")), "m.jsonl");
  process.env.CORTEX_METRICS = file;
  const s = await serve([() => reply('{"title": "Abc", "n"'), () => reply('{"title":"Abc","n":-1}'), () => reply('```json\n{"title":"Abc","n":3}\n```')]);
  try {
    expect(await call(s.cfg, { source: "s1" })).toEqual({ title: "Abc", n: 3 });
    expect(s.seen[1].messages.at(-1).content).toContain("not valid JSON");
    expect(s.seen[1].messages.at(-2)).toEqual({ role: "assistant", content: '{"title": "Abc", "n"' });
    expect(s.seen[2].messages.at(-1).content).toContain("n: ");
    const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ source: "s1", step: "extract", model: "m", retries: 2, ok: true });
  } finally { s.stop(); delete process.env.CORTEX_METRICS; }
});

test("structured: finish_reason length is a failure, the retry asks for a shorter answer; gives up after pipelineRetries", async () => {
  const s = await serve([() => reply('{"title":"Ab', {}, "length"), () => reply('{"title":"Abc","n":1}')]);
  try {
    expect(await call(s.cfg)).toEqual({ title: "Abc", n: 1 });
    expect(s.seen[1].messages.at(-1).content).toContain("cut by the output limit");
    expect(s.seen[1].messages.some((m: any) => m.role === "assistant")).toBe(false);
  } finally { s.stop(); }
  const bad = await serve([() => reply("nope")]);
  try {
    await expect(call(bad.cfg)).rejects.toThrow(`no valid answer after ${LIMITS.pipelineRetries + 1} attempts`);
    expect(bad.seen).toHaveLength(LIMITS.pipelineRetries + 1);
  } finally { bad.stop(); }
});

test("structured: a 400 on the schema keywords resubmits the schema without pattern, minLength and minimum", async () => {
  const s = await serve([() => new Response('{"error":{"message":"Unrecognized schema: pattern"}}', { status: 400 }), () => reply('{"title":"Abc","n":2}')]);
  try {
    expect(await call(s.cfg)).toEqual({ title: "Abc", n: 2 });
    expect(s.seen).toHaveLength(2);
    expect(s.seen[1].response_format.json_schema.schema.properties).toEqual({ title: { type: "string" }, n: { type: "integer" } });
    expect(s.seen[1].messages).toEqual(s.seen[0].messages); // not a retry: no error message added
  } finally { s.stop(); }
});

test("structured: a server without json_schema falls back to json_object, with the schema in the instructions, and says so", async () => {
  const s = await serve([() => new Response("bad", { status: 400 }), () => new Response("bad", { status: 400 }), (b) => (b.response_format.type === "json_object" ? reply('{"title":"Abc","n":2}') : reply("x"))]);
  try {
    const notices: string[] = [];
    expect(await call(s.cfg, { report: (m: { text: string }) => notices.push(m.text) })).toEqual({ title: "Abc", n: 2 });
    expect(s.seen.map((b) => b.response_format.type)).toEqual(["json_schema", "json_schema", "json_object"]);
    expect(s.seen[2].messages[0].content).toContain('"required":["title","n"]');
    expect(notices.join()).toContain("json_object");
  } finally { s.stop(); }
});

test("structured: a full context is an error, not a downgrade; the error body is cut", async () => {
  const s = await serve([() => new Response(`request exceeds the available context size ${"x".repeat(1000)}`, { status: 400 })]);
  try {
    const e = await call(s.cfg).then(() => "", (e) => (e as Error).message);
    expect(e).toContain("answered 400");
    expect(e.length).toBeLessThan(400);
    expect(s.seen).toHaveLength(1);
  } finally { s.stop(); }
});

test("structured: the API key goes only to the URL of $OPENAI_BASE_URL, never to one only cortex.json names", async () => {
  const s = await serve([() => reply('{"title":"Abc","n":2}'), () => reply('{"title":"Abc","n":2}')]);
  const env = { key: process.env.OPENAI_API_KEY, base: process.env.OPENAI_BASE_URL };
  try {
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.OPENAI_BASE_URL;
    await call(s.cfg);
    process.env.OPENAI_BASE_URL = s.cfg.base_url;
    await call({});
    expect(s.reqs.map((r) => r.headers.get("authorization"))).toEqual([null, "Bearer sk-test"]);
  } finally {
    s.stop();
    for (const [k, v] of [["OPENAI_API_KEY", env.key], ["OPENAI_BASE_URL", env.base]] as const) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});

test("metrics: prompt tokens come from timings.prompt_n (cache excluded), not usage.prompt_tokens; failures are logged too", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "cortex-llm-")), "m.jsonl");
  process.env.CORTEX_METRICS = file;
  const timings = { prompt_n: 40, cache_n: 860, predicted_n: 77, prompt_ms: 70, predicted_ms: 3500 };
  const s = await serve([() => reply('{"title":"Abc","n":2}', { usage: { prompt_tokens: 900, completion_tokens: 80 }, timings }), () => new Response("boom", { status: 503 })]);
  try {
    await call(s.cfg);
    await expect(call(s.cfg)).rejects.toThrow("503");
    const [a, b] = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(a).toMatchObject({ prompt_tokens: 40, cached_tokens: 860, completion_tokens: 77, prompt_ms: 70, predicted_ms: 3500, ok: true });
    expect(typeof a.ms).toBe("number");
    expect(a.at).toMatch(/^\d{4}-/);
    expect(b).toMatchObject({ ok: false, prompt_tokens: 0 });
  } finally { s.stop(); delete process.env.CORTEX_METRICS; }
});

test("metrics: without timings, the cached part is taken off usage.prompt_tokens; the agent loop writes one line per request", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "cortex-llm-")), "m.jsonl");
  process.env.CORTEX_METRICS = file;
  const s = await serve([() => reply("done", { usage: { prompt_tokens: 900, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 800 } } })]);
  try {
    expect(await openai({ model: "m", ...s.cfg }).run(mkdtempSync(join(tmpdir(), "cortex-llm-")), "q", "read")).toBe("done");
    const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ step: "agent", model: "m", prompt_tokens: 100, cached_tokens: 800, completion_tokens: 5, retries: 0, ok: true });
  } finally { s.stop(); delete process.env.CORTEX_METRICS; }
});

test("stripSchema: keywords go, a property with the same name stays", () => {
  expect(stripSchema({ type: "object", properties: { pattern: { type: "string", pattern: "^a", minLength: 1 }, k: { type: "array", items: { type: "integer", minimum: 0 } } } }))
    .toEqual({ type: "object", properties: { pattern: { type: "string" }, k: { type: "array", items: { type: "integer" } } } });
});

test("structured: a 500 or 503 is retried once with the same format (no downgrade of the schema), then it fails", async () => {
  const s = await serve([() => new Response("boom", { status: 500 }), () => reply('{"title":"Abc","n":2}')]);
  try {
    expect(await call(s.cfg)).toEqual({ title: "Abc", n: 2 });
    expect(s.seen.map((b) => b.response_format.type)).toEqual(["json_schema", "json_schema"]);
    expect(s.seen[1].response_format.json_schema.schema).toEqual(schema); // not the stripped schema
  } finally { s.stop(); }
  const down = await serve([() => new Response("unavailable", { status: 503 })]);
  try {
    await expect(call(down.cfg)).rejects.toThrow("answered 503");
    expect(down.seen).toHaveLength(2);
    expect(down.seen.every((b) => b.response_format.type === "json_schema")).toBe(true);
  } finally { down.stop(); }
});
