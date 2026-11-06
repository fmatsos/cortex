import { expect, test } from "bun:test";
import { join } from "node:path";
import { GOLDEN_MCP_RELATED, mcpRoot } from "./test-helpers";

test("related: links, backlinks, sources and tags, ranked by strength", async () => {
  const { related } = await import("./lib");
  const { readPages } = await import("./lib");
  const { pages: docs } = await readPages(await mcpRoot());
  const a = related(docs, "/wiki/concepts/a.md");
  // B: outgoing link 3 + source 2 + tag ctx 1 = 6; C: incoming link 3 + source 2 + tag llm 1 = 6; index.md excluded
  expect(a.map((r) => r.path)).toEqual(["wiki/concepts/b.md", "wiki/entities/c.md"]);
  expect(a[0]).toMatchObject({ score: 6, reasons: [{ kind: "out" }, { kind: "source", value: "/raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md" }, { kind: "tag", value: "ctx" }] });
  expect(a[1].reasons).toContainEqual({ kind: "in" });
  // the MCP tool keeps handing the external agent the French text, byte for byte as before the structured reasons
  const { relatedForAgent } = await import("./mcp");
  expect(JSON.stringify(relatedForAgent(a), null, 1)).toBe(GOLDEN_MCP_RELATED);
  // no direct link: only the shared source (B and C have no common tag)
  expect(related(docs, "wiki/concepts/b.md").map((r) => [r.path, r.score])).toEqual([["wiki/concepts/a.md", 6], ["wiki/entities/c.md", 2]]);
  expect(() => related(docs, "/wiki/concepts/nope.md")).toThrow("not found");
});

test("get: refuses any path outside wiki/ and raw/", async () => {
  const { getFile } = await import("./mcp");
  const { symlinkSync } = await import("node:fs");
  const root = await mcpRoot();
  await Bun.write(join(root, "secret.md"), "secret");
  symlinkSync("../secret.md", join(root, "wiki/piege.md")); // link that leaves wiki/
  expect(await getFile(root, "/wiki/concepts/b.md")).toContain("Beta");
  expect(await getFile(root, "wiki/concepts/b.md")).toContain("Beta");
  expect(await getFile(root, "raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md")).toContain("zythum");
  for (const p of ["cortex.json", "secret.md", "wiki/../secret.md", "/wiki/../secret.md", "wiki/piege.md", "/etc/passwd", "../x.md"])
    expect(getFile(root, p)).rejects.toThrow();
  expect(getFile(root, "wiki/concepts")).rejects.toThrow("not found"); // a folder is not a file
});

test("lastLog: structured entries of the last days, filtered by kind", async () => {
  const { lastLog } = await import("./mcp");
  const root = await mcpRoot();
  expect(lastLog(root, 1).map((e) => e.text)).toEqual(["x", "0 erreur"]); // most recent first
  expect(lastLog(root, 1)[0]).toMatchObject({ kind: "add", sources: ["01a1a5c9-5e80-7075-ae13-aab03b0a8697"] });
  expect(lastLog(root, 5).map((e) => e.text)).toEqual(["x", "0 erreur", "y"]);
  expect(lastLog(root, 5, "lint").map((e) => e.text)).toEqual(["0 erreur"]);
});

test("cortex mcp: initialize, tools/list, search, get, add without network (JSON-RPC over stdio)", async () => {
  const root = await mcpRoot();
  const proc = Bun.spawn(["bun", join(import.meta.dir, "cortex.ts"), "mcp"], {
    env: { ...process.env, CORTEX_ROOT: root }, stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  const send = (m: object) => { proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n"); proc.stdin.flush(); };
  const reader = proc.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  const recv = async (id: number) => {
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        const msg = JSON.parse(buf.slice(0, nl)); // a line outside the protocol on stdout would make this parse fail
        buf = buf.slice(nl + 1);
        if (msg.id === id) return msg;
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error(`serveur arrêté : ${await new Response(proc.stderr).text()}`);
      buf += value;
    }
  };
  const call = async (id: number, name: string, args: object) => {
    send({ id, method: "tools/call", params: { name, arguments: args } });
    return (await recv(id)).result;
  };
  try {
    send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    expect((await recv(1)).result.serverInfo.name).toBe("cortex");
    send({ method: "notifications/initialized" });

    send({ id: 2, method: "tools/list" });
    expect((await recv(2)).result.tools.map((t: any) => t.name).sort()).toEqual(["add", "get", "lint", "log", "queue", "related", "search"]);

    const s = await call(3, "search", { q: "zythum" });
    expect(JSON.parse(s.content[0].text).hits[0]).toMatchObject({ area: "raw", path: "/raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md" });
    expect(JSON.parse(s.content[0].text).hint).toContain("gap");
    expect((await call(4, "get", { path: "/wiki/concepts/b.md" })).content[0].text).toContain("Beta");
    expect((await call(5, "get", { path: "wiki/../cortex.json" })).isError).toBe(true);
    expect((await call(6, "add", { text: "# Sans note\n\nUn autre texte, sur le malt cette fois." })).isError).toBeFalsy(); // note optional
    const added = JSON.parse((await call(7, "add", { text: "# Idée\n\nUn texte qui parle de houblon.", note: "test" })).content[0].text);
    expect(added).toMatchObject({ duplicate: false, title: "Idée" });
    expect(JSON.parse((await call(8, "add", { text: "# Idée\n\nUn texte qui parle de houblon.", note: "test" })).content[0].text).id).toBe(added.id);
    expect((await call(10, "add", { input: "/etc/hostname", note: "fuite" })).isError).toBe(true); // no local file via MCP
    const today = JSON.parse((await call(9, "log", { kind: "add" })).content[0].text);
    expect(today[0]).toMatchObject({ kind: "add", sources: [added.id] });
    expect(today.every((e: any) => e.kind === "add")).toBe(true);
    expect((await call(11, "log", { kind: "inconnu" })).isError).toBe(true);
    expect((await call(10, "related", { path: "/wiki/concepts/a.md" })).content[0].text).toBe(GOLDEN_MCP_RELATED);
  } finally { proc.stdin.end(); proc.kill(); }
});

test("cortex mcp --agent: the cortex tool pack of openai, same names per mode, guard and page checks over stdio", async () => {
  const { toolPack } = await import("./backends/tools");
  const root = await mcpRoot();
  const open = (mode: string) => {
    const proc = Bun.spawn(["bun", join(import.meta.dir, "cortex.ts"), "mcp", "--agent", mode], { env: { ...process.env, CORTEX_ROOT: root }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const reader = proc.stdout.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    const rpc = async (id: number, method: string, params?: object) => {
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); proc.stdin.flush();
      for (;;) {
        const nl = buf.indexOf("\n");
        if (nl >= 0) { const msg = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1); if (msg.id === id) return msg.result; continue; }
        const { value, done } = await reader.read();
        if (done) throw new Error(await new Response(proc.stderr).text());
        buf += value;
      }
    };
    return { proc, rpc, text: async (id: number, name: string, args: object) => (await rpc(id, "tools/call", { name, arguments: args })).content[0].text as string };
  };
  for (const mode of ["read", "write"] as const) {
    const { proc, rpc, text } = open(mode);
    try {
      await rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
      expect((await rpc(2, "tools/list")).tools.map((t: any) => t.name)).toEqual(toolPack(mode).map((t) => t.name));
      if (mode === "write") {
        expect(await text(3, "Write", { file_path: "cortex.json", content: "{}" })).toContain("Write refused outside wiki/");
        expect(await text(4, "Write", { file_path: "wiki/concepts/zz.md", content: "---\ntype: Concept\ntitle: Z\n---\n" })).toContain("create a new page with NewPage");
        expect(await text(5, "WritePage", { file_path: "wiki/concepts/a.md", frontmatter: { type: "Concept", title: "Autre" }, body: "x" })).toContain("is an existing page");
        expect(await text(6, "NewPage", { type: "Concept", title: "Zeta page", body: "Texte.\n" })).toMatch(/^created wiki\/concepts\//);
      } else expect(await text(3, "Read", { file_path: "wiki/concepts/a.md" })).toContain("---");
    } finally { proc.stdin.end(); proc.kill(); }
  }
});
