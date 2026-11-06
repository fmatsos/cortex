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

/** Reads the tab: "page" (Readability → Markdown) or "selection" → {title, url, text}. Throws a French message. */
export async function capture(tabId, mode) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["vendor/Readability.js", "vendor/turndown.js", "capture.js"] });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: (m) => globalThis.__cortex[m](), args: [mode] });
    if (result?.error) throw new Error(result.error);
    return result;
  } catch (e) {
    throw new Error(/Cannot access|extensions gallery|chrome:\/\//i.test(e.message) ? "Cette page ne peut pas être lue (page du navigateur ou boutique)." : e.message);
  }
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
