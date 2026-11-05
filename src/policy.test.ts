import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guard } from "./backends/claude";

// Pins what each backend lets the agent run, per mode (REVIEW T8). The three dialects (agnostic
// --allowedTools, Claude regexes, opencode rules) come from one policy table; these literals are the
// values they had when it was hand-written in each backend.

const sorted = (a: string[]) => [...a].sort();

/** Fake agent CLI on the PATH: records its argv, swallows stdin. */
async function fakeBin(name: string, script: string) {
  const dir = mkdtempSync(join(tmpdir(), "cortex-bin-"));
  await Bun.write(join(dir, name), `#!/bin/sh\n${script}\n`);
  chmodSync(join(dir, name), 0o755);
  return dir;
}

/** Runs `backend.run` in a child process whose PATH starts with `bin` (Bun.spawn ignores PATH changes made after startup). */
async function runBackend(file: string, cfg: object, bin: string, root: string, mode: string) {
  const code = `const { default: b } = await import(${JSON.stringify(join(import.meta.dir, "backends", file))}); await b(${JSON.stringify(cfg)}).run(${JSON.stringify(root)}, "prompt", ${JSON.stringify(mode)}); process.exit(0);`; // exit: the fake server process may outlive run()
  const env: Record<string, string | undefined> = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  delete env.CORTEX_AGENT_BATCH;
  const p = Bun.spawn(["bun", "-e", code], { env, stdout: "ignore", stderr: "pipe" });
  const err = await new Response(p.stderr).text();
  expect([await p.exited, err]).toEqual([0, err]);
}

async function allowedToolsOf(mode: "read" | "write"): Promise<string[]> {
  const out = join(mkdtempSync(join(tmpdir(), "cortex-out-")), "argv");
  const bin = await fakeBin("claude", `cat >/dev/null; printf '%s\\n' "$@" > ${out}; echo ok`);
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "wiki/.keep"), "");
  await runBackend("default", {}, bin, root, mode);
  const argv = readFileSync(out, "utf8").trim().split("\n");
  // the cortex tool pack over MCP, Claude Code's own tools off
  expect(argv.slice(0, 3)).toEqual(["-p", "--strict-mcp-config", "--mcp-config"]);
  expect(JSON.parse(argv[3]).mcpServers.cortex.args.slice(-3)).toEqual(["mcp", "--agent", mode]);
  expect(argv.slice(4, 6)).toEqual(["--allowedTools", "mcp__cortex__*"]);
  expect(argv[6]).toBe("--disallowedTools");
  return argv.slice(7);
}

// Journal reading rules: the one difference the agnostic list had with the other two backends
// (REVIEW FAC-14: it lacked `cortex log` reading). Added on purpose when the policy table was introduced.

test("agent agnostique (claude -p) : le pack d'outils cortex par MCP, ses propres outils désactivés, en read comme en write", async () => {
  for (const mode of ["read", "write"] as const) expect(await allowedToolsOf(mode)).toContain("Write");
});

// command → [allowed in read, allowed in write]
const BASH: [string, boolean, boolean][] = [
  ["cortex search", true, true],
  ["cortex search context rot", true, true],
  ["cortex search \"a ; b | c\" --in raw", true, true],
  ["cortex searchx", false, false],
  ["cortex index", false, true],
  ["cortex index extra", false, true],
  ["cortex indexer", false, false],
  ["cortex lint", false, true],
  ["cortex lint --json", false, true],
  ["cortex new Concept \"Context rot\"", false, true],
  ["cortex new", false, true],
  ["cortex log", true, true],
  ["cortex log --json", true, true],
  ["cortex log --limit 5", true, true],
  ["cortex log --limit abc", false, false],
  ["cortex log --kind lint", true, true],
  ["cortex log --limit 5 --kind lint --json", true, true],
  ["cortex log --foo", false, false],
  ["cortex log add update \"x\"", false, true],
  ["cortex log add", false, true],
  ["cortex log addx", false, false],
  ["cortex logs add", false, false],
  ["cortex log --json add update \"x\"", false, false], // `add` hidden behind an option
  ["cortex log add update \"CLI : a ; b | c > d & l'idée\" --page wiki/concepts/x.md", false, true],
  ["cortex log add ingest 'texte avec `backticks` et $HOME' --source 01a1a5c9-5e80-7075-ae13-aab03b0a8697", false, true], // single quotes: literal
  ["cortex log add update \"x $(rm -rf wiki)\"", false, false], // expansion under double quotes
  ["cortex log add update \"x `id`\"", false, false],
  ["cortex log add update \"x\" ; rm -rf wiki", false, false], // chaining
  ["cortex log add update \"x\" && cortex index", false, false],
  ["cortex log add update \"x", false, false], // unclosed quote
  ["cortex log add update x > wiki/log.jsonl", false, false],
  ["cortex log add update \"x\"\nrm -rf wiki", false, false],
  ["cortex search \\'; touch /tmp/pwn; \\'", false, false], // escaped quote outside quotes
  ["cortex search a\\ b", false, false],
  ["cortex search x; sed -i s/a/b/ raw/x.md", false, false],
  ["cortex", false, false],
  ["echo x > raw/a.md", false, false],
  ["ls", false, false],
  ["cat wiki/index.md", false, false],
  [" cortex search x ", true, true], // the command is trimmed
  ["xcortex search x", false, false],
];

test("garde Claude : commandes Bash autorisées par mode", () => {
  for (const [command, read, write] of BASH) {
    expect([command, guard("/x", "Bash", { command }, "read").allow]).toEqual([command, read]);
    expect([command, guard("/x", "Bash", { command }, "write").allow]).toEqual([command, write]);
  }
});

test("opencode : le pack d'outils cortex par MCP (config inline), ses propres outils refusés, en read comme en write", async () => {
  const bodies: any[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (req.method === "POST" && path === "/api/session") { bodies.push(await req.json()); return Response.json({ data: { id: "s1" } }); }
      if (req.method === "GET") return Response.json({ data: [{ type: "assistant", content: [{ type: "text", text: "ok" }] }] });
      return new Response(null, { status: 204 });
    },
  });
  const out = join(mkdtempSync(join(tmpdir(), "cortex-out-")), "config");
  const bin = await fakeBin("opencode", `printf '%s' "$OPENCODE_CONFIG_CONTENT" > ${out}; echo "listening on http://127.0.0.1:${server.port}"; exec sleep 30`);
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  try { for (const mode of ["read", "write"] as const) await runBackend("opencode", {}, bin, root, mode); }
  finally { await server.stop(true); }
  const cortex = JSON.parse(readFileSync(out, "utf8")).mcp.servers.cortex; // the last run: write mode
  expect(cortex).toMatchObject({ type: "local", environment: { CORTEX_ROOT: root } });
  expect(cortex.command.slice(-3)).toEqual(["mcp", "--agent", "write"]);
  const r = (action: string, resource: string, effect: "allow" | "deny") => ({ action, resource, effect });
  const rules = [
    ...["read", "edit", "glob", "grep", "shell", "external_directory", "webfetch", "websearch", "subagent", "question", "skill", "execute"].map((a) => r(a, "*", "deny")),
    r("cortex_*", "*", "allow"),
  ];
  expect(bodies.map((b) => b.permissions)).toEqual([rules, rules]);
});
