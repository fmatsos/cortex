import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import openai from "./backends/openai";

// fake OpenAI-compatible server: scripted tool calls, then a final answer
test("openai: tool loop, writes under wiki/ only, refusal sent back to the model", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-openai-"));
  mkdirSync(join(root, "wiki"));
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
    expect(refused).toHaveLength(1);
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
