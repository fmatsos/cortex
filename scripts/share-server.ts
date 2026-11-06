#!/usr/bin/env bun
/**
 * Share target for the phone: an installable web app (Android "Share" menu) that drops what is shared into the
 * notes repo's `inbox/` through the Gitea API, one file per share. The push then runs the CI (inbox → compile → site).
 *
 *   GITEA_URL=http://127.0.0.1:3000 GITEA_TOKEN=… SHARE_REPO=owner/thoughts [SHARE_PORT=8090] bun scripts/share-server.ts
 *
 * Serve it under /share/ behind the same SSO as the site (HTTPS is required for the install). A pure link becomes
 * `<id>.url` (cortex fetches the page); text (a LinkedIn post, a note) becomes `<id>.md`, its link kept inside, so
 * nothing depends on a page that needs a login. The page keeps unsent shares on the phone and retries them.
 */
const { GITEA_URL = "http://127.0.0.1:3000", GITEA_TOKEN, SHARE_REPO, SHARE_PORT = "8090" } = process.env;
if (import.meta.main && (!GITEA_TOKEN || !SHARE_REPO)) throw new Error("GITEA_TOKEN and SHARE_REPO are required");

type Share = { title?: string; text?: string; url?: string; note?: string };

/**
 * The inbox files of a share, as [extension, content], or null when nothing was shared. The note (why it is kept,
 * optional) goes on the `.url` line, or in `<name>.md.note` next to a text. A text with an explicit `url` (a page captured by the
 * browser extension: the text is what the page showed, behind its paywall or login) keeps it in `<name>.md.origin`: the source's
 * `url`, not fetched.
 */
export function toInbox({ title = "", text = "", url = "", note = "" }: Share): [string, string][] | null {
  title = title.trim(); text = text.trim(); url = url.trim(); note = note.trim().replace(/\s+/g, " ");
  const link = url || text.match(/https?:\/\/\S+/)?.[0] || "";
  // a link found in the text is taken out of it; an explicit url only when it ends the text (a page's own text may quote it)
  const rest = (link ? (url ? (text.endsWith(url) ? text.slice(0, -url.length) : text) : text.replace(link, "")) : text).trim();
  if (!rest) return link ? [["url", `${link}${note ? ` ${note}` : ""}\n`]] : null;
  const head = title || rest.split("\n")[0].slice(0, 80);
  const md: [string, string] = ["md", `# ${head}\n\n${rest}\n${link ? `\nSource : <${link}>\n` : ""}`];
  const extra: [string, string][] = [];
  if (url) extra.push(["md.origin", `${url}\n`]);
  if (note) extra.push(["md.note", `${note}\n`]);
  return [md, ...extra];
}

const icon = Bun.file(new URL("../assets/logo/cortex-192.png", import.meta.url));
const icon512 = Bun.file(new URL("../assets/logo/cortex-512.png", import.meta.url));
const manifest = {
  name: "Cortex", short_name: "Cortex", start_url: "/share/", scope: "/share/", display: "standalone",
  background_color: "#ffffff", theme_color: "#ffffff",
  icons: [{ src: "/share/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/share/icon-512.png", sizes: "512x512", type: "image/png" }],
  // GET: the share survives an SSO redirect (the query comes back), a POST body would not
  share_target: { action: "/share/", method: "GET", params: { title: "title", text: "text", url: "url" } },
};

const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cortex — partage</title><link rel="manifest" href="/share/manifest.webmanifest" crossorigin="use-credentials">
<style>body{font:16px system-ui,sans-serif;margin:0 16px;max-width:40rem}textarea,input{width:100%;box-sizing:border-box;font:inherit;margin:.25rem 0}
button{font:inherit;padding:.5rem 1rem}#s{white-space:pre-line}</style></head><body>
<h1>Cortex</h1><p id="s"></p>
<form id="f"><input id="u" placeholder="Lien (facultatif)"><textarea id="t" rows="6" placeholder="Texte (facultatif avec un lien)"></textarea>
<textarea id="n" rows="2" placeholder="Pourquoi je garde ça (note, facultative)"></textarea><button>Envoyer à l'inbox</button></form>
<script>
const K = "cortex-share-queue", s = document.getElementById("s");
const load = () => { try { return JSON.parse(localStorage.getItem(K) || "[]"); } catch { return []; } };
const save = (q) => { try { localStorage.setItem(K, JSON.stringify(q)); } catch {} };
async function flush() {
  let q = load(), sent = 0;
  for (const item of [...q]) {
    try {
      const r = await fetch("/share/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(item), redirect: "error" });
      if (!r.ok) throw new Error(await r.text());
      q = q.filter((x) => x !== item); save(q); sent++;
    } catch (e) { s.textContent = "Pas envoyé (" + e.message + "). Gardé sur le téléphone : rouvre Cortex pour réessayer."; return; }
  }
  if (sent) s.textContent = "Envoyé ✓ (" + sent + ")";
}
// sites whose pages need a login: the link alone gives nothing, so the post's text is asked for instead
const WALLED = /(^|\\.)(facebook\\.com|fb\\.watch|reddit\\.com|redd\\.it|instagram\\.com|threads\\.net|x\\.com|twitter\\.com)$/;
const p = new URLSearchParams(location.search);
let title = "";
if (p.get("title") || p.get("text") || p.get("url")) {
  const item = { title: p.get("title") || "", text: p.get("text") || "", url: p.get("url") || "" };
  history.replaceState(null, "", "/share/");
  const link = item.url || (item.text.trim().match(/^https?:\\/\\/\\S+$/) || [""])[0];
  let host = ""; try { host = new URL(link).hostname; } catch {}
  // the share fills the form: a note can be added (optional), then it is sent
  document.getElementById("u").value = link;
  document.getElementById("t").value = item.text.replace(link, "").trim();
  title = item.title;
  if (link && WALLED.test(host) && !item.text.replace(link, "").trim()) {
    document.getElementById("t").focus();
    s.textContent = host + " exige une connexion : cortex ne pourra pas lire la page. Copie le texte du post dans l'appli d'origine, colle-le dans « Texte », puis envoie.";
  } else { document.getElementById("n").focus(); s.textContent = "Ajoute une note si tu veux, puis envoie."; }
}
document.getElementById("f").onsubmit = (e) => { e.preventDefault();
  const url = document.getElementById("u").value, text = document.getElementById("t").value, note = document.getElementById("n").value;
  if (!url.trim() && !text.trim()) return;
  save([...load(), { title, url, text, note }]); title = ""; e.target.reset(); flush(); };
flush();
</script></body></html>`;

async function put(share: Share): Promise<Response> {
  const files = toInbox(share);
  if (!files) return new Response("rien à envoyer", { status: 400 });
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  const paths = files.map(([ext]) => `inbox/partage-${id}.${ext}`);
  // one commit for the share and its note
  const r = await fetch(`${GITEA_URL}/api/v1/repos/${SHARE_REPO}/contents`, {
    method: "POST",
    headers: { authorization: `token ${GITEA_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: `inbox: partage ${id}`,
      files: files.map(([, content], i) => ({ operation: "create", path: paths[i], content: Buffer.from(content).toString("base64") })),
    }),
  });
  return r.ok ? Response.json({ paths }) : new Response(`Gitea ${r.status}`, { status: 502 });
}

/** The browser extension (chrome-extension://<id>) posts from its own origin: it is answered, other origins are not. */
export async function route(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  const origin = req.headers.get("origin") ?? "";
  const cors: Record<string, string> = /^chrome-extension:\/\/[a-p]{32}$/.test(origin)
    ? { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "600", vary: "origin" }
    : {};
  if (pathname === "/share/api" && req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (pathname === "/share/api" && req.method === "POST") {
    const r = await put(await req.json().catch(() => ({})));
    for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
    return r;
  }
  if (pathname === "/share/manifest.webmanifest") return Response.json(manifest, { headers: { "content-type": "application/manifest+json" } });
  if (pathname === "/share/icon-192.png") return new Response(icon);
  if (pathname === "/share/icon-512.png") return new Response(icon512);
  if (pathname === "/share/" || pathname === "/share") return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
  return new Response("not found", { status: 404 });
}

if (import.meta.main) Bun.serve({ hostname: "127.0.0.1", port: Number(SHARE_PORT), fetch: route });
