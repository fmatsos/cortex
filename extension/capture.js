// Injected in the tab (after vendor/Readability.js and vendor/turndown.js): reads what the browser displays.
(() => {
  const toMarkdown = (html) => {
    const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    td.remove(["script", "style", "noscript", "template"]);
    return td.turndown(html).replace(/\n{3,}/g, "\n\n").trim();
  };
  // absolute links and images; inline (data:) images are dropped, they would weigh the source down
  const absolute = (root) => {
    for (const [sel, attr] of [["a[href]", "href"], ["img[src]", "src"]]) for (const e of root.querySelectorAll(sel)) {
      try { e.setAttribute(attr, new URL(e.getAttribute(attr), document.baseURI).href); } catch {}
    }
    for (const e of root.querySelectorAll('img[src^="data:"]')) e.remove();
  };
  const ok = (text) => ({ title: document.title.trim(), url: location.href, text });

  globalThis.__cortex = {
    // Readability on a clone (it mutates its input); a page that is not an article (a feed, an app) falls back to its whole body
    page() {
      const article = new Readability(document.cloneNode(true)).parse();
      let html = article?.content, title = article?.title;
      if (!html || (article.textContent || "").trim().length < 250) {
        const body = document.body.cloneNode(true);
        absolute(body);
        html = body.innerHTML; title = "";
      }
      const holder = document.createElement("div");
      holder.innerHTML = html;
      absolute(holder);
      const text = toMarkdown(holder.innerHTML);
      return text ? { ...ok(text), title: (title || document.title).trim() } : { error: "Rien à envoyer : la page n'a pas de texte lisible." };
    },
    selection() {
      const sel = getSelection(), holder = document.createElement("div");
      for (let i = 0; i < (sel?.rangeCount ?? 0); i++) holder.append(sel.getRangeAt(i).cloneContents());
      absolute(holder);
      const text = toMarkdown(holder.innerHTML);
      return text ? ok(text) : { error: "Aucune sélection de texte." };
    },
  };
})();
