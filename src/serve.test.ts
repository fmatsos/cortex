import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWiki } from "./context";
import { pageState } from "./doc";
import { parseDoc } from "./lib";
import { commitAndPush, fileFor, sameOrigin } from "./serve";
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
