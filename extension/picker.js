// Injected in the tab (after vendor/turndown.js and capture.js): the user points at one block of the page (a post, a comment,
// a newsletter section), then adds a note and sends it. Nothing on the page is modified but one shadow-root host.
(() => {
  const STRONG = 'article,[role="article"],[data-urn],[data-testid="tweet"],shreddit-post,shreddit-comment';
  const ROOMY = "li,section", ROOMY_TEXT = 80, ANY_TEXT = 40;
  const INLINE = /^(a|b|i|u|em|strong|span|small|abbr|time|code|label|img|svg|br|sub|sup|mark)$/i;
  const HINT = "↑↓ ou Alt+molette : taille · Entrée ou clic : choisir · Échap : annuler";

  const len = (n) => (n.textContent || "").replace(/\s+/g, " ").trim().length;
  const parent = (n) => n.parentElement || n.getRootNode?.()?.host || null; // crosses an (open) shadow root
  const up = (n) => { const p = parent(n); return p && p !== document.body && p !== document.documentElement ? p : null; };

  /** The block a hovered element belongs to: nearest known post/article container, else a list item or section with enough text, else a block with some text close by, else the element itself. */
  function snap(el) {
    if (!el || el === document.body || el === document.documentElement) return null;
    for (let n = el; n; n = up(n)) if (n.matches(STRONG) || (n.matches(ROOMY) && len(n) >= ROOMY_TEXT)) return n;
    for (let n = el, i = 0; n && i < 4; n = up(n), i++) if (!INLINE.test(n.localName) && len(n) >= ANY_TEXT) return n; // not too far: the arrows go further
    return el;
  }

  const css = `
    :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; font: 13px/1.4 system-ui, sans-serif; }
    .box { position: absolute; box-sizing: border-box; border: 2px solid #1a73e8; background: rgba(26,115,232,.12); display: none; }
    .tag { position: absolute; left: -2px; white-space: nowrap; background: #1a73e8; color: #fff; padding: 2px 6px; font-size: 11px; border-radius: 3px; }
    .panel { position: absolute; right: 16px; bottom: 16px; width: 340px; box-sizing: border-box; padding: 12px; background: #fff; color: #202124;
      border: 1px solid #dadce0; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.3); pointer-events: auto; }
    pre { margin: 6px 0; padding: 6px; max-height: 5.5em; overflow: hidden; white-space: pre-wrap; word-break: break-word; background: #f1f3f4; font: 11px/1.4 ui-monospace, monospace; }
    textarea { width: 100%; box-sizing: border-box; font: inherit; margin: 0 0 6px; resize: vertical; }
    button { font: inherit; padding: 4px 12px; margin-right: 6px; }
    .status { margin: 6px 0 0; min-height: 1.4em; } .err { color: #c62828; }`;

  const h = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };

  function start() {
    globalThis.__cortexPickClose?.(); // a picker still open (panel included, even from an earlier injection) is replaced
    const host = document.createElement("cortex-picker"), shadow = host.attachShadow({ mode: "closed" });
    const sheet = new CSSStyleSheet(); // not an inline <style>: the page's CSP does not apply to it
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
    const tag = h("div", { className: "tag" }), box = h("div", { className: "box" }, tag);
    shadow.append(box);
    document.documentElement.append(host);

    let current = null, hovered = null, stack = [];
    const draw = () => {
      if (!current) { box.style.display = "none"; return; }
      const r = current.getBoundingClientRect();
      Object.assign(box.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      tag.textContent = `<${current.localName}> ${HINT}`;
      tag.style.top = r.top < 26 ? "2px" : "-24px"; // above the block, inside it when there is no room
    };
    const select = (el) => { if (el) { current = el; draw(); } };
    const grow = () => { if (!current) return; const p = up(current); if (p) { stack.push(current); select(p); } };
    const shrink = () => {
      if (!current) return;
      let child = stack.pop();
      if (!child) for (let n = hovered; n && n !== current; n = parent(n)) if (parent(n) === current) { child = n; break; }
      select(child);
    };

    const stopEvent = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const close = () => {
      for (const [t, f] of Object.entries(picking)) removeEventListener(t, f, true);
      removeEventListener("scroll", draw, true); removeEventListener("resize", draw, true);
      host.remove();
      globalThis.__cortexPickClose = null;
    };
    const stopPicking = () => { for (const [t, f] of Object.entries(picking)) removeEventListener(t, f, true); };
    const choose = () => {
      if (!current) return;
      const r = globalThis.__cortex.element(current);
      if (r.error) { tag.textContent = r.error; return; }
      stopPicking();
      panel(r);
    };

    const picking = {
      mousemove(e) {
        const t = e.composedPath?.()[0] ?? e.target;
        if (t === hovered || !(t instanceof Element)) return;
        hovered = t; stack = [];
        current = snap(t);
        draw();
      },
      click(e) { stopEvent(e); choose(); },
      mousedown: stopEvent, mouseup: stopEvent, pointerdown: stopEvent, pointerup: stopEvent, dblclick: stopEvent,
      keydown(e) {
        const act = { Escape: close, Enter: choose, ArrowUp: grow, ArrowDown: shrink }[e.key];
        if (act) { stopEvent(e); act(); }
      },
      wheel(e) { if (e.altKey) { stopEvent(e); (e.deltaY < 0 ? grow : shrink)(); } },
    };
    for (const [t, f] of Object.entries(picking)) addEventListener(t, f, { capture: true, passive: false });
    addEventListener("scroll", draw, true); addEventListener("resize", draw, true);
    globalThis.__cortexPickClose = close;

    /** Note and send; the block stays outlined behind it. */
    function panel({ title, url, text, links }) {
      const note = h("textarea", { rows: 3, placeholder: "Pourquoi je garde ça (note, facultative)" });
      const status = h("p", { className: "status", role: "status" });
      const say = (t, err) => { status.textContent = t; status.className = "status" + (err ? " err" : ""); };
      const send = h("button", { textContent: "Envoyer" }), cancel = h("button", { textContent: "Annuler", onclick: close });
      send.onclick = async () => {
        send.disabled = true;
        say("Envoi…");
        try {
          const r = await chrome.runtime.sendMessage({ type: "cortex-send", title, url, text, links, note: note.value });
          if (!r || r.error) throw new Error(r?.error || "Pas de réponse de l'extension.");
          say("Envoyé ✓");
          setTimeout(close, 1500);
        } catch (e) {
          say(/context invalidated|receiving end/i.test(e.message) ? "L’extension ne répond pas (rechargée depuis l’ouverture de la page ?) : recharge la page et réessaie." : e.message, true);
          send.disabled = false;
        }
      };
      const el = h("div", { className: "panel" }, h("strong", { textContent: "Envoyer ce bloc à Cortex" }), h("pre", { textContent: text.slice(0, 240) }), note, send, cancel, status);
      el.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send.click(); });
      shadow.append(el);
      tag.style.display = "none";
      note.focus();
    }
    // typing in the note must not trigger the page's own shortcuts (X: j/k, Reddit: a/z…)
    for (const t of ["keydown", "keyup", "keypress"]) host.addEventListener(t, (e) => e.stopPropagation());
  }

  (globalThis.__cortex ??= {}).pick = { start, snap, up, parent }; // snap, up and parent are also used by the mobile bookmarklet (mobile.js)
})();
