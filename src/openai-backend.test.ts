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
    expect(auth).toEqual([null, "Bearer sk-test"]);
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
