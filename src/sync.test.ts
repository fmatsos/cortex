import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lock, syncMessage, withSync } from "./sync";

const sh = (cwd: string, ...a: string[]) => {
  const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stderr: "pipe", stdout: "pipe" });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString().trim();
};
/** A bare remote, and two clones: a (the host's checkout) and b (another writer: serve, the CI). */
const repos = () => {
  const d = mkdtempSync(join(tmpdir(), "cortex-sync-"));
  sh(d, "init", "-q", "--bare", "-b", "main", "remote.git");
  sh(d, "clone", "-q", "remote.git", "a");
  mkdirSync(join(d, "a/wiki"));
  writeFileSync(join(d, "a/wiki/p.md"), "1\n");
  writeFileSync(join(d, "a/cortex.json"), "{}");
  sh(join(d, "a"), "add", "-A"); sh(join(d, "a"), "commit", "-qm", "init"); sh(join(d, "a"), "push", "-q", "-u", "origin", "main");
  sh(d, "clone", "-q", "remote.git", "b");
  return { d, a: join(d, "a"), b: join(d, "b") };
};
const remoteFile = (d: string, f: string, ref = "main") => Bun.spawnSync(["git", "-C", join(d, "remote.git"), "show", `${ref}:${f}`]).stdout.toString();
const lastMessage = (d: string, ref = "main") => sh(join(d, "remote.git"), "log", "-1", "--format=%an%n%B", ref);
const pushFrom = (b: string, f: string, content: string) => { writeFileSync(join(b, f), content); sh(b, "add", "-A"); sh(b, "commit", "-qm", "other"); sh(b, "push", "-q"); };
const quiet = () => { const said: string[] = []; return { said, say: (m: string) => { said.push(m); } }; };

test("withSync: pulls first, then commits what the command wrote and pushes, with an English message listing the files", async () => {
  const { d, a, b } = repos();
  pushFrom(b, "wiki/q.md", "from b\n");
  const { say } = quiet();
  const seen = await withSync(a, "new", async () => {
    writeFileSync(join(a, "wiki/new.md"), "x\n");
    return existsSync(join(a, "wiki/q.md")); // the pull happened before the command
  }, say);
  expect(seen).toBe(true);
  expect(remoteFile(d, "wiki/new.md")).toBe("x\n");
  expect(lastMessage(d)).toBe("cortex-remote\ncortex new: 1 file changed\n\n- wiki/new.md");
});

test("withSync: rebases on a concurrent change on a host with no git identity configured (no pending branch)", async () => {
  const { d, a, b } = repos();
  const keys = ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"] as const;
  const saved = keys.map((k) => process.env[k]);
  Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "user.useConfigOnly", GIT_CONFIG_VALUE_0: "true" });
  try {
    await withSync(a, "new", async () => {
      pushFrom(b, "wiki/q.md", "from b\n"); // another writer, another file: a plain rebase
      writeFileSync(join(a, "wiki/new.md"), "x\n");
    }, quiet().say);
  } finally { keys.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i]))); }
  expect(remoteFile(d, "wiki/new.md")).toBe("x\n");
  expect(remoteFile(d, "wiki/q.md")).toBe("from b\n");
  expect(sh(join(d, "remote.git"), "branch", "--list", "cortex/pending-*")).toBe("");
});

test("withSync: a read command commits nothing; without an upstream the command just runs", async () => {
  const { d, a } = repos();
  const before = sh(join(d, "remote.git"), "rev-parse", "main");
  expect(await withSync(a, "search", async () => 42, quiet().say)).toBe(42);
  expect(sh(join(d, "remote.git"), "rev-parse", "main")).toBe(before);
  const solo = mkdtempSync(join(tmpdir(), "cortex-solo-"));
  sh(solo, "init", "-q");
  expect(await withSync(solo, "new", async () => { writeFileSync(join(solo, "x"), "1"); return "ran"; })).toBe("ran");
});

test("withSync: a failed command still commits what it wrote (thrown, or an exit code), and the error goes on", async () => {
  const { d, a } = repos();
  await expect(withSync(a, "add", async () => { writeFileSync(join(a, "wiki/half.md"), "h\n"); throw new Error("boom"); }, quiet().say)).rejects.toThrow("boom");
  expect(remoteFile(d, "wiki/half.md")).toBe("h\n");
  expect(lastMessage(d)).toContain("cortex add: 1 file changed (the command failed)");
  expect(await withSync(a, "index", async () => { writeFileSync(join(a, "wiki/i.md"), "i\n"); return 1; }, quiet().say, (c) => c !== 0)).toBe(1);
  expect(lastMessage(d)).toContain("cortex index: 1 file changed (the command failed)");
});

test("withSync: leftovers of an interrupted command are committed before the next one, never dropped", async () => {
  const { d, a } = repos();
  writeFileSync(join(a, "wiki/left.md"), "l\n");
  await withSync(a, "search", async () => 0, quiet().say);
  expect(remoteFile(d, "wiki/left.md")).toBe("l\n");
  expect(lastMessage(d)).toContain("cortex: changes left by an interrupted command (1 file changed)");
});

test("withSync: a push conflict keeps the work on a cortex/pending- branch of the remote, the checkout back at the remote", async () => {
  const { d, a, b } = repos();
  const { said, say } = quiet();
  await withSync(a, "new", async () => {
    pushFrom(b, "wiki/p.md", "from b\n"); // another writer pushes meanwhile, on the same line
    writeFileSync(join(a, "wiki/p.md"), "from a\n");
  }, say);
  expect(remoteFile(d, "wiki/p.md")).toBe("from b\n");
  const branch = sh(join(d, "remote.git"), "branch", "--list", "cortex/pending-*").replace(/^[* ]+/, "");
  expect(branch).toMatch(/^cortex\/pending-\d{8}-\d{6}$/);
  expect(remoteFile(d, "wiki/p.md", branch)).toBe("from a\n");
  expect(said.join("\n")).toContain(branch);
  expect(sh(a, "status", "--porcelain")).toBe("");
  expect(sh(a, "rev-parse", "HEAD")).toBe(sh(a, "rev-parse", "@{u}"));
});

test("withSync: an unreachable remote stops before running, nothing lost", async () => {
  const { a } = repos();
  sh(a, "remote", "set-url", "origin", "/nonexistent/remote.git");
  let ran = false;
  await expect(withSync(a, "search", async () => { ran = true; }, quiet().say)).rejects.toThrow("git pull failed");
  expect(ran).toBe(false);
});

test("lock: a dead holder is taken over; a live one is waited for, said once with its command and start", async () => {
  const { a } = repos();
  const dir = join(a, ".git/cortex.lock");
  mkdirSync(dir);
  writeFileSync(join(dir, "info.json"), JSON.stringify({ pid: 2 ** 22 + 7, cmd: "new", at: new Date().toISOString() }));
  (await lock(a, "search", () => { throw new Error("must not wait"); }, 20))();
  expect(existsSync(dir)).toBe(false);

  const holder = Bun.spawn(["sleep", "0.5"]);
  mkdirSync(dir);
  writeFileSync(join(dir, "info.json"), JSON.stringify({ pid: holder.pid, cmd: "compile", at: "2026-11-16T14:02:00" }));
  const { said, say } = quiet();
  const t0 = Date.now();
  const release = await lock(a, "search", say, 20);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(300);
  expect(said).toEqual(["waiting: cortex compile (started 14:02) is using the wiki"]);
  release();
});

test("syncMessage: at most 50 paths listed", () => {
  const paths = Array.from({ length: 52 }, (_, i) => `raw/${i}.md`);
  const m = syncMessage("add", paths);
  expect(m.split("\n")[0]).toBe("cortex add: 52 files changed");
  expect(m.endsWith("- … and 2 more")).toBe(true);
});
