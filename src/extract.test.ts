import { afterAll, beforeAll, expect, test } from "bun:test";
import { add, addFmLink, extractPdf, extractUrl, VIA } from "./add";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { socialFor } from "./social";
import { X } from "./social/x";
import { Bluesky } from "./social/bluesky";
import { LinkedIn } from "./social/linkedin";

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
        case "/api/v1/statuses/9": return Response.json({ content: `<p>Lire <a href="${u.origin}/plain">ceci</a>, <a href="${u.origin}/short">cela</a> <a href="https://m.social/@al" class="mention">@al</a> <a href="https://m.social/tags/ia">#ia</a></p>`,
          account: { acct: "bob" }, mentions: [{ url: "https://m.social/@al" }], tags: [{ url: "https://m.social/tags/ia" }], card: { url: `${u.origin}/plain` } });
        case "/api/v1/statuses/11": case "/api/v1/statuses/12":
        case "/api/v1/statuses/10": return Response.json({ content: `<p>Post ${u.pathname.split("/").at(-1)} : <a href="${u.origin}/paid">payant</a> <a href="${u.origin}/plain">ceci</a></p>`, account: { acct: "eve" } });
        case "/paid": return new Response("Subscribe", { status: 402 });
        case "/mirror/http://localhost:" + u.port + "/paid": return html(page("", `<article><h1>Paid, mirrored</h1>${para(8)}</article>`));
        case "/api/v1/statuses/8": return new Response("nope", { status: 404 });
        case "/@blog/8": return html(page("", `<article><h1>Not fedi</h1>${para(8)}</article>`));
        case "/slow": return new Promise((r) => setTimeout(() => r(html("late")), 2000));
        case "/broken-ld": return html(page('<script type="application/ld+json">{"@type": "NewsArticle", "headline": "cut</script>', `<article><h1>Broken LD</h1>${para(8)}</article>`));
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

test("social: LinkedIn reads the JSON-LD of the post page", async () => {
  expect(socialFor("https://fr.linkedin.com/posts/bob_x-activity-1-abc")?.request).toBe("https://fr.linkedin.com/posts/bob_x-activity-1-abc");
  expect(socialFor("https://www.linkedin.com/pulse/an-article")).toBeUndefined(); // an article: the page extractors
  const ld = { "@type": "SocialMediaPosting", articleBody: "Le post.", datePublished: "2026-11-04T11:29:06Z", author: { name: "Bob" } };
  const ex = await new LinkedIn(canned(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`), canned(new Uint8Array())).read("https://www.linkedin.com/posts/x", "unused");
  expect(ex).toMatchObject({ content: "Le post.", author: "Bob", published: "2026-11-04T11:29:06Z", extractor: "linkedin-jsonld", url: "https://www.linkedin.com/posts/x" });
  await expect(new LinkedIn(canned("<html>authwall</html>"), canned(new Uint8Array())).read("u", "unused")).rejects.toThrow(/no post data/);
  expect(socialFor("https://lnkd.in/p/e7f6wR4d")?.request).toBe("https://lnkd.in/p/e7f6wR4d");
  const video = { "@type": "VideoObject", description: "J'ai connecté Claude à ma télé.", creator: { name: "Tsiory" }, datePublished: "2026-11-05T16:34:53.778Z", thumbnailUrl: "https://t/1.jpg", comment: [{ "@type": "Comment", text: "bravo" }] };
  const v = await new LinkedIn(canned(`<script type="application/ld+json">${JSON.stringify(video)}</script>`), canned(new Uint8Array())).read("u", "unused");
  expect(v).toMatchObject({ content: "J'ai connecté Claude à ma télé.\n\n![](https://t/1.jpg)", author: "Tsiory", published: "2026-11-05T16:34:53.778Z" });
});


test("social: LinkedIn activity page and link card, with selectors overridable from cortex.json", async () => {
  const none = canned(new Uint8Array());
  const activity = `<article><a data-tracking-control-name="public_post_feed-actor-name" href="https://fr.linkedin.com/company/bearstech?trk=x">Bearstech</a>
    <p data-test-id="main-feed-activity-card__commentary">SSHole : une faille. <a href="https://sshhole.com/?trk=public_post-text">https://sshhole.com/</a></p>
    <div class="comment"><p>un commentaire</p></div></article>`;
  expect(await new LinkedIn(canned(activity), none).read("u", "unused")).toMatchObject({ author: "Bearstech", content: "SSHole : une faille. [https://sshhole.com/](https://sshhole.com/)" });
  const withCard = `<script type="application/ld+json">${JSON.stringify({ "@type": "SocialMediaPosting", articleBody: "Mon post.", comment: [{ "@type": "Comment", text: "un commentaire" }], text: "Comment j'ai conçu un agent" })}</script>
    <a data-tracking-control-name="public_post_feed-article-content" href="https://example.org/agent?trk=public_post_feed-article-content">Comment j'ai conçu un agent · example.org</a>`;
  expect((await new LinkedIn(canned(withCard), none).read("u", "unused")).content).toBe("Mon post.\n\n[Comment j'ai conçu un agent](https://example.org/agent)");
  // LinkedIn renamed things: cortex.json points at the new names, no code change
  const renamed = `<a class="new-actor">Bob</a><div class="new-text">Nouveau DOM.</div>`;
  await expect(new LinkedIn(canned(renamed), none).read("u", "unused")).rejects.toThrow(/cortex\.json/);
  expect(await new LinkedIn(canned(renamed), none, { activity_text: ".new-text", activity_author: ".new-actor" }).read("u", "unused")).toMatchObject({ author: "Bob", content: "Nouveau DOM." });
});

test("social: LinkedIn carousel: pages downloaded next to the source, the largest resolution", async () => {
  const cfg = JSON.stringify({ doc: { title: "Symfony 8.2", manifestUrl: "M" } }).replace(/"/g, "&quot;");
  const ld = { "@type": "SocialMediaPosting", articleBody: "Part 7." };
  const answers: Record<string, string> = {
    page: `<script type="application/ld+json">${JSON.stringify(ld)}</script><div data-native-document-config="${cfg}"></div>`,
    M: JSON.stringify({ perResolutions: [{ width: 300, imageManifestUrl: "small" }, { width: 1500, imageManifestUrl: "big" }] }),
    big: JSON.stringify({ pages: ["p1", "p2"] }),
  };
  const got: string[] = [];
  const ex = await new LinkedIn({ get: async (r: string) => answers[r] }, { get: async (r: string) => { got.push(r); return new Uint8Array([1]); } }).read("u", "page");
  expect(got).toEqual(["p1", "p2"]);
  expect(ex.files?.map((f) => f.name)).toEqual(["page-01.jpg", "page-02.jpg"]);
  expect(ex.content).toBe("Part 7.\n\n## Symfony 8.2\n\n![Page 1](page-01.jpg)\n\n![Page 2](page-02.jpg)");
});

test("social: each network gives its post's links from structured data", async () => {
  const x = await new X(canned({ tweet: { text: "lire https://t.co/a", raw_text: { facets: [{ type: "url", original: "https://t.co/a", replacement: "https://example.org/a" }, { type: "media", replacement: "https://x.com/v/1" }] } } })).read("u", "r");
  expect(x.links).toEqual(["https://example.org/a"]);
  const b = await new Bluesky(canned({ thread: { post: { record: { text: "lire example.org/b…", facets: [{ features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://example.org/b" }, { $type: "app.bsky.richtext.facet#tag", tag: "ia" }] }] },
    embed: { external: { uri: "https://example.org/card" } }, author: { handle: "a" } } } })).read("u", "r");
  expect(b.links).toEqual(["https://example.org/b", "https://example.org/card"]);
  const ld = { "@type": "SocialMediaPosting", articleBody: "Voir https://lnkd.in/x. et https://fr.linkedin.com/in/bob/ #ia", image: { url: "https://media.licdn.com/i.jpg" } };
  const li = await new LinkedIn(canned(`<script type="application/ld+json">${JSON.stringify(ld)}</script><a data-tracking-control-name="public_post_feed-article-content" href="https://example.org/c?trk=x">C</a>`), canned(new Uint8Array())).read("u", "r");
  expect(li.links).toEqual(["https://lnkd.in/x", "https://example.org/c"]);
  // lnkd.in out of LinkedIn: unfolded from its interstitial, in the links and in the text; only lnkd.in/p/ is a post
  const pages: Record<string, string> = { post: `<script type="application/ld+json">${JSON.stringify({ "@type": "SocialMediaPosting", articleBody: "Le code : https://lnkd.in/dX" })}</script>`,
    "https://lnkd.in/dX": `<a data-tracking-control-name="external_url_click" href="https://github.com/a/b">https://github.com/a/b</a>` };
  const un = await new LinkedIn({ get: async (r: string) => pages[r] }, canned(new Uint8Array())).read("u", "post");
  expect(un).toMatchObject({ content: "Le code : https://github.com/a/b", links: ["https://github.com/a/b"] });
  expect(socialFor("https://lnkd.in/dX")).toBeUndefined();
});

test("add: a post's linked pages become sources of their own, one level, a failing one doesn't fail the post", async () => {
  const b = `http://localhost:${srv.port}`;
  const saved = VIA.freedium;
  VIA.freedium = [`${b}/mirror/`]; // never the real mirrors from a test
  try {
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  const r = await add(root, `${b}/@bob/9`, { note: "why" });
  expect(r.ex?.links).toEqual([`${b}/plain`, `${b}/short`]); // mention and hashtag left out, card deduplicated
  expect(r.linked?.map((l) => ("error" in l ? "error" : l.ex?.extractor))).toEqual([expect.stringMatching(/defuddle|readability/), "error"]); // /short: almost empty
  const raw = (await Array.fromAsync(new Bun.Glob("raw/**/source.md").scan(root))).length;
  expect(raw).toBe(2);
  // tied both ways in the frontmatter
  const plain = r.linked![0] as { id: string };
  expect(await Bun.file(join(root, (await Array.fromAsync(new Bun.Glob(`raw/**/${r.id}/source.md`).scan(root)))[0])).text()).toContain(`linked: [${plain.id}]`);
  // a second post linking the same page: no new source, the page gets both posts; a paywalled link goes through Freedium
  {
    const r2 = await add(root, `${b}/@eve/10`, { note: "why" });
    expect(r2.linked?.map((l) => ("error" in l ? l.error : l.ex?.extractor ?? "duplicate"))).toEqual([expect.stringMatching(/^localhost:\d+\/mirror|^localhost/), "duplicate"]);
    const fm = await Bun.file(join(root, (await Array.fromAsync(new Bun.Glob(`raw/**/${plain.id}/source.md`).scan(root)))[0])).text();
    expect(fm).toContain(`linked_from: [${r.id}, ${r2.id}]`);
  }
  const again = await add(root, `${b}/@bob/9`, { note: "why" });
  expect(again.duplicate).toBe(true);
  expect(again.linked).toBeUndefined();
  // parser.social.external_link.limit: the network's own limit wins over the global one; 0 follows nothing
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ parser: { social: { external_link: { limit: 0 }, mastodon: { external_link: { limit: 1 } } } } }));
  expect((await add(root, `${b}/@eve/11`, { note: "why" })).linked).toHaveLength(1);
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ parser: { social: { external_link: { limit: 0 } } } }));
  expect((await add(root, `${b}/@eve/12`, { note: "why" })).linked).toBeUndefined();
  } finally { VIA.freedium = saved; }
});

test("addFmLink: adds to a frontmatter list by line edit, once; creates the line; keeps CRLF and the body", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  const id = "01a1b07b-93d8-71a1-b8c7-b180b547c4f2", f = join(root, "raw", "2026", "11", id, "source.md");
  await Bun.write(f, "---\r\ntype: RawSource\r\nstatus: pending\r\n---\r\nlinked: [not, frontmatter]\r\n");
  await addFmLink(root, id, "linked", "a");
  await addFmLink(root, id, "linked", "b");
  await addFmLink(root, id, "linked", "a");
  expect(await Bun.file(f).text()).toBe("---\r\ntype: RawSource\r\nstatus: pending\r\nlinked: [a, b]\r\n---\r\nlinked: [not, frontmatter]\r\n");
});

test("defuddle's own error lines (broken JSON-LD) are muted; the page is still read", async () => {
  const seen: unknown[][] = [], error = console.error;
  console.error = (...a: unknown[]) => { seen.push(a); };
  try {
    const ex = await extractUrl(`http://localhost:${srv.port}/broken-ld`);
    expect(ex.content).toContain("Phrase numéro 7");
    console.error("other");
  } finally { console.error = error; }
  expect(seen).toEqual([["other"]]);
});
