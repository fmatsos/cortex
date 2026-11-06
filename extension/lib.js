// Shared by the popup and the service worker (ES module, no build step).
const KEY = "server";

export const getServer = async () => ((await chrome.storage.sync.get(KEY))[KEY] || "").replace(/\/+$/, "");

/** "http://cortex.lan:8080/share/" → "http://cortex.lan:8080"; null when it is not an http(s) URL. */
export function normalize(input) {
  try {
    const u = new URL(input.trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    return (u.origin + u.pathname.replace(/\/share(\/api)?\/?$/, "").replace(/\/+$/, ""));
  } catch { return null; }
}

/** The host permission is asked for the server's host (the port is not part of a match pattern). */
export const hostPattern = (server) => `${new URL(server).protocol}//${new URL(server).hostname}/*`;

/** Runs `fn` (an injection); a page the browser forbids reading gets a French message. */
async function guard(fn) {
  try { return await fn(); }
  catch (e) { throw new Error(/Cannot access|extensions gallery|chrome:\/\//i.test(e.message) ? "Cette page ne peut pas être lue (page du navigateur ou boutique)." : e.message); }
}

/** Reads the tab: "page" (Readability → Markdown) or "selection" → {title, url, text}. Throws a French message. */
export const capture = (tabId, mode) => guard(async () => {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["vendor/Readability.js", "vendor/turndown.js", "capture.js"] });
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: (m) => globalThis.__cortex[m](), args: [mode] });
  if (result?.error) throw new Error(result.error);
  return result;
});

/** Starts the block picker in the tab; the page then shows its own panel and sends through the service worker ("cortex-send"). */
export const pick = (tabId) => guard(async () => {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["vendor/turndown.js", "capture.js", "picker.js"] });
  await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.__cortex.pick.start() });
});

/**
 * Permalinks of a post, tried against the links found in the picked block ({href, time}: `time` is true when the link wraps a <time>).
 * `time` marks the shapes any site could use (a status link, a /@user/123 link): only the link that dates the post counts.
 */
export const PERMALINKS = [
  { re: /^https?:\/\/(?:[a-z0-9-]+\.)*linkedin\.com\/feed\/update\/urn:li:(?:activity|share|ugcPost):\d+/ },
  { re: /^https?:\/\/(?:[a-z0-9-]+\.)*linkedin\.com\/posts\/[^/?#]+/ },
  { re: /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[^/?#]+\/status\/\d+/, time: true },
  { re: /^https?:\/\/bsky\.app\/profile\/[^/?#]+\/post\/[^/?#]+/ },
  { re: /^https?:\/\/[^/?#]+\/@[^/?#]+\/\d+(?=[/?#]|$)/, time: true },
  { re: /^https?:\/\/(?:[a-z0-9-]+\.)*reddit\.com\/r\/[^/?#]+\/comments\/[^/?#]+(?:\/[^/?#]+){0,2}/ },
];

const site = (host) => host.split(".").slice(-2).join(".");

/** The block's own URL when it carries one (so the backend classifies and dedups per post), else the page's. A link to another site (an embedded tweet) is not the block's. */
export function permalink(links, pageUrl) {
  let page;
  try { page = new URL(pageUrl).hostname; } catch { return pageUrl; }
  for (const { href, time } of links ?? []) {
    let u;
    try { u = new URL(href); } catch { continue; }
    if (site(u.hostname) !== site(page)) continue;
    for (const p of PERMALINKS) {
      const m = p.re.exec(u.origin + u.pathname);
      if (m && (!p.time || time)) return m[0];
    }
  }
  return pageUrl;
}

/** POST to the share app; throws a French message when it fails. */
export async function send(payload) {
  const server = await getServer();
  if (!server) throw new Error("Serveur non configuré : ouvre les options de l'extension.");
  if (!(await chrome.permissions.contains({ origins: [hostPattern(server)] }))) throw new Error("Accès au serveur non autorisé : enregistre à nouveau l'adresse dans les options.");
  let r;
  try { r = await fetch(`${server}/share/api`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), redirect: "error" }); }
  catch (e) { throw new Error(`Serveur injoignable ou redirection (SSO ?) sur ${server}. Es-tu sur le LAN ou le VPN ?`); }
  if (!r.ok) throw new Error(`Refusé par le serveur (${r.status}) : ${(await r.text().catch(() => "")).slice(0, 120)}`);
}
