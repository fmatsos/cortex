import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../package.json";
import { completedAt, exportArgv, markComplete, serve } from "./serve";

// The site is rebuilt by a child process: these tests use a real one (a small script standing for `cortex export --out`).
const script = join(mkdtempSync(join(tmpdir(), "cortex-fake-export-")), "export.ts");
writeFileSync(script, `
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
const [out, ms, mode, tag, log] = Bun.argv.slice(2);
appendFileSync(log, "start\\n");
await Bun.sleep(Number(ms));
if (mode === "fail") { console.error("boom"); process.exit(1); }
mkdirSync(out, { recursive: true });
if (mode !== "noindex") writeFileSync(out + "/index.html", tag);
if (mode === "partial") process.exit(3); // written, then died: never complete
`);

type Fake = { ms?: number; mode?: "ok" | "fail" | "noindex" | "partial"; tag?: string };
const wiki = () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-rebuild-"));
  writeFileSync(join(root, "cortex.json"), "{}");
  mkdirSync(join(root, "wiki"), { recursive: true });
  return { root, log: join(root, "builds.log"), builds: () => (existsSync(join(root, "builds.log")) ? readFileSync(join(root, "builds.log"), "utf8").split("\n").filter(Boolean).length : 0) };
};
/** A complete build left by a previous run. */
const leave = (root: string, name: "a" | "b", html: string, at?: number) => {
  const dir = join(root, ".cortex/serve", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  markComplete(dir);
  if (at) writeFileSync(`${dir}.done`, JSON.stringify({ at: new Date(at).toISOString() }));
};
const cmd = (w: ReturnType<typeof wiki>, f: Fake | (() => Fake)) => (_: string, out: string) => {
  const o = typeof f === "function" ? f() : f;
  return [process.execPath, script, out, String(o.ms ?? 0), o.mode ?? "ok", o.tag ?? "new", w.log];
};
const until = async (ok: () => boolean, ms = 15_000) => { const t = performance.now(); while (!ok()) { if (performance.now() - t > ms) throw new Error("timeout"); await Bun.sleep(10); } };
const body = async (port: number, path = "/") => (await fetch(`http://localhost:${port}${path}`)).text();

const servers: { stop(force?: boolean): unknown }[] = [];
afterEach(() => { servers.splice(0).forEach((s) => s.stop(true)); });
const start = async (w: ReturnType<typeof wiki>, f: Fake | (() => Fake), extra: Partial<Parameters<typeof serve>[1]> = {}) => {
  const said: string[] = [];
  const server = await serve(w.root, { port: 0, sync: false, reviewer: "t", say: (m) => said.push(m), exportCmd: cmd(w, f), settleMs: 20, ...extra });
  servers.push(server);
  return { server, said, port: server.port as number, rebuilt: () => said.filter((m) => m.startsWith("site rebuilt")).length };
};

test("cold start: nothing to serve yet, the first build is awaited, then marked complete and served", async () => {
  const w = wiki();
  const { port, said } = await start(w, { tag: "first" });
  expect(await body(port)).toBe("first");
  expect(completedAt(join(w.root, ".cortex/serve/a"))).toBeGreaterThan(0);
  expect(said.some((m) => /^site rebuilt in .* s .*1 request$/.test(m))).toBe(true);
});

test("a complete build left by a previous run is served at once, then replaced by the rebuild", async () => {
  const w = wiki();
  leave(w.root, "a", "old");
  const t0 = performance.now();
  const { port, rebuilt } = await start(w, { ms: 1500, tag: "new" });
  expect(performance.now() - t0).toBeLessThan(1000); // not the 1.5 s of the build
  expect(await body(port)).toBe("old");
  await until(() => rebuilt() === 1);
  expect(await body(port)).toBe("new");
  expect(existsSync(join(w.root, ".cortex/serve/b/index.html"))).toBe(true);
  expect(existsSync(join(w.root, ".cortex/serve/a/index.html"))).toBe(true); // the one that served is only emptied by the next build
});

test("the newest of two complete builds is served, and the other one is rebuilt", async () => {
  const w = wiki();
  leave(w.root, "a", "newer", Date.now());
  leave(w.root, "b", "older", Date.now() - 60_000);
  const { port, rebuilt } = await start(w, { ms: 200, tag: "rebuilt" });
  expect(await body(port)).toBe("newer");
  await until(() => rebuilt() === 1);
  expect(await body(port)).toBe("rebuilt");
  expect(readFileSync(join(w.root, ".cortex/serve/a/index.html"), "utf8")).toBe("newer"); // built into b, never into the one served
});

test("requests are answered while the build runs in its child (the event loop stays free)", async () => {
  const w = wiki();
  leave(w.root, "a", "old");
  const { port, rebuilt } = await start(w, { ms: 1200 });
  const lat: number[] = [];
  while (rebuilt() === 0) { const t = performance.now(); await body(port); lat.push(performance.now() - t); await Bun.sleep(5); }
  expect(lat.length).toBeGreaterThan(20);
  expect(Math.max(...lat)).toBeLessThan(250);
});

test("a failing build keeps the previous site and says so; no marker, no swap", async () => {
  const w = wiki();
  leave(w.root, "a", "old");
  const { port, said } = await start(w, { mode: "fail" });
  await until(() => said.some((m) => m.startsWith("export failed")));
  expect(said.find((m) => m.startsWith("export failed"))).toContain("boom");
  expect(await body(port)).toBe("old");
  expect(completedAt(join(w.root, ".cortex/serve/b"))).toBeUndefined();
});

test("an export that exits non-zero after writing, or writes no index.html, is not swapped in", async () => {
  for (const mode of ["partial", "noindex"] as const) {
    const w = wiki();
    leave(w.root, "a", "old");
    const { port, said } = await start(w, { mode });
    await until(() => said.some((m) => m.startsWith("export failed")));
    expect(await body(port)).toBe("old");
    expect(completedAt(join(w.root, ".cortex/serve/b"))).toBeUndefined();
  }
});

test("a folder without its marker is never served: the first build is awaited, and a failure leaves nothing to serve", async () => {
  const w = wiki();
  mkdirSync(join(w.root, ".cortex/serve/a"), { recursive: true });
  writeFileSync(join(w.root, ".cortex/serve/a/index.html"), "half written"); // no a.done
  expect(completedAt(join(w.root, ".cortex/serve/a"))).toBeUndefined();
  writeFileSync(`${join(w.root, ".cortex/serve/b")}.done`, "{not json"); // a marker that is not one
  await expect(serve(w.root, { port: 0, sync: false, reviewer: "t", say: () => {}, exportCmd: cmd(w, { mode: "fail" }), settleMs: 0 })).rejects.toThrow("nothing to serve");
  const { port } = await start(w, { tag: "built" });
  expect(await body(port)).toBe("built");
});

test("three close requests give at most two builds: the one running, and one for all that came meanwhile", async () => {
  const w = wiki();
  leave(w.root, "a", "old");
  const { port, rebuilt, said } = await start(w, { ms: 600 });
  await until(() => w.builds() === 1); // the startup build is running
  const sync = () => fetch(`http://localhost:${port}/api/sync`, { method: "POST" });
  const rs = await Promise.all([sync(), sync(), sync()]);
  expect(rs.map((r) => r.status)).toEqual([200, 200, 200]); // accepted, not built yet
  await until(() => rebuilt() === 2);
  await Bun.sleep(300);
  expect(w.builds()).toBe(2);
  expect(rebuilt()).toBe(2);
  expect(said.filter((m) => m.startsWith("site rebuilt")).at(-1)).toContain("merged into one build"); // the journal tells how many requests this build served
});

test("the page embeddings never hold the swap, and run again after each build", async () => {
  const w = wiki();
  leave(w.root, "a", "old");
  let release!: () => void, calls = 0;
  const gate = new Promise<void>((r) => (release = r));
  const { port, rebuilt } = await start(w, { ms: 50 }, { embeddings: async () => { calls++; await gate; return undefined; } });
  await until(() => rebuilt() === 1);
  expect(await body(port)).toBe("new"); // swapped while the embeddings are still running
  expect(calls).toBe(1);
  release();
});

test("an embeddings failure is a line in the journal, the site stays", async () => {
  const w = wiki();
  leave(w.root, "a", "old");
  const { port, said, rebuilt } = await start(w, { ms: 20 }, { embeddings: async () => { throw new Error("server down"); } });
  await until(() => rebuilt() === 1);
  await until(() => said.some((m) => m === "embeddings: server down"));
  expect(await body(port)).toBe("new");
});

test("stopping the server stops the export child", async () => {
  const w = wiki();
  leave(w.root, "a", "old");
  const { server, said } = await start(w, { ms: 5000 });
  await until(() => w.builds() === 1);
  server.stop(true);
  await Bun.sleep(300);
  expect(said.some((m) => m.startsWith("export failed"))).toBe(false); // a stop is not a failure
  expect(completedAt(join(w.root, ".cortex/serve/b"))).toBeUndefined();
});

test("the export child is this very cortex: the entry point under src/, run with the same bun", async () => {
  const [bun, entry] = exportArgv("/wiki", "/out");
  expect(exportArgv("/wiki", "/out").slice(2)).toEqual(["export", "--out", "/out"]);
  const r = Bun.spawnSync([bun, entry, "--version"], { stdout: "pipe" });
  expect(r.stdout.toString().trim()).toBe(pkg.version);
});

// GET /api/status: the state of the build queue, as the site's small indicator reads it
type Status = { building: boolean; since?: string; last?: { at: string; ok: boolean; ms: number } };
const status = async (port: number) => { const r = await fetch(`http://localhost:${port}/api/status`); return { r, body: (await r.json()) as Status }; };
const idle = async (port: number, ms = 15_000) => { const t = performance.now(); while ((await status(port)).body.building) { if (performance.now() - t > ms) throw new Error("still building"); await Bun.sleep(20); } };

test("/api/status: idle after the first build, with how it went; never cached, no account", async () => {
  const w = wiki();
  const { port } = await start(w, { tag: "first" }); // the first build is awaited
  const { r, body } = await status(port);
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("no-store");
  expect(body.building).toBe(false);
  expect(body.since).toBeUndefined();
  expect(body.last).toMatchObject({ ok: true });
  expect(Date.parse(body.last!.at)).toBeGreaterThan(0);
  expect(body.last!.ms).toBeGreaterThanOrEqual(0);
});

test("/api/status: a build in its child is building (with since), then done once the new site is served", async () => {
  const w = wiki();
  leave(w.root, "a", "old");
  const { port, rebuilt } = await start(w, { ms: 800, tag: "new" });
  await until(() => w.builds() === 1); // the startup build is running
  const during = (await status(port)).body;
  expect(during.building).toBe(true);
  expect(Date.parse(during.since!)).toBeLessThanOrEqual(Date.now());
  expect(during.last).toBeUndefined(); // nothing finished since this process started
  expect(await body(port)).toBe("old");
  await until(() => rebuilt() === 1);
  const after = (await status(port)).body;
  expect(after.building).toBe(false);
  expect(after.since).toBeUndefined();
  expect(after.last).toMatchObject({ ok: true });
  expect(after.last!.ms).toBeGreaterThanOrEqual(800);
  expect(await body(port)).toBe("new"); // "not building" is only seen once the new site is served
});

test("/api/status: a request waiting for the quiet time, and a second build waiting behind the running one, are building too", async () => {
  const w = wiki();
  leave(w.root, "a", "old");
  const { port, rebuilt } = await start(w, { ms: 500 }, { settleMs: 400 });
  await until(() => rebuilt() === 1, 15_000); // startup build: quiet time, then 500 ms
  expect((await status(port)).body.building).toBe(false);
  await fetch(`http://localhost:${port}/api/sync`, { method: "POST" }); // accepted: nothing runs yet, the quiet time lasts 400 ms
  expect(w.builds()).toBe(1);
  expect((await status(port)).body.building).toBe(true); // waiting
  await until(() => w.builds() === 2);
  await fetch(`http://localhost:${port}/api/sync`, { method: "POST" }); // during the build: one more waits behind it
  await until(() => rebuilt() === 2);
  expect((await status(port)).body.building).toBe(true); // the first ended, the waiting one has not
  await until(() => rebuilt() === 3, 20_000);
  await idle(port, 5000);
});

test("/api/status: a failed build is reported (ok: false) and the previous site stays", async () => {
  const w = wiki();
  leave(w.root, "a", "old");
  const { port, said } = await start(w, { mode: "fail" });
  await until(() => said.some((m) => m.startsWith("export failed")));
  await idle(port);
  const { body: b } = await status(port);
  expect(b.last).toMatchObject({ ok: false });
  expect(await body(port)).toBe("old");
});

test("/api/status: HEAD is a 204 probe, other methods 405, both uncached", async () => {
  const w = wiki();
  const { port } = await start(w, { tag: "x" });
  const head = await fetch(`http://localhost:${port}/api/status`, { method: "HEAD" });
  expect(head.status).toBe(204);
  expect(head.headers.get("cache-control")).toBe("no-store");
  const post = await fetch(`http://localhost:${port}/api/status`, { method: "POST" });
  expect(post.status).toBe(405);
  expect(post.headers.get("cache-control")).toBe("no-store");
});
