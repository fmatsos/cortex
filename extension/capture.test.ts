import { expect, test } from "bun:test";
import { parseHTML } from "linkedom";
// @ts-ignore: plain JS module (no declaration file), also loaded by the service worker
import { permalink } from "./lib.js";

/** Runs the scripts the extension injects (vendor + capture.js) against a linkedom page, as a classic script would see it. */
async function load(html: string, url: string, select?: (document: Document, sel: any) => void) {
  const { window, document } = parseHTML(html);
  const g = globalThis as any;
  const sel = { rangeCount: 0, getRangeAt: (_: number) => null as any };
  Object.assign(g, { window, document, location: new URL(url), getSelection: () => sel, DOMParser: window.DOMParser, Node: window.Node });
  Object.defineProperty(document, "baseURI", { value: url });
  select?.(document, sel);
  delete g.__cortex;
  // the two libraries from node_modules, as extension/build.ts copies them into vendor/ (git-ignored, absent in CI)
  for (const f of ["../node_modules/@mozilla/readability/Readability.js", "../node_modules/turndown/lib/turndown.browser.umd.js", "capture.js", "picker.js"]) (0, eval)(await Bun.file(new URL(`./${f}`, import.meta.url)).text()); // indirect eval: global scope, like a classic script
  return g.__cortex;
}

const article = `<html><head><title>Titre | Site</title></head><body><nav>menu</nav><article><h1>Titre</h1>${"<p>Un paragraphe de remplissage assez long pour que Readability retienne l'article, avec un <a href=\"/lien\">lien relatif</a> dedans.</p>".repeat(6)}<img src="data:image/png;base64,AAAA"></article></body></html>`;

test("extension: page() gives the article as Markdown with absolute links, without inline images", async () => {
  const c = await load(article, "https://exemple.org/a/b");
  const r = c.page();
  expect(r.url).toBe("https://exemple.org/a/b");
  expect(r.title).toContain("Titre");
  expect(r.text).toContain("[lien relatif](https://exemple.org/lien)");
  expect(r.text).not.toContain("data:image");
  expect(r.text).not.toContain("menu");
});

test("extension: selection() converts the selected HTML, links absolute; nothing selected is an error", async () => {
  const none = await load(article, "https://exemple.org/a/b");
  expect(none.selection().error).toBeTruthy();
  const c = await load(article, "https://exemple.org/a/b", (document, sel) => {
    const frag = document.createDocumentFragment(), div = document.createElement("div");
    div.innerHTML = '<p>Un <strong>extrait</strong> avec <a href="../x">un lien</a>.</p>';
    frag.append(...div.childNodes);
    sel.rangeCount = 1; sel.getRangeAt = () => ({ cloneContents: () => frag });
  });
  expect(c.selection().text).toBe("Un **extrait** avec [un lien](https://exemple.org/x).");
});

const links = (...hrefs: (string | [string, boolean])[]) => hrefs.map((h) => (typeof h === "string" ? { href: h, time: false } : { href: h[0], time: h[1] }));
const PAGE = "https://exemple.org/page";

test("extension: permalink() takes the block's own post URL, per network, else the page's", () => {
  const li = "https://www.linkedin.com/feed/update/urn:li:activity:7123456789/?utm=x";
  expect(permalink(links("https://www.linkedin.com/in/bob", li), "https://www.linkedin.com/feed/")).toBe("https://www.linkedin.com/feed/update/urn:li:activity:7123456789");
  expect(permalink(links("https://x.com/bob", ["https://x.com/bob/status/99/photo/1", true]), "https://x.com/home")).toBe("https://x.com/bob/status/99");
  expect(permalink(links("https://bsky.app/profile/bob.bsky.social/post/3kabc"), "https://bsky.app/")).toBe("https://bsky.app/profile/bob.bsky.social/post/3kabc");
  expect(permalink(links(["https://piaille.fr/@bob/111222333", true]), "https://piaille.fr/home")).toBe("https://piaille.fr/@bob/111222333");
  expect(permalink(links("https://www.reddit.com/r/bun/comments/abc/titre/def/"), "https://www.reddit.com/r/bun/comments/abc/titre/")).toBe("https://www.reddit.com/r/bun/comments/abc/titre/def");
  expect(permalink(links("https://www.linkedin.com/in/bob", "https://exemple.org/autre"), PAGE)).toBe(PAGE);
  expect(permalink([], PAGE)).toBe(PAGE);
});

test("extension: permalink() ignores a status link without a date, a link to another site, a generic /@user/123", () => {
  expect(permalink(links("https://x.com/bob/status/99"), "https://x.com/home")).toBe("https://x.com/home");
  expect(permalink(links(["https://x.com/bob/status/99", true]), "https://blog.exemple.org/a")).toBe("https://blog.exemple.org/a");
  expect(permalink(links("https://medium.com/@bob/123"), "https://medium.com/feed")).toBe("https://medium.com/feed");
});

test("extension: element() gives a LinkedIn-like block as Markdown (no controls, no inline images, absolute links) and its post URL", async () => {
  const c = await load(
    `<body><div data-urn="urn:li:activity:7123"><a href="/in/bob">Bob</a><p>Un post avec <a href="/redir?x=1">un lien</a>.</p><img src="data:image/png;base64,AAAA"><img src="/i.png"><button>J'aime</button><svg><path/></svg></div></body>`,
    "https://www.linkedin.com/feed/");
  const r = c.element(document.querySelector("[data-urn]"));
  expect(r.text).toContain("[Bob](https://www.linkedin.com/in/bob)");
  expect(r.text).toContain("[un lien](https://www.linkedin.com/redir?x=1)");
  expect(r.text).toContain("![](https://www.linkedin.com/i.png)");
  expect(r.text).not.toMatch(/data:image|J'aime/);
  expect(permalink(r.links, r.url)).toBe("https://www.linkedin.com/feed/update/urn:li:activity:7123");
});

test("extension: element() finds a tweet's permalink through its <time> link; a bare <li> is not a bullet; an empty block is an error", async () => {
  const c = await load(
    `<body><article data-testid="tweet"><a href="/bob"><span>Bob</span></a><a href="/bob/status/99"><time>2h</time></a><div>Bonjour</div></article><ul><li id="l">Un élément</li><li id="e"><button>x</button></li></ul></body>`,
    "https://x.com/home");
  const r = c.element(document.querySelector("article"));
  expect(permalink(r.links, r.url)).toBe("https://x.com/bob/status/99");
  expect(c.element(document.getElementById("l")).text).toBe("Un élément");
  expect(c.element(document.getElementById("e")).error).toBeTruthy();
});

test("extension: pick.snap() goes up to the post container, a roomy li/section, else a block with some text", async () => {
  const long = "Un texte assez long pour compter comme un vrai bloc de contenu dans la page, au moins quatre-vingts caractères.";
  const c = await load(
    `<body><main><article id="a"><div><span id="s">court</span></div></article>
      <ul><li id="small"><a id="la">menu</a></li><li id="big"><div><span id="lb">${long}</span></div></li></ul>
      <section id="sec"><p id="p">${long}</p></section>
      <div id="blk"><p id="q">Un paragraphe de plus de quarante caractères ici.</p></div><div><div><div><div id="none"><i id="tiny">x</i></div></div></div></div></main></body>`,
    "https://exemple.org/");
  const id = (x: string) => document.getElementById(x)!, snap = (x: string) => c.pick.snap(id(x))?.id;
  expect(snap("s")).toBe("a");
  expect(snap("la")).not.toBe("small");
  expect(snap("lb")).toBe("big");
  expect(snap("p")).toBe("sec");
  expect(snap("q")).toBe("q");
  expect(snap("tiny")).toBe("tiny");
  expect(c.pick.snap(document.body)).toBeNull();
});

test("extension: element() drops avatars, profile photos and the links they leave empty", async () => {
  const c = await load(`<body><article id="p">
    <a href="/in/jane"><img src="/a.jpg" alt="Voir le profil de Jane"></a>
    <a href="/in/bob"><img src="/b.jpg" class="EntityPhoto-circle-3" alt=""></a>
    <img src="/r.png" width="24" height="24" alt="">
    <span class="visually-hidden">Jane</span>
    <p>Le texte du post, avec <a href="https://ex.com/a">un lien</a>.</p>
    <img src="/chart.png" alt="Graphique">
  </article></body>`, "https://www.linkedin.com/feed/");
  const r = c.element(document.getElementById("p"));
  expect(r.text).not.toMatch(/profil|a\.jpg|b\.jpg|r\.png|Jane/);
  expect(r.text).toContain("[un lien](https://ex.com/a)");
  expect(r.text).toContain("chart.png");
});

test("extension: element() takes its title from the block, its author from the post, and unwraps LinkedIn's safety/go links", async () => {
  const c = await load(`<body><div data-urn="urn:li:activity:1"><a href="/in/jane"><span aria-hidden="true">Jane Doe</span><span class="visually-hidden">Jane Doe</span></a>
    <div id="t"><p><strong>Spotify a réduit</strong> sa facture, dit <a href="/in/bob"><strong><strong>Bob</strong></strong></a>.</p><p>Suite <a href="https://www.linkedin.com/safety/go/?url=https%3A%2F%2Flnkd%2Ein%2Fabc&urlhash=x&mt=long">lien</a></p></div></div></body>`,
    "https://www.linkedin.com/feed/");
  const r = c.element(document.getElementById("t"));
  expect(r.title).toBe("Spotify a réduit sa facture, dit Bob.");
  expect(r.text).toContain("[**Bob**](https://www.linkedin.com/in/bob)");
  expect(r.text).toStartWith("Auteur : Jane Doe\n\n");
  expect(r.text).toContain("[lien](https://lnkd.in/abc)");
});

test("extension: element() finds the author in LinkedIn's 2026 feed markup (role=listitem, no data-urn, name with its degree)", async () => {
  const c = await load(`<body><div role="listitem"><a href="/in/erwan"></a><a href="/in/erwan"><span aria-hidden="true"><svg></svg></span><span>Erwan Bernard</span>  • 2e</a>
    <p id="t">Revolut a divisé sa facture, dit <a href="/in/abitbold">David Abitbol</a>.</p></div></body>`, "https://www.linkedin.com/feed/");
  expect(c.element(document.getElementById("t")).text).toStartWith("Auteur : Erwan Bernard\n\n");
});
