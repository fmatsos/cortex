/**
 * Assainisseur du HTML exporté (`{@html}` côté site). Le Markdown du wiki est écrit par un LLM à partir de pages web
 * brutes : le HTML auteur que Bun laisse passer est une surface XSS.
 *
 * Principe : liste blanche d'éléments et d'attributs, et ré-émission. Le texte est recopié tel quel, chaque balise
 * reconnue est reconstruite (attributs entre guillemets, valeurs échappées), tout `<` qui n'ouvre pas une balise bien
 * formée devient `&lt;`. Rien du HTML d'entrée n'atteint la sortie sans être passé par ces règles.
 */

const VOID = new Set(["br", "hr", "img", "input", "wbr"]);
const TAGS = new Set([
  "a", "abbr", "b", "blockquote", "br", "caption", "cite", "code", "dd", "del", "details", "dfn", "div", "dl", "dt", "em",
  "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "input", "ins", "kbd", "li", "mark", "ol",
  "p", "pre", "q", "s", "small", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead",
  "time", "tr", "u", "ul", "wbr",
]);
/** Éléments dont le contenu n'est jamais du texte à afficher : supprimés avec leur contenu. */
const DROP = new Set(["script", "style", "iframe", "object", "embed", "noscript", "template", "textarea", "title", "xmp", "noembed", "noframes", "svg", "math", "select", "button", "form"]);
/** Classes que le site stylise ; toute autre classe est retirée (pas d'habillage arbitraire de l'interface). */
const CLASSES = new Set(["fn-ref", "note-perso", "note-perso-titre", "callout-warning", "callout-warning-titre", "lien-manquant", "task-list-item", "task-list-item-checkbox"]);

const NAMED: Record<string, string> = { colon: ":", tab: "\t", newline: "\n", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", sol: "/", lpar: "(", rpar: ")", num: "#", excl: "!", period: ".", comma: ",", semi: ";", equals: "=", quest: "?", percnt: "%", plus: "+" };
const decode = (s: string) => s.replace(/&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|([a-zA-Z]+));?/g, (all, hex?: string, dec?: string, name?: string) => {
  const cp = hex ? parseInt(hex, 16) : dec ? parseInt(dec, 10) : undefined;
  if (cp !== undefined) return cp > 0x10ffff ? "�" : String.fromCodePoint(cp);
  return NAMED[name!.toLowerCase()] ?? all;
});
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Valeur d'attribut textuelle : entités valides conservées, le reste échappé. */
const escText = (s: string) => s.replace(/&(?!#?\w+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const SAFE_DATA_IMAGE = /^data:image\/(?:png|gif|jpe?g|webp|avif);base64,[a-z0-9+/=]*$/i;

/** URL sûre (valeur décodée, prête à échapper) ou `undefined`. Liste blanche de protocoles, pas de liste noire. */
export function safeUrl(raw: string, image = false): string | undefined {
  const value = decode(raw).trim();
  // les navigateurs ignorent tabulations, retours et contrôles dans le protocole : on les retire pour juger
  const probe = value.replace(/[\p{Cc}\p{Cf}\p{Z}]/gu, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(probe);
  if (scheme) {
    if (SAFE_SCHEMES.has(scheme[1].toLowerCase())) return value;
    return image && SAFE_DATA_IMAGE.test(probe) ? probe : undefined;
  }
  const head = probe.split(/[/?#]/)[0];
  if (head.includes(":") || head.includes("&")) return undefined; // protocole déguisé (entité inconnue, caractère exotique)
  return value;
}

const cls = (v: string, tag: string) => {
  const ok = v.split(/\s+/).filter((c) => CLASSES.has(c) || (tag === "code" && /^language-[\w+#.-]+$/.test(c)));
  return ok.length ? ok.join(" ") : undefined;
};
const digits = (v: string) => (/^\d{1,4}$/.test(v.trim()) ? v.trim() : undefined);

/** Règle d'un attribut : renvoie la valeur à écrire (déjà échappée), `""` pour un attribut booléen, ou `undefined` pour le retirer. */
function attribute(tag: string, name: string, v: string): string | undefined {
  if (name === "class") { const c = cls(decode(v), tag); return c && esc(c); }
  switch (tag + " " + name) {
    case "a href": { const u = safeUrl(v); return u === undefined ? undefined : esc(u); }
    case "img src": { const u = safeUrl(v, true); return u === undefined ? undefined : esc(u); }
    case "img alt": case "img title": case "a title": case "abbr title": case "span title": case "a aria-label": return escText(v);
    case "img width": case "img height": case "td colspan": case "td rowspan": case "th colspan": case "th rowspan": case "ol start": { const d = digits(v); return d; }
    case "td align": case "th align": return /^(left|right|center)$/i.test(v.trim()) ? v.trim().toLowerCase() : undefined;
    case "input type": return v.trim().toLowerCase() === "checkbox" ? "checkbox" : undefined;
    case "input disabled": case "input checked": case "details open": return "";
    case "a id": return /^(?:fnref|fn|src)-[\w-]+$/.test(v) ? v : undefined;
  }
  if (/^h[1-6]$/.test(tag) && name === "id") return /^[\p{L}\p{N}_-]+$/u.test(v) ? v : undefined;
  return undefined;
}

// une balise bien formée : nom, attributs `nom`, `nom=valeur`, `nom="valeur"`, `nom='valeur'`, `/` final facultatif
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function openTag(tag: string, attrs: string, selfClose: boolean): string {
  const seen = new Set<string>();
  let out = `<${tag}`;
  for (const m of attrs.matchAll(ATTR)) {
    const name = m[1].toLowerCase();
    if (seen.has(name)) continue; // le premier gagne, comme dans un navigateur
    seen.add(name);
    const v = attribute(tag, name, m[2] ?? m[3] ?? m[4] ?? "");
    if (v === undefined) continue;
    out += v === "" && ["disabled", "checked", "open"].includes(name) ? ` ${name}` : ` ${name}="${v}"`;
  }
  return out + (VOID.has(tag) && selfClose ? " />" : ">");
}

export function sanitizeHtml(html: string): string {
  let out = "";
  const open: string[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) { out += html.slice(i); break; }
    out += html.slice(i, lt);
    i = lt;
    if (html.startsWith("<!--", i)) { // commentaire : supprimé (« <!-->  » et « <!--> » sont des commentaires vides pour un navigateur)
      const end = html.indexOf("-->", i + 4);
      if (end >= 0) { i = end + 3; continue; }
      out += "&lt;"; i += 1; continue;
    }
    TAG.lastIndex = i;
    const m = TAG.exec(html);
    if (!m) { out += "&lt;"; i += 1; continue; }
    i = TAG.lastIndex;
    const [, slash, rawName, attrs, selfClose] = m, tag = rawName.toLowerCase();
    if (DROP.has(tag)) {
      if (!slash) {
        const close = new RegExp(`</${tag}\\s*>`, "ig");
        close.lastIndex = i;
        const c = close.exec(html);
        if (c) i = close.lastIndex; // contenu supprimé avec l'élément ; sans fermeture, on continue après la balise
      }
      continue;
    }
    if (!TAGS.has(tag)) continue; // élément inconnu : balise retirée, texte conservé
    if (slash) {
      const at = open.lastIndexOf(tag);
      if (at < 0) continue; // fermeture orpheline
      while (open.length > at) out += `</${open.pop()}>`;
    } else {
      out += openTag(tag, attrs, !!selfClose);
      if (!VOID.has(tag)) open.push(tag);
    }
  }
  while (open.length) out += `</${open.pop()}>`;
  return out;
}
