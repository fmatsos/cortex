import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountsFile, addSpaceMember, createSession, openAccounts, randomToken, setSpace, sha256, upsertUser } from "./accounts";
import { pendingSources } from "./pending";
import { serve } from "./serve";

// `POST /api/compile` and `GET /api/compile` of `cortex serve`: who may start a compile, and what a run does with the sources of a space.
// Neither the export nor the compile is real: a script stands for each (the compile one marks the source compiled and writes a page, or fails on an id with "bad").
const dir = mkdtempSync(join(tmpdir(), "cortex-fake-compile-"));
const exporter = join(dir, "export.ts"), compiler = join(dir, "compile.ts"), builds = join(dir, "builds.log"), order = join(dir, "order.log"), gate = join(dir, "gate");
writeFileSync(exporter, `
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
const [out, log] = Bun.argv.slice(2);
appendFileSync(log, "build\\n");
mkdirSync(out, { recursive: true });
writeFileSync(out + "/index.html", "site");
`);
writeFileSync(compiler, `
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const [id, log, gate] = Bun.argv.slice(2), root = process.env.CORTEX_ROOT!;
appendFileSync(log, id + "\\n");
if (id === "a1-ok") while (!existsSync(gate)) await Bun.sleep(10); // held until the test lets it go
const file = root + "/" + [...new Bun.Glob("raw/**/" + id + "/source.md").scanSync({ cwd: root })][0];
const text = readFileSync(file, "utf8");
mkdirSync(root + "/wiki/sources", { recursive: true });
if (id.includes("bad")) { // a half-done compile: a tracked file changed, a file created, the source touched
  writeFileSync(root + "/wiki/index.md", readFileSync(root + "/wiki/index.md", "utf8") + "half done\\n");
  writeFileSync(root + "/wiki/sources/junk.md", "junk");
  writeFileSync(file, text.replace("status: pending", "status: half"));
  console.error("boom");
  process.exit(1);
}
writeFileSync(file, text.replace("status: pending", "status: compiled"));
writeFileSync(root + "/wiki/sources/" + id + ".md", "page of " + id);
`);

const AUTH = { auth: { public_urls: ["http://localhost"], github: { client_id: "x", allow: [1] } } };
const WITH_CLIENT = { ...AUTH, client: "claude", model: "haiku" };
const SECRET = "CORTEX_GITHUB_CLIENT_SECRET";
let saved: string | undefined;
beforeAll(() => { saved = process.env[SECRET]; process.env[SECRET] = "s"; });
afterAll(() => { if (saved === undefined) delete process.env[SECRET]; else process.env[SECRET] = saved; });

const sh = (cwd: string, ...a: string[]) => { const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stderr: "pipe", stdout: "pipe" }); if (r.exitCode) throw new Error(r.stderr.toString()); return r.stdout.toString().trim(); };
const source = (root: string, space: string, id: string, status = "pending", title = id) => {
  const d = join(root, "spaces", space, "raw/2026/11", id);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "source.md"), `---\ntype: Note\ntitle: ${title}\nstatus: ${status}\n---\nbody of ${id}\n`);
};
/** A multi-space instance with a space `mine` (and `open`, with no member): `ids` are its pending sources. */
const instance = (config: object, ids: string[] = []) => {
  const root = mkdtempSync(join(tmpdir(), "cortex-compile-serve-"));
  writeFileSync(join(root, "cortex.json"), JSON.stringify(config));
  for (const n of ["mine", "open"]) { mkdirSync(join(root, "spaces", n, "wiki"), { recursive: true }); writeFileSync(join(root, "spaces", n, "wiki/index.md"), "index\n"); }
  for (const id of ids) source(root, "mine", id);
  return root;
};
const person = (root: string, sub: string) => {
  const db = openAccounts(accountsFile(root)), now = Date.now(), user = upsertUser(db, "github", sub, sub, null, now), token = randomToken();
  createSession(db, user.id, sha256(token), now, 86_400_000);
  db.close();
  return { id: user.id, cookie: { cookie: `cortex_session=${token}` } };
};
const member = (root: string, space: string, userId: string) => { const db = openAccounts(accountsFile(root)); addSpaceMember(db, space, userId, "member"); db.close(); };

const servers: { stop(force?: boolean): unknown }[] = [];
afterEach(() => { servers.splice(0).forEach((s) => s.stop(true)); });
const start = async (root: string, sync = false) => {
  const said: string[] = [];
  const server = await serve(root, {
    port: 0, sync, reviewer: "t", say: (m) => said.push(m), settleMs: 5, embeddings: async () => undefined,
    exportCmd: (_, out) => [process.execPath, exporter, out, builds],
    compileCmd: (_, id) => [process.execPath, compiler, id, order, gate],
  });
  servers.push(server);
  const origin = `http://localhost:${server.port}`;
  const get = (path: string, headers: Record<string, string> = {}) => fetch(origin + path, { redirect: "manual", headers });
  const post = (path: string, headers: Record<string, string> = { origin }) => fetch(origin + path, { method: "POST", redirect: "manual", headers });
  return { said, origin, get, post };
};
const until = async (ok: () => boolean | Promise<boolean>, ms = 15_000) => { const t = performance.now(); while (!(await ok())) { if (performance.now() - t > ms) throw new Error("timeout"); await Bun.sleep(10); } };
const lines = (f: string) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean) : []);
type Status = { running: boolean; pending: number; done: number; failed: number; current?: { id: string; title: string }; lastError?: string };

test("POST /api/compile is refused anonymously (401), to a stranger of the space (403), cross-origin (403), read-only (409), with no client (400)", async () => {
  const root = instance(WITH_CLIENT, ["a1-ok"]), ada = person(root, "1"), bob = person(root, "2");
  member(root, "mine", ada.id);
  const { get, post, origin } = await start(root);
  const url = "/s/mine/api/compile";
  expect((await post(url)).status).toBe(401); // anonymous, with the site's Origin: an open space does not make it free
  expect((await get(url)).status).toBe(401);
  expect((await post("/s/open/api/compile", { origin, ...ada.cookie })).status).toBe(403); // signed in, member of another space
  expect((await post(url, { origin, ...bob.cookie })).status).toBe(403); // signed in, not a member of this one
  expect((await get(url, bob.cookie)).status).toBe(403);
  expect((await post(url, { origin: "http://evil.example", ...ada.cookie })).status).toBe(403);
  expect((await post(url, ada.cookie)).status).toBe(403); // no Origin: a script, not the site
  const db = openAccounts(accountsFile(root)); setSpace(db, "mine", { read_only: true }); db.close();
  const ro = await post(url, { origin, ...ada.cookie });
  expect([ro.status, ((await ro.json()) as { error: string }).error]).toEqual([409, expect.stringContaining("read-only")]);
  expect(lines(order)).toEqual([]); // nothing ran
  const bare = instance(AUTH, ["a1-ok"]), eve = person(bare, "3");
  member(bare, "mine", eve.id);
  const other = await start(bare);
  const noClient = await other.post(url, { origin: other.origin, ...eve.cookie });
  expect([noClient.status, ((await noClient.json()) as { error: string }).error]).toEqual([400, expect.stringContaining("client")]);
  // a space served alone has no members: signed in is enough, anonymous is not
  const legacy = mkdtempSync(join(tmpdir(), "cortex-compile-legacy-"));
  writeFileSync(join(legacy, "cortex.json"), JSON.stringify(WITH_CLIENT)); mkdirSync(join(legacy, "wiki"), { recursive: true });
  const solo = await start(legacy);
  expect((await solo.get("/api/compile")).status).toBe(401);
});

test("a run compiles the pending sources in order, commits each, restores the one that fails and goes on, refuses a second start meanwhile, and reports its counts", async () => {
  const d = mkdtempSync(join(tmpdir(), "cortex-compile-git-"));
  sh(d, "init", "-q", "--bare", "-b", "main", "remote.git"); sh(d, "clone", "-q", "remote.git", "seed");
  const seed = join(d, "seed");
  writeFileSync(join(seed, "cortex.json"), JSON.stringify(WITH_CLIENT));
  for (const n of ["mine", "open"]) { mkdirSync(join(seed, "spaces", n, "wiki"), { recursive: true }); writeFileSync(join(seed, "spaces", n, "wiki/index.md"), "index\n"); }
  for (const [id, status] of [["a1-ok", "pending"], ["a2-bad", "pending"], ["a3-ok", "pending"], ["a0-done", "compiled"]]) source(seed, "mine", id!, status);
  sh(seed, "add", "-A"); sh(seed, "commit", "-qm", "init"); sh(seed, "push", "-q", "-u", "origin", "main");
  sh(d, "clone", "-q", "remote.git", "work");
  const root = join(d, "work"), mine = join(root, "spaces/mine"), ada = person(root, "1");
  member(root, "mine", ada.id);
  const { get, post, origin, said } = await start(root, true);
  const as = { origin, ...ada.cookie }, status = async () => (await (await get("/s/mine/api/compile", ada.cookie)).json()) as Status;
  expect(await status()).toEqual({ running: false, pending: 3, done: 0, failed: 0 });
  const before = lines(builds).length;

  const first = await post("/s/mine/api/compile", as);
  expect(first.status).toBe(202);
  expect(((await first.json()) as Status).running).toBe(true);
  await until(() => lines(order).length === 1); // the first source is being compiled, held by the gate
  expect(await status()).toMatchObject({ running: true, pending: 3, current: { id: "a1-ok", title: "a1-ok" } });
  expect((await post("/s/mine/api/compile", as)).status).toBe(409); // already running
  expect((await post("/s/open/api/compile", as)).status).toBe(403); // (and the other space is not ada's)
  writeFileSync(gate, "go");
  await until(async () => !(await status()).running);

  expect(lines(order)).toEqual(["a1-ok", "a2-bad", "a3-ok"]); // in order, the compiled one never started
  expect(await status()).toEqual({ running: false, pending: 1, done: 2, failed: 1, lastError: expect.stringContaining("a2-bad: compile exited with code 1") });
  expect((await status()).lastError).toContain("boom");
  // each success is its own commit, pushed; nothing of the failure is left, in the tree or in the history
  expect(sh(root, "log", "--format=%s", "-3")).toBe("compile: a3-ok (claude/haiku)\ncompile: a1-ok (claude/haiku)\ninit");
  expect(sh(root, "status", "--porcelain", "--", "spaces/mine/raw", "spaces/mine/wiki")).toBe("");
  expect(sh(d, "--git-dir=remote.git", "log", "--format=%s", "-2", "main")).toBe("compile: a3-ok (claude/haiku)\ncompile: a1-ok (claude/haiku)");
  expect(readFileSync(join(mine, "wiki/index.md"), "utf8")).toBe("index\n");
  expect(existsSync(join(mine, "wiki/sources/junk.md"))).toBe(false);
  expect(existsSync(join(mine, "wiki/sources/a3-ok.md"))).toBe(true);
  expect((await pendingSources(mine)).map((s) => s.id)).toEqual(["a2-bad"]);
  await until(() => lines(builds).length > before); // a rebuild followed
  expect(said.filter((m) => m.startsWith("compile:")).at(-1)).toMatch(/^compile: 2 compiled, 1 failed in /);
});

test("pendingSources: only status pending, from the head of the file, titles unquoted, oldest first", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-pending-"));
  const put = (id: string, fm: string, eol = "\n", day = "01") => { const d = join(root, "raw/2026/11", day, id); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "source.md"), `---${eol}${fm.split("\n").join(eol)}${eol}---${eol}${"x".repeat(20_000)}`); };
  put("b-quoted", 'type: Note\nstatus: "pending"\ntitle: "Un titre: \\"cité\\""', "\r\n", "02");
  put("a-plain", "type: Note\nstatus: pending\ntitle: Plain title");
  put("c-done", "type: Note\nstatus: compiled\ntitle: Done");
  put("d-notitle", "status: pending");
  put("e-long", `note: ${"n".repeat(9000)}\nstatus: pending\ntitle: Long frontmatter`, "\n", "03");
  expect(await pendingSources(root)).toEqual([
    { id: "a-plain", path: "raw/2026/11/01/a-plain/source.md", title: "Plain title" },
    { id: "d-notitle", path: "raw/2026/11/01/d-notitle/source.md", title: "d-notitle" },
    { id: "b-quoted", path: "raw/2026/11/02/b-quoted/source.md", title: 'Un titre: "cité"' },
    { id: "e-long", path: "raw/2026/11/03/e-long/source.md", title: "Long frontmatter" },
  ]);
  expect(await pendingSources(join(root, "nothing"))).toEqual([]);
});
