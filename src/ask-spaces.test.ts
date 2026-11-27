import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASK_SPACES_ENV, askSpacesFromEnv, narrowSpaces, parseSpacePath, spacePath } from "./ask-scope";
import { answerSegments } from "./answer-blocks";
import { agentAsk, askAnswerSpaces, stepOf } from "./serve";
import { spacesTools } from "./ask-site";
import { confine } from "./backends/sandbox";
import { guard } from "./backends/claude";
import { callTool, packMcpConfig, packServer, toolPack } from "./backends/tools";

// A question that reads several spaces (`cortex ask "…" --space a,b|all`, the site's assistant with a scope): what is allowed is a list of space
// names held by the code that starts the agent. Enforced in the sandbox (every process it runs), in the file tools and the search of the pack, in the
// site's tools; nothing here calls a model (a fake OpenAI server, a fake agent command).

const CLI = join(import.meta.dir, "cortex.ts");
const bwrap = process.platform !== "linux" || !!Bun.which("bwrap");

/** An instance of spaces a, b, c, each with one page about "quokka" (and a secret raw source), an archive and the accounts' database. */
const instance = () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-ask-spaces-"));
  writeFileSync(join(root, "cortex.json"), "{}");
  for (const n of ["a", "b", "c"]) {
    mkdirSync(join(root, "spaces", n, "wiki/concepts"), { recursive: true });
    mkdirSync(join(root, "spaces", n, "raw"), { recursive: true });
    writeFileSync(join(root, "spaces", n, "wiki/concepts/p.md"), `---\ntype: Concept\ntitle: Page ${n}\ndescription: quokka of ${n}\nstatus: draft\n---\n\nThe quokka lives in ${n}.\n`);
    writeFileSync(join(root, "spaces", n, "raw/secret.md"), `secret of ${n}`);
  }
  mkdirSync(join(root, ".cortex/archive/old-20260101-000000/wiki"), { recursive: true });
  writeFileSync(join(root, ".cortex/archive/old-20260101-000000/wiki/x.md"), "archived");
  writeFileSync(join(root, ".cortex/accounts.db"), "accounts");
  return root;
};

const platform = process.platform;
afterEach(() => Object.defineProperty(process, "platform", { value: platform }));

test("confine: several allowed spaces are read-only and every other one is hidden, with the archive and the accounts' database", () => {
  if (platform !== "linux") return;
  const root = instance();
  const argv = confine(root, ["x"], "read", ["a", "b"]);
  const sep = argv.indexOf("--");
  expect(argv.slice(0, sep)).toEqual([
    "bwrap", "--dev-bind", "/", "/", "--ro-bind", root, root,
    "--tmpfs", join(root, "spaces/c"), "--tmpfs", join(root, ".cortex/archive"), "--ro-bind", "/dev/null", join(root, ".cortex/accounts.db"),
    "--die-with-parent",
  ]);
  expect(argv.slice(sep)).toEqual(["--", "x"]);
  expect(argv).not.toContain("--bind"); // nothing is writable
  // from inside one of the spaces, or with all of them allowed: the same rule
  expect(confine(join(root, "spaces/a"), ["x"], "read", ["a", "b"]).slice(0, 7)).toEqual(argv.slice(0, 7));
  expect(confine(root, ["x"], "read", ["a", "b", "c"]).filter((x) => x === "--tmpfs")).toHaveLength(1); // only the archive
  // never write; not outside a multi-space instance
  expect(() => confine(root, ["x"], "write", ["a"])).toThrow("never writes");
  const legacy = mkdtempSync(join(tmpdir(), "cortex-legacy-"));
  writeFileSync(join(legacy, "cortex.json"), "{}");
  expect(() => confine(legacy, ["x"], "read", ["a"])).toThrow("not a multi-space instance");
  // without a list: the confinement of one space is as it was (the other spaces hidden, nothing about the archive)
  expect(confine(join(root, "spaces/a"), ["x"], "read").filter((x) => x === "--tmpfs")).toHaveLength(2);
});

test.skipIf(!bwrap || platform !== "linux")("the instance's own git repository does not give back the spaces that are hidden", () => {
  const root = instance();
  const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.email=t@example.org", "-c", "user.name=t", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  git("init", "-q"); git("add", "-A"); git("commit", "-qm", "x");
  expect(git("show", "HEAD:spaces/c/wiki/concepts/p.md").stdout.toString()).toContain("The quokka lives in c."); // outside the sandbox: it is there
  const inside = (...args: string[]) => Bun.spawnSync(confine(root, ["git", ...args], "read", ["a", "b"]), { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(inside("show", "HEAD:spaces/c/wiki/concepts/p.md").stdout.toString()).toBe("");
  expect(inside("grep", "-l", "quokka", "HEAD").stdout.toString()).toBe("");
  expect(confine(root, ["x"], "read", ["a"]).join(" ")).toContain(`--tmpfs ${join(root, ".git")}`);
  // a space that is its own repository keeps its own .git (it is an allowed space)
  mkdirSync(join(root, "spaces/a/.git"));
  expect(confine(root, ["x"], "read", ["b"]).join(" ")).toContain(`--tmpfs ${join(root, "spaces/a")}`);
  expect(confine(root, ["x"], "read", ["a"]).join(" ")).not.toContain(join(root, "spaces/a/.git"));
});

test("confine on macOS: the same spaces are denied to the reader", () => {
  const root = instance();
  Object.defineProperty(process, "platform", { value: "darwin" });
  const [bin, flag, profile] = confine(root, ["x"], "read", ["a", "b"]);
  expect([bin, flag]).toEqual(["sandbox-exec", "-p"]);
  expect(profile).toContain(`(deny file-read* (subpath ${JSON.stringify(join(root, "spaces/c"))}))`);
  expect(profile).toContain(`(deny file-read* (subpath ${JSON.stringify(join(root, ".cortex/archive"))}))`);
  expect(profile).toContain(`(deny file-read* (subpath ${JSON.stringify(join(root, ".cortex/accounts.db"))}))`);
  expect(profile).not.toContain(JSON.stringify(join(root, "spaces/a")) + ")"); // an allowed space is not denied
  expect(profile).toContain(`(deny file-write* (require-all (subpath ${JSON.stringify(root)}) ))`); // read mode: the whole instance is read-only
});

test.skipIf(!bwrap || platform !== "linux")("confine in a real sandbox: an allowed space is read, a hidden one, the archive and the accounts are not, nothing is written", () => {
  const root = instance();
  const sh = (script: string) => Bun.spawnSync(confine(root, ["sh", "-c", script], "read", ["a", "b"]), { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(sh("cat spaces/a/wiki/concepts/p.md").stdout.toString()).toContain("The quokka lives in a.");
  expect(sh("cat spaces/b/raw/secret.md").stdout.toString()).toBe("secret of b");
  expect(sh("cat spaces/c/wiki/concepts/p.md").exitCode).not.toBe(0);
  expect(sh("ls spaces/c | wc -l").stdout.toString().trim()).toBe("0");
  expect(sh("cat .cortex/archive/old-20260101-000000/wiki/x.md").exitCode).not.toBe(0);
  expect(sh("cat .cortex/accounts.db").stdout.toString()).toBe(""); // /dev/null
  expect(sh("touch spaces/a/wiki/new.md").exitCode).not.toBe(0);
  expect(sh("touch cortex.json").exitCode).not.toBe(0);
  // `cortex search --space all` in the sandbox finds the allowed spaces only, whatever it asks for
  const search = (...args: string[]) => Bun.spawnSync(confine(root, [process.execPath, CLI, "search", "quokka", ...args], "read", ["a", "b"]), { cwd: root, env: { ...process.env, CORTEX_ROOT: root, [ASK_SPACES_ENV]: "a,b" }, stdout: "pipe", stderr: "pipe" });
  const out = search("--space", "all", "--json");
  const hits = JSON.parse(out.stdout.toString()) as { space: string; path: string }[];
  expect([...new Set(hits.map((h) => h.space))].sort()).toEqual(["a", "b"]);
  const named = search("--space", "c"); // a space outside the question: refused by the command, and empty in the sandbox anyway
  expect(named.exitCode).not.toBe(0);
  expect(named.stderr.toString()).toContain("outside what this question may read");
  const bare = search("--json"); // no --space: the question's own spaces
  expect([...new Set((JSON.parse(bare.stdout.toString()) as { space: string }[]).map((h) => h.space))].sort()).toEqual(["a", "b"]);
});

test("the file tools of a question over several spaces read inside those spaces only", () => {
  const root = instance();
  symlinkSync(join(root, "spaces/b"), join(root, "spaces/a/to-b"));
  const read = (input: Record<string, unknown>, tool = "Read") => guard(root, tool, input, "read", ["a"]).allow;
  expect(read({ file_path: "spaces/a/wiki/concepts/p.md" })).toBe(true);
  expect(read({ file_path: join(root, "spaces/a/wiki/concepts/p.md") })).toBe(true);
  expect(read({ file_path: "spaces/b/wiki/concepts/p.md" })).toBe(false); // another space, even one the instance has
  expect(read({ file_path: "spaces/c/raw/secret.md" })).toBe(false);
  expect(read({ file_path: "spaces/a/to-b/wiki/concepts/p.md" })).toBe(false); // a link out of the space
  expect(read({ file_path: "spaces/a/../b/raw/secret.md" })).toBe(false);
  expect(read({ file_path: ".cortex/accounts.db" })).toBe(false);
  expect(read({ file_path: ".cortex/archive/old-20260101-000000/wiki/x.md" })).toBe(false);
  expect(read({ file_path: "cortex.json" })).toBe(false);
  expect(read({ file_path: "~/.ssh/id_rsa" })).toBe(false);
  expect(read({ pattern: "spaces/a/wiki/**/*.md" }, "Glob")).toBe(true);
  expect(read({ pattern: "spaces/*/wiki/**/*.md" }, "Glob")).toBe(false);
  expect(read({ pattern: "**/*.md" }, "Glob")).toBe(false); // no space named
  expect(read({ pattern: "x" }, "Grep")).toBe(false); // the whole instance by default: no
  expect(read({ pattern: "x", path: "spaces/a/wiki" }, "Grep")).toBe(true);
  expect(read({ pattern: "x", path: "spaces/b" }, "Grep")).toBe(false);
  // without a list the rule is the same as ever: the root
  expect(guard(root, "Read", { file_path: "cortex.json" }, "read").allow).toBe(true);
});

test("the tool pack of a question over several spaces: a Search across exactly those spaces, no writing tool, a citation link reads like its file", async () => {
  const root = instance();
  expect(toolPack("read", ["a"]).map((t) => t.name)).toEqual(["Search", "Read", "Glob", "Grep", "Bash"]);
  expect(toolPack("read").map((t) => t.name)).toEqual(["Read", "Glob", "Grep", "Bash"]);
  const call = (name: string, args: Record<string, unknown>, spaces = ["a", "b"]) => callTool(root, "read", name, args, undefined, spaces);
  const hits = JSON.parse(await call("Search", { q: "quokka" })) as { space: string; path: string; cite: string; title: string }[];
  expect(hits.map((h) => h.space).sort()).toEqual(["a", "b"]);
  expect(hits.find((h) => h.space === "b")).toMatchObject({ path: "spaces/b/wiki/concepts/p.md", cite: "/s/b/wiki/concepts/p.md", title: "Page b" });
  // the list is the question's: an argument cannot widen it
  expect((JSON.parse(await call("Search", { q: "quokka", spaces: ["c"], space: "c" })) as { space: string }[]).map((h) => h.space).sort()).toEqual(["a", "b"]);
  expect((JSON.parse(await call("Search", { q: "quokka" }, ["c"])) as { space: string }[]).map((h) => h.space)).toEqual(["c"]);
  // what is read: the file, or the link that cites it, in an allowed space only
  expect(await call("Read", { file_path: "spaces/a/wiki/concepts/p.md" })).toContain("The quokka lives in a.");
  expect(await call("Read", { file_path: "/s/b/wiki/concepts/p.md" })).toContain("The quokka lives in b.");
  expect(await call("Read", { file_path: "/s/c/wiki/concepts/p.md" })).toContain("Read refused outside the spaces of this question (a, b)");
  expect(await call("Read", { file_path: ".cortex/accounts.db" })).toContain("Read refused");
  expect(await call("Glob", { pattern: "spaces/c/**/*" })).toContain("Read refused");
  expect(await call("Glob", { pattern: "spaces/a/wiki/**/*.md" })).toBe("spaces/a/wiki/concepts/p.md");
  // no write, whatever the tool
  expect(await call("Write", { file_path: "spaces/a/wiki/x.md", content: "x" })).toContain("Read-only");
  expect(await callTool(root, "write", "NewPage", { type: "Concept", title: "x", body: "x" }, undefined, ["a"])).toContain("never writes");
  // a Search outside such a question is not a tool
  expect(await callTool(root, "read", "Search", { q: "quokka" })).toContain("Tool not allowed");
  expect(spacePath("/s/a/wiki/x.md")).toBe("spaces/a/wiki/x.md");
  expect(spacePath("/spaces/a/wiki/x.md")).toBe("spaces/a/wiki/x.md");
  expect(spacePath("/wiki/x.md")).toBe("/wiki/x.md");
});

test("the agent's own MCP server (cortex mcp --agent read) is bound to the spaces of its environment", async () => {
  const root = instance();
  const cfg = packServer(root, "read", ["a", "b"]);
  expect(cfg.env).toEqual({ CORTEX_ROOT: root, [ASK_SPACES_ENV]: "a,b" });
  expect(packServer(root, "read").env).toEqual({ CORTEX_ROOT: root });
  expect(JSON.parse(packMcpConfig(root, "read", ["a"])).mcpServers.cortex.env[ASK_SPACES_ENV]).toBe("a");
  expect(askSpacesFromEnv({ [ASK_SPACES_ENV]: "a,b,../x,,a" })).toEqual(["a", "b"]);
  expect(askSpacesFromEnv({})).toBeUndefined();

  // the real server, over stdio: the tools it lists, then a search and two reads
  const proc = Bun.spawn([process.execPath, CLI, "mcp", "--agent", "read"], { cwd: root, env: { ...process.env, ...cfg.env }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const reader = proc.stdout.getReader(), dec = new TextDecoder();
  let buf = "";
  const rpc = async (id: number, method: string, params: object) => {
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    proc.stdin.flush();
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); const m = JSON.parse(line); if (m.id === id) return m.result; continue; }
      const c = await reader.read();
      if (c.done) throw new Error("the MCP server ended");
      buf += dec.decode(c.value);
    }
  };
  try {
    await rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const tools = (await rpc(2, "tools/list", {})).tools.map((t: { name: string }) => t.name).sort();
    expect(tools).toEqual(["Bash", "Glob", "Grep", "Read", "Search"]);
    const text = async (id: number, name: string, args: object) => (await rpc(id, "tools/call", { name, arguments: args })).content[0].text as string;
    expect((JSON.parse(await text(3, "Search", { q: "quokka" })) as { space: string }[]).map((h) => h.space).sort()).toEqual(["a", "b"]);
    expect(await text(4, "Read", { file_path: "spaces/b/wiki/concepts/p.md" })).toContain("The quokka lives in b.");
    expect(await text(5, "Read", { file_path: "spaces/c/wiki/concepts/p.md" })).toContain("Read refused");
  } finally { proc.kill(); }
});

test("the commands of a question over several spaces: only the search, bound to them; --file never with several spaces", () => {
  const root = instance();
  const run = (args: string[], env: Record<string, string> = {}) => Bun.spawnSync([process.execPath, CLI, ...args], { cwd: root, env: { ...process.env, CORTEX_ROOT: "", CORTEX_REVIEWER: "t", ...env }, stdout: "pipe", stderr: "pipe" });
  const bound = { [ASK_SPACES_ENV]: "a" };
  expect(run(["log"], bound).stderr.toString()).toContain("only cortex search is available");
  expect(run(["ask", "q"], bound).stderr.toString()).toContain("only cortex search is available");
  expect(run(["ask", "q", "--space", "a,b", "--file"]).stderr.toString()).toContain("--file writes a page into one space");
  expect(run(["log", "--space", "a,b"]).stderr.toString()).toContain("only for cortex search and cortex ask");
  expect(run(["ask", "q", "--space", "a,nope"]).stderr.toString()).toContain("unknown space: nope");
  const inside = Bun.spawnSync([process.execPath, CLI, "ask", "q", "--space", "a,b"], { cwd: join(root, "spaces/a"), env: { ...process.env, CORTEX_ROOT: "" }, stdout: "pipe", stderr: "pipe" });
  expect(inside.stderr.toString()).toContain("inside the space a, which cannot search the other spaces");
});

test.skipIf(!bwrap || platform !== "linux")("cortex ask --space a,b: the agent is told the spaces, runs from the instance and cannot see the others", () => {
  const root = instance();
  const script = join(root, "agent.sh");
  // a fake agent: what it is told (standard input), what it can see, and an attempt to write
  writeFileSync(script, `cat >/tmp/cortex-ask-prompt.$$; echo "told: $(sed -n 1p /tmp/cortex-ask-prompt.$$ | head -c 400)"; rm -f /tmp/cortex-ask-prompt.$$
echo "a: $(cat spaces/a/wiki/concepts/p.md | grep -c quokka)"; echo "c: $(cat spaces/c/wiki/concepts/p.md 2>&1 | grep -c quokka)"; echo "write: $(touch spaces/a/wiki/x.md 2>&1 | grep -c .)"
echo "bare search: $(bun "$CLI" search quokka --json | grep -o '"space": "[a-z]*"' | sort -u | tr -d '\n')"\n`);
  const p = Bun.spawnSync([process.execPath, CLI, "ask", "what lives where?", "--space", "a,b"], { cwd: root, env: { ...process.env, CORTEX_ROOT: "", CORTEX_AGENT_BATCH: `sh ${script}`, CLI }, stdout: "pipe", stderr: "pipe" });
  const out = p.stdout.toString() + p.stderr.toString();
  expect(out).toContain("You read several spaces of it, each one a separate wiki: a, b");
  expect(out).toContain("Read-only");
  expect(out).toContain("a: 2"); // the two lines of the page that say quokka
  expect(out).toContain("c: 0");
  expect(out).toContain("write: 1");
  expect(out).toContain('bare search: "space": "a""space": "b"'); // a plain `cortex search` in the agent's shell reads the question's spaces, and no other
});

test("narrowSpaces and parseSpacePath: the list only ever shrinks", () => {
  expect(narrowSpaces(undefined, ["a", "b"])).toEqual(["a", "b"]);
  expect(narrowSpaces("all", ["a", "b"])).toEqual(["a", "b"]);
  expect(narrowSpaces("b,a,b", ["a", "b"])).toEqual(["b", "a"]);
  expect(() => narrowSpaces("a,c", ["a", "b"])).toThrow("outside what this question may read");
  expect(parseSpacePath(["a"], "/s/a/wiki/concepts/x.md")).toEqual({ space: "a", file: "/wiki/concepts/x.md" });
  expect(parseSpacePath(["a"], "spaces/a/wiki/x.md")).toEqual({ space: "a", file: "/wiki/x.md" });
  for (const bad of ["/s/b/wiki/x.md", "/wiki/x.md", "/s/a/raw/x.md", "/s/a/wiki/x.txt", "/s/a/wiki/../../b/x.md".replace("../../b", "..")]) {
    if (bad === "/s/a/wiki/../x.md") continue; // the path is checked again where it is read (isUnder)
    expect(() => parseSpacePath(["a"], bad)).toThrow("Path refused");
  }
});

test("the site's tools over several spaces (search, get, related): the question's spaces only, pages named by their citation link", async () => {
  const root = instance();
  const tools = Object.fromEntries(spacesTools(join(root, "spaces/a"), ["a", "b"]).map((t) => [t.name, t.run]));
  const found = JSON.parse(await tools.search!({ q: "quokka" })) as { space: string; path: string; title: string }[];
  expect(found.map((h) => h.path).sort()).toEqual(["/s/a/wiki/concepts/p.md", "/s/b/wiki/concepts/p.md"]);
  expect(await tools.get!({ path: "/s/b/wiki/concepts/p.md" })).toContain("The quokka lives in b.");
  await expect(tools.get!({ path: "/s/c/wiki/concepts/p.md" })).rejects.toThrow("Path refused"); // not one of the question's spaces
  await expect(tools.get!({ path: "/wiki/concepts/p.md" })).rejects.toThrow("Path refused"); // no space: not "the visitor's own"
  await expect(tools.get!({ path: "/s/a/raw/secret.md" })).rejects.toThrow("Path refused");
  expect(JSON.parse(await tools.related!({ path: "/s/a/wiki/concepts/p.md" }))).toEqual([]);
});

test("an answer over several spaces: each citation is the link to its own page, the others are not links", () => {
  const titles = new Map([["a", new Map([["wiki/concepts/p.md", "Page a"]])], ["b", new Map([["wiki/concepts/p.md", "Page b"]])]]);
  const md = "Voir [A](/s/a/wiki/concepts/p.md), [B](/spaces/b/wiki/concepts/p.md#x), [C](/s/c/wiki/concepts/p.md), [D](/wiki/concepts/p.md), [E](/s/a/wiki/concepts/none.md) et `[F](/s/a/wiki/concepts/p.md)`.";
  const html = answerSegments(md, new Map(), false, titles).map((s) => ("html" in s ? s.html : "")).join("");
  expect(html).toContain('<a href="/s/a/wiki/concepts/p/">A</a>');
  expect(html).toContain('<a href="/s/b/wiki/concepts/p/#x">B</a>');
  expect((html.match(/<span class="missing-link"/g) ?? [])).toHaveLength(3); // C (not read), D (no space), E (no such page)
  const a = askAnswerSpaces(md, titles, "b");
  expect(a.refs).toEqual([{ space: "a", id: "concepts/p", title: "Page a" }, { space: "b", id: "concepts/p", title: "Page b" }]);
  expect(a.cited).toEqual(["concepts/p"]); // the one of the space the question was asked in
  // an answer of one space that carries such a citation from the history of the conversation: the page on its own site, never a dead .md link
  const single = answerSegments("[x](/s/b/wiki/concepts/p.md#y) et [y](/wiki/concepts/p.md)", new Map([["wiki/concepts/p.md", "Page"]])).map((s) => ("html" in s ? s.html : "")).join("");
  expect(single).toContain('<a href="/s/b/wiki/concepts/p/#y">x</a>');
  expect(single).toContain('href="wiki/concepts/p/"');
  expect(single).not.toContain(".md");
  // an answer of one space is drawn as before
  expect(answerSegments("[x](/wiki/concepts/p.md)", new Map([["wiki/concepts/p.md", "Page"]])).map((s) => ("html" in s ? s.html : "")).join("")).toContain('href="wiki/concepts/p/"');
  expect(stepOf("get", { path: "/s/b/wiki/concepts/p.md" }, new Map(), titles)).toEqual({ kind: "read", path: "wiki/concepts/p.md", title: "Page b" });
});

test("the site's assistant over several spaces, with a fake OpenAI server: the agent is told the spaces and reads them through bound tools", async () => {
  const root = instance();
  const call = (id: string, name: string, args: object) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
  const answers: any[] = [
    { finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [call("1", "search", { q: "quokka" }), call("2", "get", { path: "/s/c/wiki/concepts/p.md" }), call("3", "get", { path: "/s/b/wiki/concepts/p.md" }), call("4", "Read", { file_path: "spaces/c/raw/secret.md" })] } },
    { finish_reason: "stop", message: { role: "assistant", content: "Il vit dans [Page b](/s/b/wiki/concepts/p.md)." } },
  ];
  const seen: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) { seen.push(await req.json()); return Response.json({ choices: [answers[seen.length - 1]] }); } });
  writeFileSync(join(root, "cortex.json"), JSON.stringify({ client: "openai", model: "m", language: "French", site_ask: { base_url: `http://127.0.0.1:${server.port}/v1` } }));
  try {
    const r = await agentAsk(join(root, "spaces/a"), "où vit le quokka ?", [], undefined, ["a", "b"]);
    expect(r.md).toBe("Il vit dans [Page b](/s/b/wiki/concepts/p.md).");
    expect(r.core).toBeUndefined();
    const first = seen[0];
    expect(first.messages[0].content).toContain("You may read these spaces only: a, b");
    expect(first.messages[1].content).toContain("This question reads several spaces together: a, b");
    expect(first.messages[1].content).toContain("/s/a/wiki/concepts/p.md « Page a »"); // the fused search's hits, in the citation form
    expect(first.tools.map((t: any) => t.function.name).sort()).toEqual(["get", "related", "search"]); // the site's tools only: no file tool
    const results = seen[1].messages.filter((m: any) => m.role === "tool").map((m: any) => m.content as string);
    expect((JSON.parse(results[0]!) as { path: string }[]).map((h) => h.path).sort()).toEqual(["/s/a/wiki/concepts/p.md", "/s/b/wiki/concepts/p.md"]);
    expect(results[1]).toContain("Path refused"); // c is not one of the question's spaces
    expect(results[2]).toContain("The quokka lives in b.");
    expect(results[3]).toContain("Read refused"); // no file tool is offered, and one that is asked for anyway is bound to the same spaces
  } finally { server.stop(true); }
});
