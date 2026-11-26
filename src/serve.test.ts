import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWiki } from "./context";
import { pageState } from "./doc";
import { parseDoc } from "./lib";
import { commitAndPush, fileFor, sameOrigin, serve } from "./serve";
import { verifyPage } from "./verify";

test("verifyPage: stable + verified after generated, other lines untouched, unknown or reserved id refused", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-verify-"));
  mkdirSync(join(root, "wiki/concepts"), { recursive: true });
  writeFileSync(join(root, "cortex.json"), "{}");
  const page = `---\ntype: Concept\ntitle: "Idée"\nstatus: draft\ntags: ["a"]\ngenerated: { by: "claude/default", at: 2026-11-01T10:00:00+01:00 }\nverified: { by: "human:old", at: 2026-10-01T10:00:00+01:00 }\n---\n\nCorps.\n`;
  writeFileSync(join(root, "wiki/concepts/idee.md"), page);
  const path = await verifyPage(openWiki(root), "concepts/idee", "franck", new Date("2026-11-08T12:00:00Z"));
  const text = await Bun.file(join(root, path)).text();
  const fm = parseDoc(path, text).fm as any;
  expect(fm.status).toBe("stable");
  expect(fm.verified.by).toBe("human:franck");
  expect(pageState(fm).needsReview).toBe(false);
  expect(text).toContain('tags: ["a"]');
  expect(text.endsWith("\nCorps.\n")).toBe(true);
  expect(await Bun.file(join(root, "wiki/log.jsonl")).text()).toContain("reviewed by human:franck");
  await expect(verifyPage(openWiki(root), "concepts/nope", "franck")).rejects.toThrow("unknown page");
  await expect(verifyPage(openWiki(root), "index", "franck")).rejects.toThrow("unknown page");
  writeFileSync(join(root, "wiki/concepts/old.md"), `---\ntype: Concept\ntitle: "Old"\nstatus: deprecated\n---\n\nX.\n`);
  await verifyPage(openWiki(root), "concepts/old", "franck");
  expect(parseDoc("wiki/concepts/old.md", await Bun.file(join(root, "wiki/concepts/old.md")).text()).fm.status).toBe("deprecated");
});

test("sameOrigin: no Origin, same host (behind a proxy too) pass; other host and Origin: null refused", () => {
  expect(sameOrigin(new Headers({ host: "a:1" }))).toBe(true);
  expect(sameOrigin(new Headers({ host: "a:1", origin: "http://a:1" }))).toBe(true);
  expect(sameOrigin(new Headers({ host: "127.0.0.1:8081", "x-forwarded-host": "wiki.lan", origin: "https://wiki.lan" }))).toBe(true);
  expect(sameOrigin(new Headers({ host: "a:1", origin: "http://evil" }))).toBe(false);
  expect(sameOrigin(new Headers({ host: "a:1", origin: "null" }))).toBe(false);
});

const sh = (cwd: string, ...a: string[]) => {
  const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
};
const repos = () => {
  const d = mkdtempSync(join(tmpdir(), "cortex-push-"));
  sh(d, "init", "-q", "--bare", "-b", "main", "remote.git");
  sh(d, "clone", "-q", "remote.git", "a");
  mkdirSync(join(d, "a/wiki"));
  writeFileSync(join(d, "a/wiki/p.md"), "1\n");
  sh(join(d, "a"), "add", "-A"); sh(join(d, "a"), "commit", "-qm", "init"); sh(join(d, "a"), "push", "-q", "-u", "origin", "main");
  sh(d, "clone", "-q", "remote.git", "b");
  return d;
};
const remoteFile = (d: string, f: string) => Bun.spawnSync(["git", "-C", join(d, "remote.git"), "show", `main:${f}`]).stdout.toString();

test("commitAndPush: a rejected push is rebased then pushed; a conflict drops the change and leaves the checkout at the remote", () => {
  let d = repos();
  writeFileSync(join(d, "b/wiki/q.md"), "ci\n"); sh(join(d, "b"), "add", "-A"); sh(join(d, "b"), "commit", "-qm", "ci"); sh(join(d, "b"), "push", "-q");
  writeFileSync(join(d, "a/wiki/p.md"), "reviewed\n");
  commitAndPush(join(d, "a"), "review");
  expect(remoteFile(d, "wiki/p.md")).toBe("reviewed\n");
  expect(remoteFile(d, "wiki/q.md")).toBe("ci\n");

  d = repos();
  writeFileSync(join(d, "b/wiki/p.md"), "ci\n"); sh(join(d, "b"), "add", "-A"); sh(join(d, "b"), "commit", "-qm", "ci"); sh(join(d, "b"), "push", "-q");
  writeFileSync(join(d, "a/wiki/p.md"), "reviewed\n");
  expect(() => commitAndPush(join(d, "a"), "review")).toThrow("conflict");
  expect(remoteFile(d, "wiki/p.md")).toBe("ci\n");
  expect(Bun.file(join(d, "a/wiki/p.md")).text()).resolves.toBe("ci\n");
});

test("fileFor: x/ → index.html, never outside the folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "cortex-serve-"));
  mkdirSync(join(dir, "wiki/a"), { recursive: true });
  writeFileSync(join(dir, "index.html"), "home");
  writeFileSync(join(dir, "wiki/a/index.html"), "a");
  expect(fileFor(dir, "/")).toBe(join(dir, "index.html"));
  expect(fileFor(dir, "/wiki/a/")).toBe(join(dir, "wiki/a/index.html"));
  expect(fileFor(dir, "/../etc/passwd")).toBeUndefined();
  expect(fileFor(dir, "/%2e%2e/%2e%2e/etc/passwd")).toBeUndefined();
  expect(fileFor(dir, "/missing")).toBeUndefined();
});

test("inboxCommitMessage: English subject, one line per source in the body", async () => {
  const { inboxCommitMessage } = await import("./serve");
  expect(inboxCommitMessage([])).toBe("inbox: add sources from inbox");
  expect(inboxCommitMessage(["A (01a) ← partage-1.md", "B (01b) ← https://x/y"])).toBe("inbox: add sources from inbox\n\n- A (01a) ← partage-1.md\n- B (01b) ← https://x/y");
});

test("POST /api/ask: opt-in, same origin only, one at a time, sanitized answer with links relative to the site root", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-ask-"));
  mkdirSync(join(root, "wiki/concepts"), { recursive: true });
  writeFileSync(join(root, "cortex.json"), "{}");
  writeFileSync(join(root, "wiki/concepts/idee.md"), `---\ntype: Concept\ntitle: "Idée"\nstatus: draft\n---\n\nCorps.\n`);
  let release!: () => void;
  const seen: unknown[] = [];
  const gate = new Promise<void>((r) => (release = r));
  const server = await serve(root, { port: 0, sync: false, reviewer: "t", say: () => {}, ask: async (_, q, history) => { await gate; seen.push(history); return { md: `${q} : voir [Idée](/wiki/concepts/idee.md).[^n] [Absente](/wiki/concepts/nope.md)<script>alert(1)</script>\n\n[^n]: D'après [Idée](/wiki/concepts/idee.md).\n`, core: q === "encore" ? { retained: [{ id: "concepts/idee", path: "wiki/concepts/idee.md", title: "Idée", relevance: 0.9 }], related: [], documents: [], unread: [] } : undefined }; } });
  try {
    const at = `http://localhost:${server.port}/api/ask`, origin = `http://localhost:${server.port}`;
    const post = (body: unknown, headers: Record<string, string> = { origin }) => fetch(at, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    expect((await fetch(at, { method: "HEAD" })).status).toBe(404); // off without site_ask
    writeFileSync(join(root, "cortex.json"), JSON.stringify({ site_ask: {} }));
    expect((await fetch(at, { method: "HEAD" })).status).toBe(404); // nor without an SDK client
    writeFileSync(join(root, "cortex.json"), JSON.stringify({ client: "claude", site_ask: {} }));
    expect((await fetch(at, { method: "HEAD" })).status).toBe(204);
    expect((await post({ q: "x" }, { origin: "http://evil" })).status).toBe(403);
    expect((await post({ q: "x" }, {})).status).toBe(403); // no Origin: not the site
    expect((await post({ q: "x".repeat(501) })).status).toBe(400);
    const first = post({ q: "pourquoi" });
    await Bun.sleep(50);
    expect((await post({ q: "autre" })).status).toBe(429);
    release();
    const r = await first;
    expect(r.status).toBe(200);
    const { segments, cited, model, md, retained } = (await r.json()) as { segments: { html?: string }[]; cited: string[]; model: string; md: string; retained: string[] };
    const html = segments.map((s) => s.html ?? "").join("");
    expect(md).toStartWith("pourquoi : voir [Idée]"); // the site sends it back as history
    expect(retained).toEqual([]); // no judge: no page retained by code
    expect(html).toContain('href="wiki/concepts/idee/"'); // relative to the site root: the assistant resolves it wherever it is open
    expect(html).not.toContain("<script");
    // the footnote keeps its target and its link; only existing pages are listed as cited, once
    expect(html).toContain('href="#fn-n"');
    expect(html).toContain(`<li id="fn-n">D'après <a href="wiki/concepts/idee/">Idée</a>.</li>`);
    expect(cited).toEqual(["concepts/idee"]);
    expect(model).toBe("haiku");
    // site_ask's own client opens the route without a global one, and its model is the one shown
    writeFileSync(join(root, "cortex.json"), JSON.stringify({ site_ask: { client: "openai", model: "glm" } }));
    expect((await fetch(at, { method: "HEAD" })).status).toBe(204);
    const history = [{ role: "user", text: "pourquoi" }, { role: "assistant", text: "parce que" }, { role: "system", text: "x" }, { role: "user", text: 3 }];
    const again = (await (await post({ q: "encore", history })).json()) as { model: string; retained: string[] };
    expect(again.model).toBe("glm");
    expect(again.retained).toEqual(["concepts/idee"]);
    expect(seen.at(-1)).toEqual(history.slice(0, 2)); // malformed turns dropped
  } finally { server.stop(true); }
}, 120_000);

test("POST /api/ask with Accept: application/x-ndjson: events in order, done carries the JSON payload, the lock is freed after done, and after an abort only once the run ends", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-ask-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
  writeFileSync(join(root, "cortex.json"), JSON.stringify({ client: "claude", site_ask: {} }));
  let hold!: () => void;
  let gate = Promise.resolve();
  const server = await serve(root, { port: 0, sync: false, reviewer: "t", say: () => {}, ask: async (_, q, __, stream) => {
    stream?.text("Hel"); stream?.text("lo"); stream?.reset(); stream?.text("Hi");
    await gate;
    return { md: `${q}: Hi` };
  } });
  try {
    const at = `http://localhost:${server.port}/api/ask`, origin = `http://localhost:${server.port}`;
    const post = (q: string, accept?: string, signal?: AbortSignal) => fetch(at, { method: "POST", signal, headers: { "content-type": "application/json", origin, ...(accept && { accept }) }, body: JSON.stringify({ q }) });
    const nd = "application/x-ndjson";
    const r = await post("a", nd);
    expect(r.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(r.headers.get("x-accel-buffering")).toBe("no");
    const events = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(events.map((e) => e.t)).toEqual(["delta", "delta", "reset", "delta", "done"]);
    expect(events[0].text + events[1].text).toBe("Hello");
    const json = (await (await post("a")).json()) as Record<string, unknown>; // no Accept: the JSON path, same payload
    expect(events[4]).toEqual({ t: "done", ...json });
    // an aborted client does not free the lock: the run goes on (and is paid) until it ends
    gate = new Promise<void>((res) => (hold = res));
    const ctl = new AbortController();
    const pending = await post("b", nd, ctl.signal);
    await pending.body!.getReader().read(); // the first delta: the run is on
    ctl.abort();
    await Bun.sleep(100);
    expect((await post("c")).status).toBe(429);
    hold();
    await Bun.sleep(100);
    gate = Promise.resolve();
    expect((await post("d")).status).toBe(200);
  } finally { server.stop(true); }
}, 30_000);

test("POST /api/ask/render: the saved answers drawn again, same origin only, off without site_ask", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-render-"));
  mkdirSync(join(root, "wiki/concepts"), { recursive: true });
  writeFileSync(join(root, "cortex.json"), JSON.stringify({ client: "claude", site_ask: {} }));
  writeFileSync(join(root, "wiki/concepts/idee.md"), `---\ntype: Concept\ntitle: "Idée"\nstatus: draft\n---\n\nCorps.\n`);
  const server = await serve(root, { port: 0, sync: false, reviewer: "t", say: () => {} });
  try {
    const origin = `http://localhost:${server.port}`, at = `${origin}/api/ask/render`;
    const post = (body: unknown, headers: Record<string, string> = { origin }) => fetch(at, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    expect((await post({ answers: ["x"] }, { origin: "http://evil" })).status).toBe(403);
    expect((await post({ answers: ["x"] }, {})).status).toBe(403);
    expect((await post({ answers: "x" })).status).toBe(400);
    expect((await post({ answers: [3] })).status).toBe(400);
    const r = await post({ answers: ["Voir [Idée](/wiki/concepts/idee.md)<script>alert(1)</script>", "Rien."] });
    expect(r.status).toBe(200);
    const { answers } = (await r.json()) as { answers: { segments: { html?: string }[]; cited: string[] }[] };
    expect(answers).toHaveLength(2);
    expect(answers[0].segments.map((s) => s.html ?? "").join("")).toContain('href="wiki/concepts/idee/"');
    expect(answers[0].segments.map((s) => s.html ?? "").join("")).not.toContain("<script");
    expect(answers[0].cited).toEqual(["concepts/idee"]);
    expect(answers[1].cited).toEqual([]);
    writeFileSync(join(root, "cortex.json"), "{}");
    expect((await post({ answers: ["x"] })).status).toBe(404);
  } finally { server.stop(true); }
}, 120_000);

test("site_ask: its own client, model and effort; $CORTEX_ASK_API_KEY only to $CORTEX_ASK_BASE_URL", async () => {
  const { askSetup, askModel, askClient } = await import("./serve");
  const env = { u: process.env.CORTEX_ASK_BASE_URL, k: process.env.CORTEX_ASK_API_KEY };
  try {
    delete process.env.CORTEX_ASK_BASE_URL; process.env.CORTEX_ASK_API_KEY = "sk-ask";
    // no site_ask client: the global one, its cheapest model, no effort (the global effort is for compiling)
    expect(askSetup({ client: "claude", model: "opus", effort: "high", site_ask: {} })).toEqual({ cfg: { client: "claude", model: "haiku", effort: undefined, site_ask: {} }, ep: undefined });
    // another client: its own model, never the global one; none set = undefined (lint warns)
    expect(askModel({ client: "claude", model: "haiku", site_ask: { client: "openai" } })).toBeUndefined();
    const own = { client: "claude" as const, site_ask: { client: "openai" as const, model: "z-ai/glm-5.3-flash", effort: "low" } };
    expect(askClient(own)).toBe("openai");
    expect(askSetup(own).cfg).toMatchObject({ client: "openai", model: "z-ai/glm-5.3-flash", effort: "low" });
    // a base_url only cortex.json names gets no key
    expect(askSetup({ ...own, site_ask: { ...own.site_ask, base_url: "https://evil.example/v1" } }).ep).toEqual({ url: "https://evil.example/v1", key: undefined });
    // the environment names the server: the key goes there, from the environment alone or from a base_url equal to it
    process.env.CORTEX_ASK_BASE_URL = "https://openrouter.ai/api/v1/";
    expect(askSetup(own).ep).toEqual({ url: "https://openrouter.ai/api/v1", key: "sk-ask" });
    expect(askSetup({ ...own, site_ask: { ...own.site_ask, base_url: "https://openrouter.ai/api/v1/" } }).ep?.key).toBe("sk-ask");
  } finally {
    for (const [k, v] of [["CORTEX_ASK_BASE_URL", env.u], ["CORTEX_ASK_API_KEY", env.k]] as const) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});
