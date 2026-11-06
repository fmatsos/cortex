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
  // links of a block, in document order, for lib.js `permalink`: its anchors ({href, time}) and the post ids the page carries as attributes
  // (LinkedIn data-urn, Reddit permalink); `time` is true when the anchor wraps a <time>
  const LI_URN = /^urn:li:(?:activity|share|ugcPost):\d+$/;
  const linksOf = (root) => {
    const out = [];
    for (const n of root.querySelectorAll("a[href],[data-urn],[permalink]")) {
      const urn = n.getAttribute("data-urn"), perm = n.getAttribute("permalink");
      if (urn && LI_URN.test(urn)) out.push({ href: `https://www.linkedin.com/feed/update/${urn}/`, time: false });
      if (perm) try { out.push({ href: new URL(perm, document.baseURI).href, time: false }); } catch {}
      if (n.matches("a[href]")) out.push({ href: n.getAttribute("href"), time: !!n.querySelector("time") });
    }
    return out.slice(0, 200);
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
    // one block picked by the user (picker.js): Markdown without the controls, plus its links to find its permalink
    element(el) {
      const holder = document.createElement("div");
      holder.append(el.cloneNode(true));
      absolute(holder);
      const links = linksOf(holder);
      for (const e of holder.querySelectorAll("svg,button,input,select,textarea,[hidden]")) e.remove();
      if (el.localName === "li") holder.innerHTML = holder.firstElementChild?.innerHTML ?? ""; // a bare <li> would come out as a bullet
      const text = toMarkdown(holder.innerHTML);
      return text ? { ...ok(text), links } : { error: "Ce bloc n'a pas de texte." };
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
