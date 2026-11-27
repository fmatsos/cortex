import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import openai, { part } from "./backends/openai";
import { LIMITS } from "./limits";

test("openai: a long tool result comes in parts that together give it whole", () => {
  const s = "x".repeat(LIMITS.toolOutputChars * 2 + 5);
  let all = "", from = 0;
  for (;;) {
    const p = part(s, from);
    const next = p.match(/offset=(\d+) for the rest]$/)?.[1];
    all += next ? p.slice(0, p.lastIndexOf("\n[part")) : p;
    if (!next) break;
    from = Number(next);
  }
  expect(all).toBe(s);
});

test("openai: cut answers — tool calls not run then redone in parts (Append), text continued, llama.cpp 500 retried", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-openai-"));
  mkdirSync(join(root, "wiki"));
  await Bun.write(join(root, "wiki/p.md"), "---\ntype: Concept\n---\n");
  const call = (id: string, name: string, args: object) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
  const answers: any[] = [
    { finish_reason: "length", message: { role: "assistant", content: null, tool_calls: [call("1", "Write", { file_path: "wiki/cut.md", content: "partial" })] } },
    500,
    { finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [call("2", "WritePage", { file_path: "wiki/p.md", frontmatter: { type: "Concept" }, body: "start " })] } },
    { finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [call("3", "Append", { file_path: "wiki/p.md", content: "end\n" })] } },
    { finish_reason: "length", message: { role: "assistant", content: "Hello " } },
    { finish_reason: "stop", message: { role: "assistant", content: "world" } },
  ];
  const seen: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) {
    seen.push(await req.json());
    const a = answers[seen.length - 1];
    return a === 500 ? new Response('{"error":{"message":"Failed to parse tool call arguments as JSON"}}', { status: 500 }) : Response.json({ choices: [a] });
  } });
  try {
    const out = await openai({ model: "m", base_url: `http://127.0.0.1:${server.port}/v1` }).run(root, "q", "write");
    expect(out).toBe("Hello world");
    expect(await Bun.file(join(root, "wiki/cut.md")).exists()).toBe(false);
    expect(seen[1].messages.at(-1).content).toContain("was cut: none of its tool calls ran");
    expect(seen[2].messages.at(-1).content).toContain("was cut: none of its tool calls ran");
    expect(await Bun.file(join(root, "wiki/p.md")).text()).toEndWith("start end\n");
    expect(seen[5].messages.at(-1).content).toContain("Continue exactly where it stopped");
  } finally { server.stop(true); }
});

test("openai: a server error is cut to 300 characters, the tool-calling hint only for a model without tools", async () => {
  let body = "";
  const server = Bun.serve({ port: 0, fetch: () => new Response(body, { status: 500 }) });
  const fail = () => openai({ model: "m", base_url: `http://127.0.0.1:${server.port}/v1` }).run(mkdtempSync(join(tmpdir(), "cortex-openai-")), "q", "read").then(() => "", (e) => (e as Error).message);
  try {
    body = `Failed to parse tool call arguments: ${"> \\n".repeat(5000)}`;
    const long = await fail();
    expect(long.length).toBeLessThan(400);
    expect(long).not.toContain("must support tool calling");
    body = "registry.ollama.ai/library/gemma does not support tools";
    expect(await fail()).toContain("(the model must support tool calling)");
  } finally { server.stop(true); }
});

test("openai: a page with invalid YAML is never written, WritePage writes the frontmatter itself", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-openai-"));
  mkdirSync(join(root, "wiki"));
  const keep = "---\ntype: Entity\ntitle: Claude Code\n---\nhuman\n";
  await Bun.write(join(root, "wiki/e.md"), keep);
  await Bun.write(join(root, "wiki/good.md"), "---\ntype: Concept\ntitle: 'A: b'\n---\n");
  const call = (id: string, name: string, args: object) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
  const script = [
    { role: "assistant", content: null, tool_calls: [
      call("1", "Write", { file_path: "wiki/bad.md", content: "---\ntype: Concept\n title: A\n---\nx\n" }),
      call("3", "WritePage", { file_path: "wiki/e.md", frontmatter: { type: "Entity", title: "Qwen-Agent" }, body: "x\n" }),
      call("2", "WritePage", { file_path: "wiki/good.md", frontmatter: { type: "Concept", title: "A: b" }, body: "x\n" }),
    ] },
    { role: "assistant", content: "done" },
  ];
  const seen: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) { seen.push(await req.json()); return Response.json({ choices: [{ message: script[Math.min(seen.length, 2) - 1] }] }); } });
  try {
    await openai({ model: "m", base_url: `http://127.0.0.1:${server.port}/v1` }).run(root, "q", "write");
    expect(await Bun.file(join(root, "wiki/bad.md")).exists()).toBe(false);
    expect(seen[1].messages.find((m: any) => m.tool_call_id === "1").content).toContain("not written: invalid YAML");
    expect(seen[1].messages.find((m: any) => m.tool_call_id === "3").content).toContain('not written: wiki/e.md is an existing page and its title "Claude Code" would become "Qwen-Agent"');
    expect(await Bun.file(join(root, "wiki/e.md")).text()).toBe(keep);
    const { parseDoc } = await import("./lib");
    expect(parseDoc("g", await Bun.file(join(root, "wiki/good.md")).text()).fm).toEqual({ type: "Concept", title: "A: b" });
  } finally { server.stop(true); }
});

test("openai: NewPage creates a page named by cortex in one call; a near title is refused", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-openai-"));
  mkdirSync(join(root, "wiki"));
  await Bun.write(join(root, "cortex.json"), "{}");
  const call = (id: string, name: string, args: object) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
  const script = [
    { role: "assistant", content: null, tool_calls: [call("1", "NewPage", { type: "Concept", title: "Qwen3-4B-Instruct-2507", frontmatter: { description: "d", tags: ["llm"], title: "ignored" }, body: "Texte.\n" })] },
    { role: "assistant", content: null, tool_calls: [call("2", "NewPage", { type: "Concept", title: "Qwen3 4B Instruct", body: "x\n" })] },
    { role: "assistant", content: "done" },
  ];
  const seen: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) { seen.push(await req.json()); return Response.json({ choices: [{ message: script[seen.length - 1] }] }); } });
  try {
    await openai({ model: "m", base_url: `http://127.0.0.1:${server.port}/v1` }).run(root, "q", "write");
    const created = seen[1].messages.at(-1).content as string;
    expect(created).toMatch(/^created wiki\/concepts\/[0-9a-f-]{36}\.md$/);
    const { parseDoc } = await import("./lib");
    const doc = parseDoc("p", await Bun.file(join(root, created.slice(8))).text());
    expect(doc.fm).toMatchObject({ type: "Concept", title: "Qwen3-4B-Instruct-2507", status: "draft", description: "d", tags: ["llm"] });
    expect(doc.body).toBe("Texte.\n");
    expect(seen[2].messages.at(-1).content).toContain("near title");
  } finally { server.stop(true); }
});

test("openai: a failed compile check goes back to the model, even without a page written", async () => {
  const replies = [{ role: "assistant", content: "done" }, { role: "assistant", content: "fixed" }];
  const seen: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) { seen.push(await req.json()); return Response.json({ choices: [{ message: replies[seen.length - 1] }] }); } });
  let cited = false;
  try {
    const out = await openai({ model: "m", base_url: `http://127.0.0.1:${server.port}/v1` })
      .run(mkdtempSync(join(tmpdir(), "cortex-openai-")), "compile", "write", undefined, async () => { const miss = cited ? [] : ["no Source page cites /raw/x.md"]; cited = true; return miss; });
    expect(out).toBe("fixed");
    expect(seen[1].messages.at(-1).content).toContain("no Source page cites /raw/x.md");
  } finally { server.stop(true); }
});

// fake OpenAI-compatible server: scripted tool calls, then a final answer
test("openai: tool loop, writes under wiki/ only, refusal sent back to the model", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-openai-"));
  mkdirSync(join(root, "wiki"));
  await Bun.write(join(root, "wiki/a.md"), "stub\n"); // pages are created by cortex new, then written
  await Bun.write(join(root, "cortex.json"), "{}");
  const call = (id: string, name: string, args: object) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
  const script = [
    [call("1", "Write", { file_path: "secret.txt", content: "x" }), call("2", "Write", { file_path: "wiki/a.md", content: "# A\n" })],
    [call("3", "Edit", { file_path: "wiki/a.md", old_string: "# A", new_string: "# B" })],
  ];
  const seen: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) {
    const body = await req.json();
    seen.push(body);
    const calls = script[seen.length - 1];
    return Response.json({ choices: [{ message: calls ? { role: "assistant", content: null, tool_calls: calls } : { role: "assistant", content: "done" } }] });
  } });
  try {
    const refused: string[] = [];
    const out = await openai({ client: "openai", model: "m", base_url: `http://127.0.0.1:${server.port}/v1/` })
      .run(root, "compile", "write", (r) => refused.push(r.text));
    expect(out).toBe("done");
    expect(await Bun.file(join(root, "secret.txt")).exists()).toBe(false);
    expect(await Bun.file(join(root, "wiki/a.md")).text()).toBe("# B\n");
    expect(refused.filter((t) => t.startsWith("refused"))).toHaveLength(1);
    expect(seen[1].messages.find((m: any) => m.tool_call_id === "1").content).toContain("outside wiki/");
    expect(seen[0].tools.map((t: any) => t.function.name)).toContain("Write");
  } finally { server.stop(true); }
});

test("openai: read mode offers no write tool", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-openai-"));
  let tools: string[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) {
    tools = (await req.json()).tools.map((t: any) => t.function.name);
    return Response.json({ choices: [{ message: { role: "assistant", content: "ok" } }] });
  } });
  try {
    expect(await openai({ model: "m", base_url: `http://127.0.0.1:${server.port}/v1` }).run(root, "q", "read")).toBe("ok");
    expect(tools).not.toContain("Write");
  } finally { server.stop(true); }
});

test("openai: temperature is sent when set (0 included), absent otherwise", async () => {
  const seen: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) { seen.push(await req.json()); return Response.json({ choices: [{ message: { role: "assistant", content: "ok" } }] }); } });
  const base_url = `http://127.0.0.1:${server.port}/v1`;
  try {
    for (const temperature of [0.2, 0, undefined]) await openai({ model: "m", base_url, temperature }).run(mkdtempSync(join(tmpdir(), "cortex-openai-")), "q", "read");
    expect(seen.map((b) => b.temperature)).toEqual([0.2, 0, undefined]);
    expect("temperature" in seen[2]).toBe(false);
  } finally { server.stop(true); }
});

test("openai: the API key is never sent to a base_url only cortex.json names", async () => {
  const auth: (string | null)[] = [];
  const server = Bun.serve({ port: 0, fetch(req) { auth.push(req.headers.get("authorization")); return Response.json({ choices: [{ message: { role: "assistant", content: "ok" } }] }); } });
  const url = `http://127.0.0.1:${server.port}/v1`;
  const env = { key: process.env.OPENAI_API_KEY, base: process.env.OPENAI_BASE_URL };
  try {
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.OPENAI_BASE_URL;
    await openai({ model: "m", base_url: url }).run(mkdtempSync(join(tmpdir(), "cortex-openai-")), "q", "read");
    process.env.OPENAI_BASE_URL = url;
    await openai({ model: "m" }).run(mkdtempSync(join(tmpdir(), "cortex-openai-")), "q", "read");
    // a caller's own server and key (the site's questions) replace the cortex.json / environment pair
    await openai({ model: "m", base_url: "http://unused.invalid/v1" }, { url, key: "sk-ask" }).run(mkdtempSync(join(tmpdir(), "cortex-openai-")), "q", "read");
    expect(auth).toEqual([null, "Bearer sk-test", "Bearer sk-ask"]);
  } finally {
    server.stop(true);
    for (const [k, v] of [["OPENAI_API_KEY", env.key], ["OPENAI_BASE_URL", env.base]] as const) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});

test("openai: /raw/… (schema notation) is read from the repository root", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-openai-"));
  await Bun.write(join(root, "raw/s.md"), "hello");
  const seen: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) {
    seen.push(await req.json());
    const msg = seen.length === 1 ? { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "Read", arguments: '{"file_path":"/raw/s.md"}' } }] } : { role: "assistant", content: "ok" };
    return Response.json({ choices: [{ message: msg }] });
  } });
  try {
    await openai({ model: "m", base_url: `http://127.0.0.1:${server.port}/v1` }).run(root, "q", "read");
    expect(seen[1].messages.at(-1).content).toBe("hello");
  } finally { server.stop(true); }
});

test("openai: effort none turns thinking off", async () => {
  const { thinking } = await import("./backends/openai");
  expect(thinking("none")).toEqual({ chat_template_kwargs: { enable_thinking: false }, think: false });
  expect(thinking("high")).toEqual({ reasoning_effort: "high" });
  expect(thinking()).toEqual({});
});

test("elide: old tool results go, the last two stay; nothing left → false", async () => {
  const { elide } = await import("./backends/openai");
  const big = "x".repeat(500);
  const m = [{ role: "user", content: big }, ...[1, 2, 3].map((i) => ({ role: "tool", tool_call_id: `${i}`, content: big }))];
  expect(elide(m)).toBe(true);
  expect(m.map((x) => x.content.length > 200)).toEqual([true, false, true, true]);
  expect(elide(m)).toBe(false);
});

test("elide: preventive decision — estimate above 80% of the budget elides the old results in one block, below leaves them", async () => {
  const { elide, estimateTokens, nearFull } = await import("./backends/openai");
  const big = "x".repeat(3500); // ~1000 tokens
  const m: any[] = [{ role: "system", content: "s" }, ...[1, 2, 3, 4, 5].map((i) => ({ role: "tool", tool_call_id: `${i}`, content: big }))];
  expect(estimateTokens(m)).toBeGreaterThan(5000);
  expect(estimateTokens(m)).toBeLessThan(5400);
  expect(nearFull(m, 10_000)).toBe(false); // ~5k of 8k allowed
  expect(nearFull(m, 6_000)).toBe(true); // ~5k > 4.8k
  if (nearFull(m, 6_000)) elide(m);
  expect(m.map((x) => x.content.length > 200)).toEqual([false, false, false, false, true, true]);
  expect(nearFull(m, 6_000)).toBe(false); // the rewrite happened once; the next turns do not elide again
  expect(elide(m)).toBe(false);
});

test("openai: cache_prompt is sent, except to api.openai.com", async () => {
  const { cache } = await import("./backends/openai");
  expect(cache("http://localhost:8080/v1")).toEqual({ cache_prompt: true });
  expect(cache("https://api.openai.com/v1")).toEqual({});
});

test("openai: OpenRouter always gets the cheapest provider that supports every parameter; other servers nothing", async () => {
  const { route } = await import("./backends/openai");
  expect(route("https://openrouter.ai/api/v1")).toEqual({ provider: { sort: "price", require_parameters: true } });
  expect(route("http://192.168.1.96:8080/v1")).toEqual({});
});

test("elide: old page bodies in the model's own write calls go too, the last two calls stay", async () => {
  const { elide } = await import("./backends/openai");
  const big = "x".repeat(500);
  const call = (i: number) => ({ role: "assistant", tool_calls: [{ id: `${i}`, function: { name: "WritePage", arguments: JSON.stringify({ file_path: `wiki/p${i}.md`, body: big }) } }] });
  const m: any[] = [call(1), call(2), call(3)];
  expect(elide(m)).toBe(true);
  const args = m.map((x) => JSON.parse(x.tool_calls[0].function.arguments));
  expect(args[0].body).toContain("written to wiki/p1.md");
  expect(args[0].file_path).toBe("wiki/p1.md");
  expect(args[1].body).toBe(big);
  expect(args[2].body).toBe(big);
  expect(elide(m)).toBe(false);
});

test("openai: a run's extra tool is offered with its JSON schema and runs beside the pack", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-openai-"));
  mkdirSync(join(root, "wiki"));
  const { blockRegistry } = await import("./answer-blocks");
  const r = blockRegistry();
  const call = { id: "1", type: "function", function: { name: "render_blocks", arguments: JSON.stringify({ blocks: [{ type: "facts", items: [{ label: "A", value: "1" }] }] }) } };
  const answers = [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [call] } }, { finish_reason: "stop", message: { role: "assistant", content: "Voici.\n\n{{bloc-1}}" } }];
  const seen: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) { seen.push(await req.json()); return Response.json({ choices: [answers[seen.length - 1]] }); } });
  try {
    const out = await openai({ model: "m", base_url: `http://127.0.0.1:${server.port}/v1` }).run(root, "q", "read", undefined, undefined, [r.tool]);
    const tool = seen[0].tools.find((t: any) => t.function.name === "render_blocks");
    expect(tool.function.parameters.properties.blocks.type).toBe("array");
    expect(seen[1].messages.at(-1).content).toContain("{{bloc-1}} (facts)");
    expect(r.assemble(out)).toContain('```cortex-ui\n{"type":"facts"');
  } finally { server.stop(true); }
});

test("openai: a streamed answer (SSE) is put back together, only content deltas reach the stream, tool calls arrive in fragments, reset between turns", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-openai-"));
  const sse = (...chunks: object[]) => new Response([...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), "data: [DONE]\n\n"].join(""), { headers: { "content-type": "text/event-stream" } });
  const d = (delta: object, finish_reason: string | null = null) => ({ choices: [{ index: 0, delta, finish_reason }] });
  const seen: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) {
    seen.push(await req.json());
    return seen.length === 1
      ? sse(d({ reasoning_content: "hmm" }), d({ content: "Let me " }), d({ content: "look." }), d({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "Glob", arguments: '{"patt' } }] }), d({ tool_calls: [{ index: 0, function: { arguments: 'ern":"wiki/*.md"}' } }] }, "tool_calls"))
      : sse(d({ role: "assistant", content: "Fi" }), d({ content: "nal" }, "stop"));
  } });
  try {
    const events: string[] = [];
    const out = await openai({ model: "m", base_url: `http://127.0.0.1:${server.port}/v1` }).run(root, "q", "read", undefined, undefined, [], { text: (t) => events.push(t), reset: () => events.push("|reset|"), step: (n, a) => events.push(`${n} ${JSON.stringify(a)}`) });
    expect(out).toBe("Final");
    expect(events).toEqual(["Let me ", "look.", `Glob {"pattern":"wiki/*.md"}`, "|reset|", "Fi", "nal"]); // the step comes before the tool runs, the reset with the next turn
    expect(seen[0].stream).toBe(true);
    const call = seen[1].messages.at(-2).tool_calls[0];
    expect(call.id).toBe("c1");
    expect(call.function).toEqual({ name: "Glob", arguments: '{"pattern":"wiki/*.md"}' });
    expect(seen[1].messages.at(-1).role).toBe("tool"); // the reassembled call ran
  } finally { server.stop(true); }
});

test("openai: without a stream no stream parameter is sent, and a JSON answer to a streamed request is still read", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-openai-"));
  const seen: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) { seen.push(await req.json()); return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "ok" } }] }); } });
  try {
    const b = openai({ model: "m", base_url: `http://127.0.0.1:${server.port}/v1` });
    expect(await b.run(root, "q", "read")).toBe("ok");
    expect("stream" in seen[0]).toBe(false);
    const got: string[] = [];
    expect(await b.run(root, "q", "read", undefined, undefined, [], { text: (t) => got.push(t), reset: () => {} })).toBe("ok");
    expect(seen[1].stream).toBe(true);
    expect(got).toEqual([]);
  } finally { server.stop(true); }
});

test("openai: an aborted signal stops the run (request, waiting body, next turn, tool calls); a signal alone does not turn streaming on", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-openai-"));
  const enc = new TextEncoder();
  const seen: any[] = [];
  // the first request: a chunk of text, then the server hangs (the model is slow); the second one answers a tool call
  const server = Bun.serve({ port: 0, idleTimeout: 0, async fetch(req) {
    seen.push(await req.json());
    if (seen.length === 1) {
      return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Let me" } }] })}\n\n`)); } }), { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({ choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "Glob", arguments: '{"pattern":"wiki/*.md"}' } }] } }] });
  } });
  try {
    const b = openai({ model: "m", base_url: `http://127.0.0.1:${server.port}/v1` });
    // aborted while the answer is being read
    const ctl = new AbortController();
    const run = b.run(root, "q", "read", undefined, undefined, [], { text: () => ctl.abort(), reset: () => {}, signal: ctl.signal });
    const t0 = Date.now();
    await expect(run).rejects.toThrow();
    expect(ctl.signal.aborted).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2000); // not the request timeout
    // aborted at the first tool call of a turn (a signal alone: no `stream` parameter, JSON answer): no further request
    const late = new AbortController();
    const before2 = seen.length;
    await expect(b.run(root, "q", "read", undefined, undefined, [], { signal: late.signal, step: () => late.abort() })).rejects.toThrow();
    expect(seen.length).toBe(before2 + 1);
    expect("stream" in seen[before2]).toBe(false);
    // already aborted: nothing is even sent
    const before = seen.length;
    await expect(b.run(root, "q", "read", undefined, undefined, [], { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(seen.length).toBe(before);
  } finally { server.stop(true); }
});

test("openai: after toolRounds read turns only the run's extra tools are offered with the answer-now message; a stray call is refused, not run", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-openai-"));
  mkdirSync(join(root, "wiki"));
  const { blockRegistry } = await import("./answer-blocks");
  const r = blockRegistry();
  const call = (id: string, name: string, args: object) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
  const tools = (...c: any[]) => ({ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: c } });
  const answers = [
    tools(call("1", "Glob", { pattern: "wiki/*.md" })),
    tools(call("2", "Glob", { pattern: "wiki/*.md" })),
    tools(call("3", "Glob", { pattern: "wiki/*.md" }), call("4", "Grep", { pattern: "x" })), // the second read turn ends the reading
    tools(call("5", "Read", { file_path: "wiki/a.md" })), // stray: refused
    { finish_reason: "stop", message: { role: "assistant", content: "Answer." } },
  ];
  const seen: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) { seen.push(await req.json()); return Response.json({ choices: [answers[seen.length - 1]] }); } });
  try {
    const out = await openai({ model: "m", base_url: `http://127.0.0.1:${server.port}/v1` }).run(root, "q", "read", undefined, undefined, [r.tool], { toolRounds: 3 });
    expect(out).toBe("Answer.");
    const names = (i: number) => seen[i].tools.map((t: any) => t.function.name);
    expect(names(0)).toContain("Read");
    expect(names(2)).toContain("Read"); // third request: still two read turns done
    expect(names(3)).toEqual(["render_blocks"]);
    expect(seen[2].messages.some((m: any) => m.role === "user" && m.content.includes("reading is over"))).toBe(false);
    expect(seen[3].messages.at(-1)).toEqual({ role: "user", content: expect.stringContaining("Your reading is over") });
    expect(seen[4].messages.at(-1)).toEqual({ role: "tool", tool_call_id: "5", content: expect.stringContaining("refused: your reading is over") });
    expect(names(4)).toEqual(["render_blocks"]);
  } finally { server.stop(true); }
});

test("openai: past toolRounds without any extra tool, no tools are sent; without toolRounds nothing is capped", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-openai-"));
  mkdirSync(join(root, "wiki"));
  const glob = { finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "Glob", arguments: '{"pattern":"wiki/*.md"}' } }] } };
  const done = { finish_reason: "stop", message: { role: "assistant", content: "ok" } };
  let answers: any[] = [glob, done];
  const seen: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) { seen.push(await req.json()); return Response.json({ choices: [answers[seen.length - 1]] }); } });
  const run = (stream?: { toolRounds: number }) => openai({ model: "m", base_url: `http://127.0.0.1:${server.port}/v1` }).run(root, "q", "read", undefined, undefined, undefined, stream);
  try {
    await run({ toolRounds: 1 });
    expect(seen[0].tools).toBeDefined();
    expect("tools" in seen[1]).toBe(false);
    expect(seen[1].messages.at(-1).content).toContain("Your reading is over");
    seen.length = 0; answers = [glob, glob, glob, done];
    await run();
    expect(seen.every((b) => b.tools?.length)).toBe(true);
  } finally { server.stop(true); }
});

test("openai: onlyExtra offers no pack tool, and the extra tools marked read are the ones the cap takes away", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-openai-"));
  const { z } = await import("zod");
  const { blockRegistry } = await import("./answer-blocks");
  const r = blockRegistry();
  let ran = 0;
  const look = { name: "look", description: "d", schema: z.object({ q: z.string() }), read: true, run: async () => (ran++, "found") };
  const call = (id: string, name: string, args: object) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
  const tools = (...c: any[]) => ({ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: c } });
  const answers = [tools(call("1", "look", { q: "a" })), tools(call("2", "look", { q: "b" })), tools(call("3", "Read", { file_path: "x" })), { finish_reason: "stop", message: { role: "assistant", content: "ok" } }];
  const seen: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) { seen.push(await req.json()); return Response.json({ choices: [answers[seen.length - 1]] }); } });
  try {
    await openai({ model: "m", base_url: `http://127.0.0.1:${server.port}/v1` }).run(root, "q", "read", undefined, undefined, [look, r.tool], { onlyExtra: true, toolRounds: 2 });
    const names = (i: number) => seen[i].tools.map((t: any) => t.function.name);
    expect(names(0)).toEqual(["look", "render_blocks"]); // no Read, Glob, Grep, Bash
    expect(names(1)).toEqual(["look", "render_blocks"]);
    expect(names(2)).toEqual(["render_blocks"]); // the cap counted the two look rounds
    expect(ran).toBe(2);
    expect(seen[3].messages.at(-1).content).toContain("refused: your reading is over");
  } finally { server.stop(true); }
});

test("openai: tool_choice required is sent until a block is registered, then omitted; never without blocksReady", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-openai-"));
  const { z } = await import("zod");
  const { blockRegistry } = await import("./answer-blocks");
  const call = (id: string, name: string, args: object) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
  const tools = (...c: any[]) => ({ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: c } });
  const text = { finish_reason: "stop", message: { role: "assistant", content: "ok {{bloc-1}}" } };
  const look = { name: "look", description: "d", schema: z.object({ q: z.string() }), read: true, run: async () => "found" };
  const play = async (script: any[], blocksReady: (() => boolean) | undefined, extra: any[]) => {
    const seen: any[] = [];
    const server = Bun.serve({ port: 0, async fetch(req) { seen.push(await req.json()); return Response.json({ choices: [script[seen.length - 1]] }); } });
    try { await openai({ model: "m", base_url: `http://127.0.0.1:${server.port}/v1` }).run(root, "q", "read", undefined, undefined, extra, { onlyExtra: true, toolRounds: 4, blocksReady }); }
    finally { server.stop(true); }
    return seen.map((b) => b.tool_choice);
  };
  const facts = { blocks: [{ type: "facts", items: [{ label: "A", value: "1" }] }] };
  // a reading turn, then render_blocks, then the answer: required until the block exists
  const r = blockRegistry();
  expect(await play([tools(call("1", "look", { q: "a" })), tools(call("2", "render_blocks", facts)), text], r.ready, [look, r.tool])).toEqual(["required", "required", undefined]);
  // the same run without the option: never sent
  const r2 = blockRegistry();
  expect(await play([tools(call("1", "look", { q: "a" })), tools(call("2", "render_blocks", facts)), text], undefined, [look, r2.tool])).toEqual([undefined, undefined, undefined]);
  // render_blocks refused every time: required stops after askToolRounds + 2 turns, the model may answer
  const r3 = blockRegistry({ titles: new Map() });
  const bad = { blocks: [{ type: "pages", items: [{ path: "/nope", summary: "s" }] }] };
  const n = LIMITS.askToolRounds + 2;
  const choices = await play([...Array.from({ length: n }, (_, i) => tools(call(String(i), "render_blocks", bad))), text], r3.ready, [r3.tool]);
  expect(choices).toEqual([...Array(n).fill("required"), undefined]);
  expect(r3.ready()).toBe(false);
});

test("openai: the system prompt is the wiki schema, or `stream.system` when the run gives one (the site's questions)", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-openai-"));
  const { schemaText } = await import("./schema");
  const first = async (stream?: { system?: string }) => {
    const seen: any[] = [];
    const server = Bun.serve({ port: 0, async fetch(req) { seen.push(await req.json()); return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "ok" } }] }); } });
    try { await openai({ model: "m", base_url: `http://127.0.0.1:${server.port}/v1` }).run(root, "q", "read", undefined, undefined, [], stream); }
    finally { server.stop(true); }
    return seen[0].messages[0];
  };
  expect(await first()).toEqual({ role: "system", content: await schemaText(root) });
  expect(await first({ system: "short" })).toEqual({ role: "system", content: "short" });
});
