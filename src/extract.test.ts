import { afterAll, beforeAll, expect, test } from "bun:test";
import { extractPdf, extractUrl } from "./add";
import { socialFor } from "./social";
import { X } from "./social/x";
import { Bluesky } from "./social/bluesky";

/** A transport that answers with a canned payload: the network side is tested without the network (the bridge's point). */
const canned = (data: unknown) => ({ get: async () => data });

/**
 * `extractUrl` and `extractPdf` against a local Bun.serve (no real network): extractor choice, paywall marker,
 * PDF routing, refusals, canonical URL, author filter.
 */

const para = (n: number) =>
  Array.from({ length: n }, (_, i) => `<p>Phrase numéro ${i} avec suffisamment de words pour compter dans le total attendu ici.</p>`).join("");
const page = (head: string, body: string) => `<html><head><title>Page de test</title>${head}</head><body>${body}</body></html>`;

/** Smallest PDF pdftotext reads: one page of Helvetica text lines. */
function pdf(text: string): Uint8Array<ArrayBuffer> {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  // five words per line: a longer line would run off the page and be clipped
  const lines = text.split(" ").reduce<string[]>((acc, w, i) => (i % 5 ? (acc[acc.length - 1] += ` ${w}`, acc) : [...acc, w]), []);
  const stream = `BT /F1 12 Tf 14 TL 20 750 Td ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
const words = (n: number) => Array.from({ length: n }, (_, i) => `mot${i}`).join(" ");

const html = (body: string) => new Response(body, { headers: { "content-type": "text/html" } });
let srv: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  srv = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      switch (u.pathname) {
        case "/down/https://medium.com/a": return new Response("bad gateway", { status: 502 });
        case "/broken/https://medium.com/a": return html(page("", `<article><p>Could not load this article</p>${para(8)}</article>`));
        case "/up/https://medium.com/a": return html(page('<meta name="author" content="Bob 8 min read">', `<article><h1>Mirrored</h1>${para(8)}</article>`));
        case "/api/v1/statuses/7": return Response.json({ content: "<p>Hello <b>fedi</b></p>", created_at: "2026-01-02T03:04:05.000Z", account: { display_name: "Bob", acct: "bob" }, media_attachments: [{ url: "https://m/1.png" }] });
        case "/api/v1/statuses/8": return new Response("nope", { status: 404 });
        case "/@blog/8": return html(page("", `<article><h1>Not fedi</h1>${para(8)}</article>`));
        case "/slow": return new Promise((r) => setTimeout(() => r(html("late")), 2000));
        case "/plain": return html(page("", `<article><h1>Plain</h1>${para(8)}</article>`));
        // a 60-word <main> next to the real story: defuddle keeps the <main>, Readability scores the story higher
        case "/trap": return html(page("", `<main><p>${"mot ".repeat(60)}.</p></main><div id="story">${para(14)}</div>`));
        case "/paywall": return html(page("", `<article><h1>P</h1>${para(8)}<p>This post is for paid subscribers</p></article>`));
        case "/paywall-fr": return html(page("", `<article><h1>P</h1>${para(8)}<p>Il reste 69 % de l'article</p></article>`));
        case "/pdf": return new Response(pdf(words(30)), { headers: { "content-type": "application/pdf" } });
        case "/pdf-broken": return new Response("pas un pdf", { headers: { "content-type": "application/pdf" } });
        case "/short": return html(page("", "<article><p>Trop court.</p></article>"));
        case "/old": return new Response(null, { status: 302, headers: { location: "/dir/new" } });
        case "/dir/new": return html(page('<link rel="canonical" href="sibling">', `<article>${para(8)}</article>`));
        case "/canon-abs": return html(page('<link rel="canonical" href="https://exemple.org/vrai">', `<article>${para(8)}</article>`));
        case "/author-num": return html(page('<meta name="author" content="12345">', `<article>${para(8)}</article>`));
        case "/author": return html(page('<meta name="author" content="Jane Doe">', `<article>${para(8)}</article>`));
        default: return new Response("non", { status: 403 });
      }
    },
  });
});
afterAll(() => srv.stop(true));
const get = (p: string) => extractUrl(`${srv.url}${p.replace(/^\//, "")}`);

test("extractUrl: defuddle by default, Readability when it extracts clearly more words", async () => {
  const plain = await get("/plain");
  expect(plain.extractor).toStartWith("defuddle/");
  expect(plain.kind).toBe("article");
  const trap = await get("/trap");
  expect(trap.extractor).toStartWith("readability/");
  expect(trap.content.split(/\s+/).length).toBeGreaterThan(plain.content.split(/\s+/).length); // the longer extraction was kept
});

test("extractUrl: a paywall marker sets partial, a plain page does not", async () => {
  expect((await get("/paywall")).partial).toBe("paywall: partial content");
  expect((await get("/paywall-fr")).partial).toBe("paywall: partial content");
  expect((await get("/plain")).partial).toBeUndefined();
});

test("extractUrl: refuses an almost empty body and an HTTP error status", async () => {
  await expect(get("/short")).rejects.toThrow("Almost empty body");
  await expect(get("/forbidden")).rejects.toThrow("HTTP 403");
});

test("extractUrl: the canonical URL is resolved against the final URL, after redirects", async () => {
  expect((await get("/old")).url).toBe(`${srv.url}dir/sibling`); // not against /old
  expect((await get("/canon-abs")).url).toBe("https://exemple.org/vrai");
  expect((await get("/plain")).url).toBe(`${srv.url}plain`); // no canonical: the final URL
});

test("extractUrl: a numeric author (gist user id) is dropped, a real one is kept", async () => {
  expect((await get("/author-num")).author).toBeUndefined();
  expect((await get("/author")).author).toBe("Jane Doe");
});

test("extractUrl: a pdf content-type goes through extractPdf", async () => {
  // not a real pdf: pdftotext (or its absence) fails, and the error proves the routing
  await expect(get("/pdf-broken")).rejects.toThrow(/pdftotext/);
  if (!Bun.which("pdftotext")) return;
  const r = await get("/pdf");
  expect(r).toMatchObject({ kind: "pdf", extractor: "pdftotext", blobExt: "pdf" });
  expect(r.content).toContain("mot29");
});

test.skipIf(!Bun.which("pdftotext"))("extractPdf: a PDF under 20 words is refused as scanned, a longer one is extracted", async () => {
  await expect(extractPdf(pdf(words(5)))).rejects.toThrow("PDF without text");
  const r = await extractPdf(pdf(words(25)), "https://exemple.org/a.pdf", "doc");
  expect(r.title).toStartWith("mot0 mot1");
  expect(r.url).toBe("https://exemple.org/a.pdf");
});

test("extractPdf: without pdftotext in the PATH, a clear French message", () => {
  // a child process with an empty PATH: the binary cannot be found, whatever this machine has installed
  const script = `import { extractPdf } from ${JSON.stringify(`${import.meta.dir}/add`)};
    try { await extractPdf(new Uint8Array([37, 80, 68, 70])); console.log("pas d'erreur"); } catch (e) { console.log((e as Error).message); }`;
  const p = Bun.spawnSync([process.execPath, "-e", script], { env: { PATH: "/nonexistent", HOME: process.env.HOME ?? "/" } });
  expect(p.stdout.toString()).toContain("pdftotext not found");
  expect(p.stdout.toString()).toContain("poppler-utils");
});

test("mirrors: failing ones are skipped, the source keeps the original URL", async () => {
  const b = `http://localhost:${srv.port}`;
  const ex = await extractUrl("https://medium.com/a", { mirrors: [`${b}/down/`, `${b}/broken/`, `${b}/up/`] });
  expect(ex.url).toBe("https://medium.com/a");
  expect(ex.author).toBe("Bob");
  expect(ex.extractor).toStartWith(`localhost:${srv.port}+`);
  await expect(extractUrl("https://medium.com/a", { mirrors: [`${b}/down/`] })).rejects.toThrow(/No mirror served/);
});

test("social: X and Bluesky build their request and read the answer through any transport", async () => {
  expect(socialFor("https://x.com/jack/status/20")?.request).toBe("https://api.fxtwitter.com/status/20");
  const ex = await new X(canned({ tweet: { text: "just setting up", created_at: "Tue Mar 21 20:50:14 +0000 2006", author: { name: "jack", screen_name: "jack" },
    media: { all: [{ url: "https://p/1.jpg" }] }, quote: { text: "q", author: { name: "Q" } } } })).read("https://x.com/jack/status/20", "unused");
  expect(ex).toMatchObject({ url: "https://x.com/jack/status/20", author: "jack (@jack)", published: "2006-03-21T20:50:14.000Z", extractor: "fxtwitter-api" });
  expect(ex.content).toBe("just setting up\n\n> Q: q\n\n![](https://p/1.jpg)");
  expect(socialFor("https://bsky.app/profile/a.bsky.social/post/3abc")?.request).toContain(encodeURIComponent("at://a.bsky.social/app.bsky.feed.post/3abc"));
  const b = await new Bluesky(canned({ thread: { post: { record: { text: "hi", createdAt: "2026-01-01T00:00:00Z" }, author: { handle: "a.bsky.social" } } } })).read("u", "unused");
  expect(b.author).toBe("a.bsky.social");
  expect(socialFor("https://x.com/jack")).toBeUndefined();
});

test("social: Mastodon via its API, a non-Mastodon /@user/id page falls back to the page", async () => {
  const b = `http://localhost:${srv.port}`;
  const ex = await extractUrl(`${b}/@bob/7`);
  expect(ex).toMatchObject({ url: `${b}/@bob/7`, author: "Bob (@bob)", extractor: "mastodon-api" });
  expect(ex.content).toBe("Hello **fedi**\n\n![](https://m/1.png)");
  expect((await extractUrl(`${b}/@blog/8`)).content).toContain("Not fedi");
});

test("fetch timeout is honoured", async () => {
  const b = `http://localhost:${srv.port}`;
  await expect(extractUrl(`${b}/slow`, { timeoutMs: 50 })).rejects.toThrow();
});
