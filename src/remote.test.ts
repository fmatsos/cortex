import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePayload, encodePayload, pack, pickRemote, readRemotes, refusal, remoteCommand, sshArgs } from "./remote";
import { mcpRoot } from "./test-helpers";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

test("cortex remote: add (first one is the default), list, default, remove; names and ssh targets checked", () => {
  const path = join(tmp("cortex-remotes-"), "cortex/remotes.json");
  expect(remoteCommand(["list"], {}, path)).toEqual(["No remote wiki (cortex remote add <name> <user@host>)."]);
  expect(remoteCommand(["add", "perso", "runner@192.168.1.138"], {}, path)[0]).toContain("default");
  remoteCommand(["add", "pro", "work"], { port: "2222" }, path);
  expect(remoteCommand(["list"], {}, path)).toEqual(["* perso  runner@192.168.1.138", "  pro  work:2222"]);
  remoteCommand(["default", "pro"], {}, path);
  expect(readRemotes(path).default).toBe("pro");
  remoteCommand(["remove", "pro"], {}, path);
  expect(readRemotes(path)).toEqual({ wikis: { perso: { ssh: "runner@192.168.1.138" } } });
  expect(() => remoteCommand(["add", "x", "-oProxyCommand=evil"], {}, path)).toThrow("not starting with -");
  expect(() => remoteCommand(["add", "a b", "h"], {}, path)).toThrow("remote name");
  expect(() => remoteCommand(["add", "x", "h"], { port: "0" }, path)).toThrow();
  expect(() => remoteCommand(["remove", "nope"], {}, path)).toThrow("unknown remote wiki");
  writeFileSync(path, "{ nope");
  expect(() => readRemotes(path)).toThrow(path);
});

test("pickRemote: --wiki or $CORTEX_WIKI first, then a local wiki, then the default", () => {
  const r = { default: "perso", wikis: { perso: { ssh: "h1" }, pro: { ssh: "h2" } } };
  expect(pickRemote("pro", true, r)).toEqual({ name: "pro", ssh: "h2" });
  expect(() => pickRemote("nope", false, r)).toThrow("unknown remote wiki: nope");
  expect(pickRemote(undefined, true, r)).toBeUndefined();
  expect(pickRemote(undefined, false, r)).toEqual({ name: "perso", ssh: "h1" });
  expect(pickRemote(undefined, false, { wikis: {} })).toBeUndefined();
  process.env.CORTEX_WIKI = "pro";
  try { expect(pickRemote(undefined, true, r)?.name).toBe("pro"); } finally { delete process.env.CORTEX_WIKI; }
});

test("payload: any argv comes back identical; anything else is refused", () => {
  const argv = ["add", "-", "--note", "l'été « 50 $ » `rm -rf` $(id)\n\"x\" \\ ; | &", "--json"];
  expect(decodePayload(encodePayload({ argv })).argv).toEqual(argv);
  expect(encodePayload({ argv })).toMatch(/^[A-Za-z0-9_-]+$/);
  for (const bad of ["%%%", Buffer.from("{}").toString("base64url"), Buffer.from('{"argv":[]}').toString("base64url"), Buffer.from('{"argv":[1]}').toString("base64url")])
    expect(() => decodePayload(bad)).toThrow("unreadable payload");
});

test("refusal: host jobs, phase-1 agent commands, writes to cortex.json, host paths, internal flags", () => {
  for (const c of ["serve", "share", "export", "inbox", "compile", "ask", "remote-exec", "upgrade", "doctor"]) expect(refusal([c])).toBeDefined();
  expect(refusal(["config", "set", "schema", "/etc/passwd"])).toContain("only reads");
  expect(refusal(["config", "init"])).toContain("only reads");
  expect(refusal(["config", "get", "language"])).toBeUndefined();
  expect(refusal(["mcp", "--agent", "write"])).toContain("internal");
  expect(refusal(["add", "/etc/passwd"])).toContain("neither a URL");
  expect(refusal(["add", "--note", "/etc/passwd", "https://x.y/z"])).toBeUndefined(); // an option value is not an input
  expect(refusal(["add", "-", "--note", "n"])).toBeUndefined();
  expect(refusal(["add", "@file:0"], 1)).toBeUndefined();
  expect(refusal(["add", "@file:1"], 1)).toContain("do not match");
  expect(refusal(["add", "@file:0"], 2)).toContain("do not match");
  expect(refusal(["search", "x", "--bogus"])).toContain("Unknown option");
  expect(refusal(["search", "x", "--json"])).toBeUndefined();
});

test("cortex remote add --identity: the key stored as an absolute path, checked to exist, passed to ssh alone", () => {
  const dir = tmp("cortex-key-"), path = join(dir, "remotes.json"), key = join(dir, "id_cortex");
  writeFileSync(key, "k");
  expect(remoteCommand(["add", "perso", "runner@h"], { identity: key }, path)[0]).toContain(`key ${key}`);
  expect(readRemotes(path).wikis.perso).toEqual({ ssh: "runner@h", identity: key });
  expect(() => remoteCommand(["add", "x", "h"], { identity: join(dir, "missing") }, path)).toThrow("no key file");
  const saved = process.env.HOME;
  process.env.HOME = dir;
  try { remoteCommand(["add", "y", "h"], { identity: "~/id_cortex" }, path); } finally { process.env.HOME = saved; }
  expect(readRemotes(path).wikis.y?.identity).toBe(key); // ~ expanded, never stored as typed
  expect(sshArgs({ ssh: "h", identity: key }, "P", false)).toEqual(["ssh", "-i", key, "-o", "IdentitiesOnly=yes", "--", "h", "cortex", "remote-exec", "P"]);
});

test("sshArgs: port, -t only when asked, the target after --", () => {
  expect(sshArgs({ ssh: "h" }, "P", false)).toEqual(["ssh", "--", "h", "cortex", "remote-exec", "P"]);
  expect(sshArgs({ ssh: "h", port: 2222 }, "P", true)).toEqual(["ssh", "-p", "2222", "-t", "--", "h", "cortex", "remote-exec", "P"]);
});

// End to end: a client with no wiki, a remotes.json, and an `ssh` on PATH that runs the server side here.
const client = tmp("cortex-client-"), bin = join(client, "bin"), log = join(client, "ssh.log");
const server = await mcpRoot();
Bun.spawnSync(["mkdir", "-p", bin, join(client, "config/cortex")]);
writeFileSync(join(bin, "ssh"), `#!/bin/sh
printf '%s\\n' "$*" >> "${log}"
while [ "$1" != "--" ]; do shift; done
shift 2  # --, the target
shift    # cortex
exec env CORTEX_ROOT="\${FAKE_SERVER:-${server}}" "${process.execPath}" "${join(import.meta.dir, "cortex.ts")}" "$@"
`);
chmodSync(join(bin, "ssh"), 0o755);
writeFileSync(join(client, "config/cortex/remotes.json"), JSON.stringify({ default: "perso", wikis: { perso: { ssh: "runner@host" } } }));
const clientEnv = (extra: Record<string, string> = {}) => {
  const env: Record<string, string | undefined> = { ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_CONFIG_HOME: join(client, "config"), NO_COLOR: "1", ...extra };
  delete env.CORTEX_ROOT; delete env.CORTEX_WIKI;
  return env;
};
const run = (args: string[], stdin?: string, extra: Record<string, string> = {}) => {
  const env = clientEnv(extra);
  const p = Bun.spawnSync([process.execPath, join(import.meta.dir, "cortex.ts"), ...args], { cwd: client, env, stdin: stdin === undefined ? "ignore" : new Blob([stdin]) });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};
const lastPayload = () => decodePayload(readFileSync(log, "utf8").trim().split("\n").at(-1)!.split(" ").at(-1)!).argv;

test("remote wiki end to end: search answers from the host, stdout stays clean JSON, the command goes first, --wiki is not sent", () => {
  const r = run(["--json", "search", "zythum", "--wiki", "perso"]);
  expect(r.code).toBe(0);
  expect(JSON.parse(r.out).length).toBeGreaterThan(0);
  expect(lastPayload()).toEqual(["search", "--json", "zythum"]);
  expect(readFileSync(log, "utf8")).not.toContain(" -t ");
});

test("remote wiki end to end: add of a local file travels in the envelope; add - passes stdin; exit codes come back", () => {
  writeFileSync(join(client, "note.md"), "# Ma note distante\n\nUn texte sur le zythum distant.\n");
  const r = run(["add", "note.md", "--note", "test"]);
  expect(r.code).toBe(0);
  expect(lastPayload()).toEqual(["add", "@file:0", "--note", "test"]);
  const added = readdirSync(join(server, "raw"), { recursive: true }).map(String).filter((f) => f.endsWith("source.md"));
  expect(added.some((f) => readFileSync(join(server, "raw", f), "utf8").includes("zythum distant"))).toBe(true);
  expect(existsSync(join(client, "raw"))).toBe(false);
  expect(run(["add", "-"], "Texte collé à distance, assez long pour une source.").code).toBe(0);
  const miss = run(["show", "nothing-like-this"]);
  expect(miss.code).not.toBe(0);
});

test("remote wiki end to end: refused commands say why in one line, locally, without calling ssh", () => {
  const before = readFileSync(log, "utf8");
  for (const c of ["export", "inbox", "compile"]) {
    const r = run([c]);
    expect(r.code).toBe(1);
    expect(r.err.trim().split("\n")).toHaveLength(1);
  }
  expect(run(["compile", "x"]).err).toContain("run it on the wiki host");
  expect(readFileSync(log, "utf8")).toBe(before);
});

test("remote-exec: needs the host's $CORTEX_ROOT; refuses a path of the host", () => {
  const exec = (env: Record<string, string>, ...a: string[]) => Bun.spawnSync([process.execPath, join(import.meta.dir, "cortex.ts"), "remote-exec", ...a], { env: { ...process.env, ...env } });
  const noRoot = { ...process.env } as Record<string, string>; delete noRoot.CORTEX_ROOT;
  const p1 = Bun.spawnSync([process.execPath, join(import.meta.dir, "cortex.ts"), "remote-exec", encodePayload({ argv: ["search", "x"] })], { env: noRoot });
  expect(p1.exitCode).toBe(1);
  expect(p1.stderr.toString()).toContain("CORTEX_ROOT");
  const p2 = exec({ CORTEX_ROOT: server }, encodePayload({ argv: ["add", "/etc/hostname"] }));
  expect(p2.exitCode).toBe(1);
  expect(p2.stderr.toString()).toContain("neither a URL");
  const p3 = exec({ CORTEX_ROOT: server, SSH_ORIGINAL_COMMAND: `cortex remote-exec ${encodePayload({ argv: ["version"] })}` });
  expect(p3.stdout.toString().trim()).toMatch(/^\d+\.\d+\.\d+/);
});

test("pack: only the inputs of add travel as files, never an option value that happens to name a file", async () => {
  const f = join(tmp("cortex-pack-"), "README.md");
  writeFileSync(f, "x");
  expect(await pack(["add", "https://x.y/z", "--note", f])).toEqual({ argv: ["add", "https://x.y/z", "--note", f] });
  const p = await pack(["add", f, "--note", f]);
  expect(p.argv).toEqual(["add", "@file:0", "--note", f]);
  expect(p.envelope?.files).toEqual([{ name: "README.md", b64: Buffer.from("x").toString("base64") }]);
  expect(await pack(["search", f])).toEqual({ argv: ["search", f] });
});

// A host whose checkout tracks a bare remote: what a forwarded command writes must be committed and pushed there.
const gitHost = async () => {
  const root = await mcpRoot(), bare = join(tmp("cortex-bare-"), "remote.git");
  const g = (cwd: string, ...a: string[]) => { const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stderr: "pipe" }); if (r.exitCode) throw new Error(r.stderr.toString()); return r.stdout.toString().trim(); };
  g(root, "init", "-q", "-b", "main"); g(root, "add", "-A"); g(root, "commit", "-qm", "init");
  g(root, "init", "-q", "--bare", "-b", "main", bare); g(root, "remote", "add", "origin", bare); g(root, "push", "-q", "-u", "origin", "main");
  return { root, log: () => g(bare, "log", "-1", "--format=%an%n%s", "main"), files: () => g(bare, "ls-tree", "-r", "--name-only", "main") };
};

test("remote wiki end to end: a forwarded add is committed and pushed by the host, in its own name", async () => {
  const host = await gitHost();
  const r = run(["add", "-", "--note", "distant"], "Une source ajoutée depuis une autre machine, sur le zythum.", { FAKE_SERVER: host.root });
  expect(r.code).toBe(0);
  expect(host.log()).toMatch(/^cortex-remote\ncortex add: \d+ files? changed$/);
  expect(host.files().split("\n").filter((f) => f.startsWith("raw/")).length).toBe(2);
});

test("remote wiki end to end: cortex mcp over ssh speaks JSON-RPC on a clean stdout; each add call is pushed", async () => {
  const host = await gitHost();
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "cortex.ts"), "mcp"], { cwd: client, env: clientEnv({ FAKE_SERVER: host.root }), stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const send = (m: object) => { proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n"); proc.stdin.flush(); };
  const reader = proc.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  const recv = async (id: number): Promise<any> => {
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl >= 0) { const msg = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1); if (msg.id === id) return msg; continue; }
      const { value, done } = await reader.read();
      if (done) throw new Error(`server stopped: ${await new Response(proc.stderr).text()}`);
      buf += value;
    }
  };
  try {
    send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    expect((await recv(1)).result.serverInfo.name).toBe("cortex");
    send({ method: "notifications/initialized" });
    send({ id: 2, method: "tools/call", params: { name: "search", arguments: { q: "zythum" } } });
    expect(JSON.parse((await recv(2)).result.content[0].text).hits.length).toBeGreaterThan(0);
    send({ id: 3, method: "tools/call", params: { name: "add", arguments: { text: "Un texte envoyé par MCP depuis une autre machine, sur le zythum." } } });
    expect((await recv(3)).result.isError).toBeUndefined();
    expect(host.log()).toMatch(/^cortex-remote\ncortex mcp: \d+ files? changed$/);
  } finally { proc.kill(); }
});
