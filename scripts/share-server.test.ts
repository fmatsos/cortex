import { expect, test } from "bun:test";
import { toInbox } from "./share-server";

test("share: a link alone is a .url (note on its line), text keeps its link inside a .md with a .md.note, nothing is null", () => {
  expect(toInbox({ url: "https://a.b/c", title: "Page" })).toEqual([["url", "https://a.b/c\n"]]);
  expect(toInbox({ text: " https://a.b/c ", note: "à lire\nplus tard" })).toEqual([["url", "https://a.b/c à lire plus tard\n"]]);
  expect(toInbox({ text: "Un post sur les LLM locaux\nsuite https://lnkd.in/x", note: "veille" })).toEqual([
    ["md", "# Un post sur les LLM locaux\n\nUn post sur les LLM locaux\nsuite\n\nSource : <https://lnkd.in/x>\n"],
    ["md.note", "veille\n"],
  ]);
  expect(toInbox({ title: "Idée", text: "rappel : tester GLM" })).toEqual([["md", "# Idée\n\nrappel : tester GLM\n"]]);
  expect(toInbox({ text: "  ", note: "x" })).toBeNull();
});

test("share: a text with an explicit url (page captured by the extension) keeps it in a .md.origin, and its own quotes of the url", () => {
  expect(toInbox({ title: "Article", url: "https://a.b/c", text: "Corps. Voir https://a.b/c plus haut.\n\nFin.", note: "veille" })).toEqual([
    ["md", "# Article\n\nCorps. Voir https://a.b/c plus haut.\n\nFin.\n\nSource : <https://a.b/c>\n"],
    ["md.origin", "https://a.b/c\n"],
    ["md.note", "veille\n"],
  ]);
  // the url repeated at the end of the text (an Android share) is not part of the content, and a url alone stays a .url
  expect(toInbox({ url: "https://a.b/c", text: "Mon post\nhttps://a.b/c" })).toEqual([
    ["md", "# Mon post\n\nMon post\n\nSource : <https://a.b/c>\n"], ["md.origin", "https://a.b/c\n"],
  ]);
  expect(toInbox({ url: "https://a.b/c", text: "https://a.b/c" })).toEqual([["url", "https://a.b/c\n"]]);
});

test("share: the extension origin gets CORS headers (preflight and POST), another origin none", async () => {
  const { route } = await import("./share-server");
  const ext = "chrome-extension://" + "a".repeat(32);
  const pre = await route(new Request("http://x/share/api", { method: "OPTIONS", headers: { origin: ext, "access-control-request-method": "POST" } }));
  expect(pre.status).toBe(204);
  expect(pre.headers.get("access-control-allow-origin")).toBe(ext);
  expect(pre.headers.get("access-control-allow-headers")).toBe("content-type");
  const post = await route(new Request("http://x/share/api", { method: "POST", headers: { origin: ext }, body: "{}" })); // nothing to send: 400, no Gitea call
  expect(post.status).toBe(400);
  expect(post.headers.get("access-control-allow-origin")).toBe(ext);
  const other = await route(new Request("http://x/share/api", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
  expect(other.headers.get("access-control-allow-origin")).toBeNull();
});

test("bookmarklet: a javascript: URL with all its code inline, the server baked in, no load of anything else", async () => {
  const { bookmarklet } = await import("./bookmarklet");
  const b = await bookmarklet("http://cortex.lan:8090");
  expect(b.startsWith("javascript:")).toBe(true);
  const code = decodeURIComponent(b.slice("javascript:".length));
  expect(code).toContain('globalThis.__cortexServer="http://cortex.lan:8090"');
  expect(code).toContain("/share/#"); // the PWA is reached through the fragment
  expect(code).toContain("TurndownService"); // Turndown is inside, not loaded
  expect(code).not.toMatch(/fetch\(|XMLHttpRequest|importScripts|import\(|createElement\("script"\)|\.src\s*=/);
  // the only absolute URLs are the server and the LinkedIn permalink it builds
  const urls = [...code.matchAll(/https?:\/\/[^"'`\s)\\$]+/g)].map((m) => m[0]);
  expect(urls.filter((u) => !/^https:\/\/www\.linkedin\.com\/feed\/update\/$/.test(u) && u !== "http://cortex.lan:8090")).toEqual([]);
  expect(b).not.toMatch(/[\s#]/); // whitespace and # encoded, the rest as is (shorter)
  expect(b.length).toBeLessThan(code.length * 1.25); // encodeURIComponent made it ~1.5×
  expect(b.slice(11)).not.toMatch(/[<>"`{}|\\^]/); // Chrome Android cut the URL at the first <
});

test("share: GET /share/bookmarklet is the install page with the code for the request's own origin", async () => {
  const { route } = await import("./share-server");
  const r = await route(new Request("http://127.0.0.1:8090/share/bookmarklet", { headers: { host: "cortex.example", "x-forwarded-proto": "https" } }));
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toContain("text/html");
  const html = await r.text();
  const code = html.match(/<textarea[^>]*>(javascript:[^<]+)<\/textarea>/)![1];
  expect(decodeURIComponent(code).replace(/&quot;/g, '"')).toContain('globalThis.__cortexServer="https://cortex.example"');
  expect(html).toContain("Copier le bookmarklet");
  expect((await (await route(new Request("http://x/share/"))).text())).toContain("/share/bookmarklet");
});

test("share: a share is committed to inbox/ and pushed to the checkout's remote, on top of a commit made meanwhile", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const sh = (cwd: string, ...a: string[]) => {
    const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
    return r.stdout.toString();
  };
  const d = mkdtempSync(join(tmpdir(), "cortex-share-"));
  sh(d, "init", "-q", "--bare", "-b", "main", "remote.git");
  sh(d, "clone", "-q", "remote.git", "a");
  writeFileSync(join(d, "a/README"), "x\n");
  sh(join(d, "a"), "add", "-A"); sh(join(d, "a"), "commit", "-qm", "init"); sh(join(d, "a"), "push", "-q", "-u", "origin", "main");
  sh(d, "clone", "-q", "remote.git", "share");
  writeFileSync(join(d, "a/other"), "y\n"); sh(join(d, "a"), "add", "-A"); sh(join(d, "a"), "commit", "-qm", "ci"); sh(join(d, "a"), "push", "-q");
  const { route, start } = await import("./share-server");
  expect(() => start(d)).toThrow("not a git checkout");
  const server = start(join(d, "share"));
  try {
    const r = await route(new Request("http://x/share/api", { method: "POST", body: JSON.stringify({ url: "https://a.b/c", note: "why" }) }));
    expect(r.status).toBe(200);
    const { paths } = await r.json();
    expect(sh(d, "--git-dir=remote.git", "show", `main:${paths[0]}`)).toBe("https://a.b/c why\n");
    expect(sh(d, "--git-dir=remote.git", "log", "--format=%s", "main")).toBe(`inbox: partage ${paths[0].slice("inbox/partage-".length, -".url".length)}\nci\ninit\n`);
  } finally { server.stop(true); }
});
