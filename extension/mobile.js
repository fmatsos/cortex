// Entry of the Android bookmarklet (bundled and minified by scripts/bookmarklet.ts, nothing is loaded at run time: the page's CSP and
// mixed-content rules would refuse it). Same capture as the extension (capture.js, lib.js permalinks, picker.js snap), with a touch UI:
// tap a block, Agrandir / Réduire, Envoyer. The block is handed to the share app (prefilled form: the note is added there).
import TurndownService from "turndown";
import { permalink } from "./lib.js";
import "./capture.js";
import "./picker.js";

globalThis.TurndownService = TurndownService; // capture.js reads it when it converts, not when it loads
const { snap, up, parent } = globalThis.__cortex.pick;
const SERVER = globalThis.__cortexServer, MAX = 60000; // MAX: the block travels in the URL of the share app's page

const css = `:host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;font:16px/1.3 system-ui,sans-serif}
.box{position:absolute;box-sizing:border-box;border:3px solid #1a73e8;background:rgba(26,115,232,.15);display:none}
.bar{position:absolute;left:0;right:0;bottom:0;box-sizing:border-box;padding:8px 8px calc(8px + env(safe-area-inset-bottom));background:#fff;color:#202124;
border-top:1px solid #dadce0;box-shadow:0 -2px 12px rgba(0,0,0,.3);pointer-events:auto}
.msg{margin:0 0 8px;min-height:1.3em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.err{color:#c62828}
.row{display:flex;gap:6px}button{flex:1;min-height:48px;min-width:44px;font:inherit;border:1px solid #dadce0;border-radius:8px;background:#f1f3f4;color:inherit}
button:disabled{opacity:.4}.go{background:#1a73e8;color:#fff;border-color:#1a73e8}`;

globalThis.__cortexMobileClose?.(); // a picker still open is replaced
const host = document.createElement("cortex-mobile"), shadow = host.attachShadow({ mode: "closed" });
const sheet = new CSSStyleSheet(); // not an inline <style>: the page's CSP does not apply to it
sheet.replaceSync(css);
shadow.adoptedStyleSheets = [sheet];
const h = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };
const msg = h("p", { className: "msg", role: "status" }), box = h("div", { className: "box" });
const say = (t, err) => { msg.textContent = t; msg.className = "msg" + (err ? " err" : ""); };
const btn = (textContent, onclick, className = "") => h("button", { textContent, onclick, className, type: "button" });
const [bigger, smaller, go] = [btn("Agrandir", () => grow()), btn("Réduire", () => shrink()), btn("Envoyer", () => send(), "go")];
shadow.append(box, h("div", { className: "bar" }, msg, h("div", { className: "row" }, bigger, smaller, go, btn("Annuler", () => close()))));
document.documentElement.append(host);

let current = null, tapped = null, stack = [];
const draw = () => {
  if (!current) return;
  const r = current.getBoundingClientRect();
  Object.assign(box.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
};
const select = (el) => {
  if (!el) return;
  current = el; draw();
  say(`<${el.localName}> · ${(el.textContent || "").trim().length} caractères`);
  [bigger, smaller, go].forEach((b) => (b.disabled = false));
};
const grow = () => { const p = up(current); if (p) { stack.push(current); select(p); } };
const shrink = () => {
  let child = stack.pop();
  if (!child) for (let n = tapped; n && n !== current; n = parent(n)) if (parent(n) === current) { child = n; break; }
  select(child);
};

function send() {
  const r = globalThis.__cortex.element(current);
  if (r.error) return say(r.error, true);
  const text = r.text.length > MAX ? `${r.text.slice(0, MAX)}\n\n[… texte tronqué : le bloc dépassait ${MAX} caractères]` : r.text;
  // in the fragment, not the query: it never reaches the server, so no request-line limit (8 ko on many proxies) applies
  const to = `${SERVER}/share/#${new URLSearchParams({ url: permalink(r.links, location.href), title: r.title, text })}`;
  if (!open(to, "_blank")) location.href = to; // popup blocked
  close();
}

// taps select instead of following links or reaching the page's own handlers; the toolbar keeps its events
const inBar = (e) => e.composedPath().includes(host);
const block = (e) => { if (!inBar(e)) { e.stopImmediatePropagation(); if (e.cancelable && e.type === "click") e.preventDefault(); } };
const handlers = {
  click(e) {
    if (inBar(e)) return;
    block(e);
    const t = e.composedPath()[0];
    if (!(t instanceof Element)) return;
    tapped = t; stack = [];
    select(snap(t));
  },
};
for (const t of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "dblclick", "contextmenu"]) handlers[t] = block;
for (const [t, f] of Object.entries(handlers)) addEventListener(t, f, { capture: true, passive: false });
addEventListener("scroll", draw, true); addEventListener("resize", draw, true);
function close() {
  for (const [t, f] of Object.entries(handlers)) removeEventListener(t, f, true);
  removeEventListener("scroll", draw, true); removeEventListener("resize", draw, true);
  host.remove();
  globalThis.__cortexMobileClose = null;
}
globalThis.__cortexMobileClose = close;
[bigger, smaller, go].forEach((b) => (b.disabled = true));
say("Touche un bloc de la page");
