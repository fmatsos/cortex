import { expect, test } from "bun:test";
import { parseHTML } from "linkedom";

/** Runs the scripts the extension injects (vendor + capture.js) against a linkedom page, as a classic script would see it. */
async function load(html: string, url: string, select?: (document: Document, sel: any) => void) {
  const { window, document } = parseHTML(html);
  const g = globalThis as any;
  const sel = { rangeCount: 0, getRangeAt: (_: number) => null as any };
  Object.assign(g, { window, document, location: new URL(url), getSelection: () => sel, DOMParser: window.DOMParser, Node: window.Node });
  Object.defineProperty(document, "baseURI", { value: url });
  select?.(document, sel);
  delete g.__cortex;
  for (const f of ["vendor/Readability.js", "vendor/turndown.js", "capture.js"]) (0, eval)(await Bun.file(new URL(`./${f}`, import.meta.url)).text()); // indirect eval: global scope, like a classic script
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
