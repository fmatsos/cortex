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

test("share: an explicit as goes in a .md.as; a note keeps its Markdown links as typed, a bad as is a 400", async () => {
  const body = "Voir [la doc](https://a.b/c) puis https://d.e/f.\n\n- [ ] à faire";
  // a note: no link taken out of the text, no Source line, no .url even when the text is a link alone
  expect(toInbox({ title: "Idée", text: body, note: "pour plus tard", as: "note" })).toEqual([
    ["md", `# Idée\n\n${body}\n`], ["md.as", "note\n"], ["md.note", "pour plus tard\n"],
  ]);
  expect(toInbox({ title: "Lien", text: "https://a.b/c", as: "note" })).toEqual([["md", "# Lien\n\nhttps://a.b/c\n"], ["md.as", "note\n"]]);
  expect(toInbox({ text: " ", as: "note" })).toBeNull();
  // a resource keeps what it did (the link is taken out), and says so
  expect(toInbox({ title: "Idée", text: "rappel", as: "resource" })).toEqual([["md", "# Idée\n\nrappel\n"], ["md.as", "resource\n"]]);
  expect(toInbox({ title: "Idée", text: "rappel" })).toEqual([["md", "# Idée\n\nrappel\n"]]); // no as: as before
  const { route } = await import("./share-server");
  const sent: string[][] = [];
  const post = (b: object) => route(new Request("http://x/share/api", { method: "POST", body: JSON.stringify(b) }), async (files) => { sent.push(files.map((f) => f.path.split(".").slice(1).join("."))); });
  for (const as of ["page", "", 1, null, ["note"]]) expect((await post({ text: "x", as })).status).toBe(400);
  expect(sent).toEqual([]);
  expect((await post({ text: "x", as: "note" })).status).toBe(200);
  expect(sent).toEqual([["md", "md.as"]]);
});

test("share: multipart uploads are named by the server (never by the client), checked as a whole, and carry the note and the as", async () => {
  const { route, UPLOAD_TYPES, MAX_UPLOAD_BYTES } = await import("./share-server");
  const got: { path: string; content: string | Uint8Array }[][] = [];
  const send = (form: FormData) => route(new Request("http://x/share/api", { method: "POST", body: form }), async (f) => { got.push(f); });
  const pdf = new Uint8Array([...new TextEncoder().encode("%PDF-1.7\n"), 1, 2, 3]);
  const form = new FormData();
  form.set("note", "à lire\nplus tard"); form.set("as", "resource");
  form.append("file", new File([pdf], "../../etc/Rapport.PDF"));
  form.append("file", new File(["# Mon titre\n\nCorps"], "idee.markdown"));
  form.append("file", new File(["du texte brut"], "mes notes.txt"));
  const ok = await send(form);
  expect(ok.status).toBe(200);
  const paths = got[0]!.map((f) => f.path);
  expect(paths.every((p) => /^inbox\/partage-[\w-]+\.(pdf|md|txt)(\.note|\.as)?$/.test(p))).toBe(true); // no part of the client's names
  expect(paths.filter((p) => !/\.(note|as)$/.test(p)).map((p) => p.replace(/^.*\./, ""))).toEqual(["pdf", "md", "txt"]); // .markdown is saved as .md
  const by = (ext: string) => got[0]!.find((f) => f.path.endsWith(`.${ext}`))!;
  expect(by("pdf").content).toEqual(pdf); // binary as is
  expect(by("md").content).toBe("# Mon titre\n\nCorps"); // a heading of its own is kept
  expect(by("txt").content).toBe("# mes notes\n\ndu texte brut"); // none: the file's name
  expect(got[0]!.filter((f) => f.path.endsWith(".note")).map((f) => f.content)).toEqual(["à lire plus tard\n", "à lire plus tard\n", "à lire plus tard\n"]);
  expect(got[0]!.filter((f) => f.path.endsWith(".as")).map((f) => f.content)).toEqual(["resource\n", "resource\n", "resource\n"]);
  // refused before anything is delivered: another type (415, with the accepted ones), not a PDF, too big (413), a bad as
  got.length = 0;
  const bad = async (name: string, body: BlobPart, extra: Record<string, string> = {}) => { const f = new FormData(); for (const [k, v] of Object.entries(extra)) f.set(k, v); f.append("file", new File(["# ok\n\nx"], "ok.md")); f.append("file", new File([body], name)); return send(f); };
  const exe = await bad("run.exe", "MZ");
  expect([exe.status, await exe.text()]).toEqual([415, expect.stringContaining(Object.keys(UPLOAD_TYPES).join(", "))]);
  expect((await bad("fake.pdf", "not a pdf")).status).toBe(415);
  expect((await bad("noext", "x")).status).toBe(415);
  expect((await bad("fake.png", "not an image")).status).toBe(415); // its bytes decide, not its name
  expect((await bad("fake.docx", "not a zip")).status).toBe(415);
  expect((await bad("fake.rtf", "plain text")).status).toBe(415);
  expect((await bad("trunc.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).status).toBe(415); // a truncated signature is no image
  expect((await bad("big.txt", new Uint8Array(MAX_UPLOAD_BYTES + 1))).status).toBe(413);
  expect((await bad("a.txt", "x", { as: "page" })).status).toBe(400);
  expect(got).toEqual([]);
  // text fields alone (no file) still make an entry, and a JSON share is unchanged
  const text = new FormData(); text.set("text", "Un texte tapé"); text.set("title", "Idée");
  expect((await send(text)).status).toBe(200);
  expect(got[0]!.map((f) => f.path.replace(/^.*\./, ""))).toEqual(["md"]);
  expect((await send(new FormData())).status).toBe(400); // nothing at all
});

test("share: an image upload is accepted as is (by its bytes), whatever its extension among the image ones", async () => {
  const { route } = await import("./share-server");
  const got: { path: string; content: string | Uint8Array }[][] = [];
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const form = new FormData();
  form.set("as", "resource");
  form.append("file", new File([png], "Photo.PNG"));
  form.append("file", new File([jpg], "scan.jpeg"));
  const r = await route(new Request("http://x/share/api", { method: "POST", body: form }), async (f) => { got.push(f); });
  expect(r.status).toBe(200);
  expect(got[0]!.filter((f) => !/\.(as|note)$/.test(f.path)).map((f) => f.path.replace(/^.*\./, ""))).toEqual(["png", "jpg"]);
  expect(got[0]![0]!.content).toEqual(png);
});

test("share: documents are kept as is when their first bytes fit (ZIP for docx, odt and epub, {\\rtf, HTML unchecked), .htm saved as .html", async () => {
  const { route } = await import("./share-server");
  const got: { path: string; content: string | Uint8Array }[][] = [];
  const zip = new Uint8Array([0x50, 0x4b, 3, 4, 1]), rtf = new TextEncoder().encode("{\\rtf1 hello}"), html = new TextEncoder().encode("<p># not a heading</p>");
  const form = new FormData();
  for (const [bytes, name] of [[zip, "a.DOCX"], [zip, "b.odt"], [zip, "c.epub"], [rtf, "d.rtf"], [html, "e.htm"], [html, "f.html"]] as const) form.append("file", new File([bytes], name));
  expect((await route(new Request("http://x/share/api", { method: "POST", body: form }), async (f) => { got.push(f); })).status).toBe(200);
  expect(got[0]!.map((f) => f.path.replace(/^.*\./, ""))).toEqual(["docx", "odt", "epub", "rtf", "html", "html"]);
  expect(got[0]![4]!.content).toEqual(html); // no title prepended: it is not a text
});

test("share: a note with files makes its files attachments (<file>.of names the note, no as or note on them); without a text each file carries them", async () => {
  const { route } = await import("./share-server");
  const got: { path: string; content: string | Uint8Array }[][] = [];
  const send = (form: FormData) => route(new Request("http://x/share/api", { method: "POST", body: form }), async (f) => { got.push(f); });
  const form = new FormData();
  form.set("as", "note"); form.set("title", "Réunion"); form.set("text", "Compte rendu"); form.set("note", "à garder");
  form.append("file", new File([new TextEncoder().encode("%PDF-1.4")], "devis.pdf"));
  form.append("file", new File(["du texte"], "liste.txt"));
  expect((await send(form)).status).toBe(200);
  const base = got[0]![0]!.path.split("/").at(-1)!;
  expect(base).toMatch(/^partage-[\w-]+\.md$/);
  expect(got[0]!.map((f) => f.path.replace(/^inbox\/partage-[\w-]+?(-\d)?\./, "$1 "))).toEqual([" md", " md.as", " md.note", "-1 pdf", "-1 pdf.of", "-2 txt", "-2 txt.of"]);
  expect(got[0]!.filter((f) => f.path.endsWith(".of")).map((f) => f.content)).toEqual([`${base}\n`, `${base}\n`]);
  expect(got[0]!.find((f) => f.path.endsWith(".md.as"))!.content).toBe("note\n");
  // as note and files but no text: each file is a note, as before
  got.length = 0;
  const bare = new FormData();
  bare.set("as", "note"); bare.set("note", "x"); bare.append("file", new File(["du texte"], "liste.txt"));
  expect((await send(bare)).status).toBe(200);
  expect(got[0]!.map((f) => f.path.replace(/^.*\.(?=txt)/, ""))).toEqual(["txt", "txt.note", "txt.as"]);
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
    expect(sh(d, "--git-dir=remote.git", "log", "--format=%s", "main")).toBe(`inbox: add share ${paths[0].slice("inbox/partage-".length, -".url".length)}\nci\ninit\n`);
    expect(sh(d, "--git-dir=remote.git", "log", "-1", "--format=%b", "main").trim()).toBe(`- ${paths[0]}`);
  } finally { server.stop(true); }
});

test("share: route hands the inbox files to the given deliver (cortex serve writes them to its local inbox/)", async () => {
  const { route } = await import("./share-server");
  const got: { path: string; content: string | Uint8Array }[][] = [];
  const r = await route(new Request("http://x/share/api", { method: "POST", body: JSON.stringify({ url: "https://a.b/c" }) }), async (f) => { got.push(f); });
  expect(r.status).toBe(200);
  expect(got[0]![0]!.path).toMatch(/^inbox\/partage-.+\.url$/);
  expect(got[0]![0]!.content).toBe("https://a.b/c\n");
  const failed = await route(new Request("http://x/share/api", { method: "POST", body: JSON.stringify({ url: "https://a.b/c" }) }), async () => { throw new Error("disk full"); });
  expect(failed.status).toBe(502);
});

test("share: mounted under a base (a space of cortex serve), the page, the manifest and the API URL stay under it; at the root nothing changes", async () => {
  const { route } = await import("./share-server");
  const at = (base: string, path: string) => route(new Request(`http://x${base}${path}`), async () => {}, base);
  for (const base of ["", "/s/pro"]) {
    const m = await (await at(base, "/share/manifest.webmanifest")).json() as { start_url: string; scope: string; icons: { src: string }[]; share_target: { action: string } };
    expect([m.start_url, m.scope, m.share_target.action]).toEqual([`${base}/share/`, `${base}/share/`, `${base}/share/`]);
    expect(m.icons.map((i) => i.src)).toEqual([`${base}/share/icon-192.png`, `${base}/share/icon-512.png`]);
    const html = await (await at(base, "/share/")).text();
    expect(html).toContain(`fetch("${base}/share/api"`);
    expect(html).toContain(`href="${base}/share/manifest.webmanifest"`);
    expect((await at(base, "/share")).status).toBe(200);
    expect((await at(base, "/share/icon-192.png")).status).toBe(200);
    const got: unknown[] = [];
    const r = await route(new Request(`http://x${base}/share/api`, { method: "POST", body: JSON.stringify({ text: "a note" }) }), async (f) => { got.push(f); }, base);
    expect(r.status).toBe(200);
    expect(got.length).toBe(1);
  }
  const book = await (await route(new Request("http://x/s/pro/share/bookmarklet", { headers: { host: "cortex.example", "x-forwarded-proto": "https" } }), async () => {}, "/s/pro")).text();
  expect(book).toContain("https://cortex.example/s/pro"); // the bookmarklet posts to this space
});
