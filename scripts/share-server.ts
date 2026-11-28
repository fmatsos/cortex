#!/usr/bin/env bun
/**
 * Share target for the phone: an installable web app (Android "Share" menu) that drops what is shared into the
 * notes repo's `inbox/`, one commit per share, pushed to the checkout's remote (Gitea, GitHub, GitLab… any git remote:
 * its credentials are git's, an SSH key or a token in the remote URL). The push then runs the CI (inbox → compile → site).
 *
 *   [SHARE_PORT=8090] cortex share        (in a checkout of the notes repo, or CORTEX_ROOT=<checkout>)
 *   (or bun scripts/share-server.ts from the sources)
 *
 * `cortex serve` serves the same pages under /share/ without git for the inbox: the files land in its checkout's
 * (untracked) `inbox/`, it runs `cortex inbox` and commits the sources. `cortex share` is for a host without `serve`.
 * Serve it under /share/ behind the same SSO as the site (HTTPS is required for the install). A pure link becomes
 * `<id>.url` (cortex fetches the page); text (a LinkedIn post, a note) becomes `<id>.md`, its link kept inside, so
 * nothing depends on a page that needs a login. The page keeps unsent shares on the phone and retries them.
 * `/share/bookmarklet` serves the Android bookmarklet (block picker); SHARE_PUBLIC_URL is the origin baked into it when the proxy
 * does not forward the public Host / X-Forwarded-Proto.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { imageType } from "../src/describe-image";
import { commitAndPush, pullRebase } from "../src/sync";
import { bookmarklet, probes } from "./bookmarklet";

const { SHARE_PORT = "8090", SHARE_PUBLIC_URL } = process.env;
/** The notes repo's checkout the shares are committed in (`start`). */
let checkout = process.env.CORTEX_ROOT ?? process.cwd();
// one share at a time: they share the git index
let queue: Promise<unknown> = Promise.resolve();

/** What a share is, when its sender says so (the site's Add page): a note or a resource, instead of what its content says. */
export type ShareAs = "note" | "resource";
type Share = { title?: string; text?: string; url?: string; note?: string; as?: ShareAs };
const isShareAs = (v: unknown): v is ShareAs => v === "note" || v === "resource";

/**
 * The files the share route takes as uploads (`multipart/form-data`, field `file`): the extension of the client's file name (lowercased, the name
 * is never used otherwise) → the extension the file is saved under in `inbox/`. The one place to extend (`add` must read the type too).
 */
export const UPLOAD_TYPES: Readonly<Record<string, string>> = {
  ".pdf": "pdf", ".md": "md", ".markdown": "md", ".txt": "txt", ".png": "png", ".jpg": "jpg", ".jpeg": "jpg", ".webp": "webp", ".gif": "gif",
  ".docx": "docx", ".odt": "odt", ".rtf": "rtf", ".epub": "epub", ".html": "html", ".htm": "html", // read by pandoc (add.ts DOCUMENT_FORMATS)
};
/** The first bytes a document must start with (ZIP for the Office, OpenDocument and EPUB ones, RTF's own); HTML is only text, unchecked. */
const SIGNATURES: Record<string, string> = { docx: "PK\x03\x04", odt: "PK\x03\x04", epub: "PK\x03\x04", rtf: "{\\rtf" };
/** One uploaded file at most this big (a bigger one is a 413); Bun's default request limit (128 MiB) is above it. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Files in one request at most. */
export const MAX_UPLOADS = 10;
const MB = 1024 * 1024;

const oneLine = (note: string) => note.trim().replace(/\s+/g, " ");

/**
 * The inbox files of a share, as [extension, content], or null when nothing was shared. The note (why it is kept,
 * optional) goes on the `.url` line, or in `<name>.md.note` next to a text. A text with an explicit `url` (a page captured by the
 * browser extension: the text is what the page showed, behind its paywall or login) keeps it in `<name>.md.origin`: the source's
 * `url`, not fetched. An explicit `as` goes in `<name>.md.as` (`inbox` hands it to `add`); for a note the text is kept as typed (a link in it
 * is Markdown, not a source to fetch) and a `url` is ignored.
 */
export function toInbox({ title = "", text = "", url = "", note = "", as }: Share): [string, string][] | null {
  title = title.trim(); text = text.trim(); url = url.trim(); note = oneLine(note);
  if (as === "note") {
    if (!text) return null;
    return [["md", `# ${title || text.split("\n")[0].slice(0, 80)}\n\n${text}\n`], ["md.as", "note\n"], ...(note ? [["md.note", `${note}\n`] as [string, string]] : [])];
  }
  const link = url || text.match(/https?:\/\/\S+/)?.[0] || "";
  // a link found in the text is taken out of it; an explicit url only when it ends the text (a page's own text may quote it)
  const rest = (link ? (url ? (text.endsWith(url) ? text.slice(0, -url.length) : text) : text.replace(link, "")) : text).trim();
  if (!rest) return link ? [["url", `${link}${note ? ` ${note}` : ""}\n`]] : null;
  const head = title || rest.split("\n")[0].slice(0, 80);
  const md: [string, string] = ["md", `# ${head}\n\n${rest}\n${link ? `\nSource : <${link}>\n` : ""}`];
  const extra: [string, string][] = [];
  if (url) extra.push(["md.origin", `${url}\n`]);
  if (note) extra.push(["md.note", `${note}\n`]);
  if (as) extra.push(["md.as", `${as}\n`]);
  return [md, ...extra];
}

const icon = Bun.file(new URL("../assets/logo/cortex-192.png", import.meta.url));
const icon512 = Bun.file(new URL("../assets/logo/cortex-512.png", import.meta.url));
/** The web manifest of the share app mounted under `base` ("" at the root, `/s/<space>` for the share target of one space of a `cortex serve`). */
const manifest = (base: string) => ({
  name: "Cortex", short_name: "Cortex", start_url: `${base}/share/`, scope: `${base}/share/`, display: "standalone",
  background_color: "#ffffff", theme_color: "#ffffff",
  icons: [{ src: `${base}/share/icon-192.png`, sizes: "192x192", type: "image/png" }, { src: `${base}/share/icon-512.png`, sizes: "512x512", type: "image/png" }],
  // GET: the share survives an SSO redirect (the query comes back), a POST body would not
  share_target: { action: `${base}/share/`, method: "GET", params: { title: "title", text: "text", url: "url" } },
});

const page = (base: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cortex — partage</title><link rel="manifest" href="${base}/share/manifest.webmanifest" crossorigin="use-credentials">
<style>body{font:16px system-ui,sans-serif;margin:0 16px;max-width:40rem}textarea,input{width:100%;box-sizing:border-box;font:inherit;margin:.25rem 0}
button{font:inherit;padding:.5rem 1rem}#s{white-space:pre-line}</style></head><body>
<h1>Cortex</h1><p id="s"></p><p><a href="${base}/share/bookmarklet">Capturer un bloc d'une page sur Android (bookmarklet)</a></p>
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
      const r = await fetch("${base}/share/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(item), redirect: "error" });
      if (!r.ok) throw new Error(await r.text());
      q = q.filter((x) => x !== item); save(q); sent++;
    } catch (e) { s.textContent = "Pas envoyé (" + e.message + "). Gardé sur le téléphone : rouvre Cortex pour réessayer."; return; }
  }
  if (sent) s.textContent = "Envoyé ✓ (" + sent + ")";
}
// sites whose pages need a login: the link alone gives nothing, so the post's text is asked for instead
const WALLED = /(^|\\.)(facebook\\.com|fb\\.watch|reddit\\.com|redd\\.it|instagram\\.com|threads\\.net|x\\.com|twitter\\.com)$/;
// the bookmarklet carries a long text in the fragment (never sent to the server), a share from Android in the query
const p = new URLSearchParams(location.hash.slice(1) || location.search);
let title = "";
if (p.get("title") || p.get("text") || p.get("url")) {
  const item = { title: p.get("title") || "", text: p.get("text") || "", url: p.get("url") || "" };
  history.replaceState(null, "", "${base}/share/");
  const link = item.url || (item.text.trim().match(/^https?:\\/\\/\\S+$/) || [""])[0];
  // the link repeated at the end of the text is taken out of it (an Android share); a link inside a captured text stays
  const rest = (link && item.text.trim().endsWith(link) ? item.text.trim().slice(0, -link.length) : item.text).trim();
  let host = ""; try { host = new URL(link).hostname; } catch {}
  // the share fills the form: a note can be added (optional), then it is sent
  document.getElementById("u").value = link;
  document.getElementById("t").value = rest;
  title = item.title;
  if (link && WALLED.test(host) && !rest) {
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

/** A share the space refuses (its content leaves that kind out): answered 409 with the reason. */
export class ShareRefused extends Error {}

/** Where a share's inbox files go: written (and committed, pushed…) by the caller, which returns once they are safe. */
export type Deliver = (files: { path: string; content: string | Uint8Array }[], id: string) => Promise<void>;

/** `cortex share` alone: committed to `inbox/` in its checkout and pushed to its remote, one share at a time. */
const gitDeliver: Deliver = (files, id) => {
  const run = queue.then(async () => {
    pullRebase(checkout, "cortex-share");
    mkdirSync(join(checkout, "inbox"), { recursive: true });
    for (const f of files) await Bun.write(join(checkout, f.path), f.content);
    commitAndPush(checkout, `inbox: add share ${id}\n\n${files.map((f) => `- ${f.path}`).join("\n")}`, files.map((f) => f.path), "cortex-share");
  });
  queue = run.catch(() => {});
  return run;
};

/** An uploaded file as an inbox entry, or the refusal: 415 (not a type of `UPLOAD_TYPES`, or a "PDF", an image or a document that is not one) or 413 (over `MAX_UPLOAD_BYTES`). The client's name only gives the extension, and a title to a text with none. */
async function upload(f: File, n: number): Promise<{ ext: string; content: string | Uint8Array } | Response> {
  const dot = f.name.lastIndexOf("."), ext = UPLOAD_TYPES[dot < 0 ? "" : f.name.slice(dot).toLowerCase()];
  if (!ext) return new Response(`unsupported file type: ${JSON.stringify(f.name.slice(0, 80))} (accepted: ${Object.keys(UPLOAD_TYPES).join(", ")})`, { status: 415 });
  if (f.size > MAX_UPLOAD_BYTES) return new Response(`file too large: ${JSON.stringify(f.name.slice(0, 80))} (${MAX_UPLOAD_BYTES / MB} MB at most per file)`, { status: 413 });
  if (ext === "pdf") {
    const bytes = new Uint8Array(await f.arrayBuffer());
    return new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-" ? { ext, content: bytes } : new Response(`${JSON.stringify(f.name.slice(0, 80))} is not a PDF`, { status: 415 });
  }
  if (["png", "jpg", "webp", "gif"].includes(ext)) { // its first bytes say what it is: the client's name and type prove nothing
    const bytes = new Uint8Array(await f.arrayBuffer());
    return imageType(bytes) ? { ext, content: bytes } : new Response(`${JSON.stringify(f.name.slice(0, 80))} is not a PNG, JPEG, WebP or GIF image`, { status: 415 });
  }
  if (ext in SIGNATURES || ext === "html") { // kept as is, for pandoc
    const bytes = new Uint8Array(await f.arrayBuffer()), sig = SIGNATURES[ext];
    return !sig || new TextDecoder("latin1").decode(bytes.subarray(0, sig.length)) === sig ? { ext, content: bytes } : new Response(`${JSON.stringify(f.name.slice(0, 80))} is not a .${ext} file`, { status: 415 });
  }
  // a text with no `# heading` takes its file's name for one (otherwise its title would be the generated name of the inbox file)
  const text = await f.text(), stem = f.name.slice(0, dot).replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 80);
  return { ext, content: /^#[ \t]+\S/m.test(text) || !stem ? text : `# ${stem}\n\n${text}` };
}

/** `uploads`: the files of a `multipart/form-data` share: attachments of its note when it is one (`as: "note"` with a text), else each one carries the share's `note` and `as` (`<file>.note`, `<file>.as`). */
async function put(share: Share, deliver: Deliver, uploads: File[] = []): Promise<Response> {
  if (share.as !== undefined && !isShareAs(share.as)) return new Response(`"as" must be "note" or "resource"`, { status: 400 });
  if (uploads.length > MAX_UPLOADS) return new Response(`too many files (${MAX_UPLOADS} at most)`, { status: 413 });
  const files = toInbox(share);
  const taken: { ext: string; content: string | Uint8Array }[] = [];
  for (const [i, f] of uploads.entries()) { const u = await upload(f, i); if (u instanceof Response) return u; taken.push(u); } // all checked before anything is delivered
  if (!files && !taken.length) return new Response("rien à envoyer", { status: 400 });
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  const out: { path: string; content: string | Uint8Array }[] = (files ?? []).map(([ext, content]) => ({ path: `inbox/partage-${id}.${ext}`, content }));
  const note = oneLine(share.note ?? "");
  // a note with files: the files are its attachments (each its own source, tied to the note: `<file>.of` names the note's inbox file; the `as` and the
  // note are the note's, an attachment is what `add` says it is). Otherwise `note` and `as` go on each file.
  const attachedTo = share.as === "note" && out.length ? out[0]!.path.split("/").at(-1) : undefined;
  for (const [i, u] of taken.entries()) {
    const path = `inbox/partage-${id}-${i + 1}.${u.ext}`;
    out.push({ path, content: u.content });
    if (attachedTo) { out.push({ path: `${path}.of`, content: `${attachedTo}\n` }); continue; }
    if (note) out.push({ path: `${path}.note`, content: `${note}\n` });
    if (share.as) out.push({ path: `${path}.as`, content: `${share.as}\n` });
  }
  try { await deliver(out, id); return Response.json({ paths: out.map((f) => f.path) }); }
  catch (e) {
    if (e instanceof ShareRefused) return new Response(e.message, { status: 409 });
    console.error(`share ${id}: ${(e as Error).message}`);
    return new Response("échec de l'enregistrement", { status: 502 });
  }
}

/** The share of a request: JSON (the phone, the extension) or `multipart/form-data` (fields `title`, `text`, `url`, `note`, `as` and `file` parts, from the site's Add page). */
async function shared(req: Request): Promise<{ share: Share; uploads: File[] } | Response> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) return { share: await req.json().catch(() => ({})), uploads: [] };
  const form = await req.formData().catch(() => undefined);
  if (!form) return new Response("invalid multipart/form-data", { status: 400 });
  const field = (k: string) => { const v = form.get(k); return typeof v === "string" ? v : undefined; };
  const share: Share = { title: field("title"), text: field("text"), url: field("url"), note: field("note") };
  if (field("as") !== undefined) share.as = field("as") as ShareAs; // checked by put
  return { share, uploads: form.getAll("file").filter((v): v is File => typeof v !== "string") };
}

/** The bookmarklet's page (French): how to install it on Android Chrome, and the code, with this server's public origin baked in. */
async function bookmarkletPage(req: Request, base: string): Promise<Response> {
  const u = new URL(req.url), h = req.headers;
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() || u.protocol.replace(":", "");
  const server = (SHARE_PUBLIC_URL || `${proto}://${h.get("x-forwarded-host")?.split(",")[0].trim() || h.get("host") || u.host}`).replace(/\/+$/, "");
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const code = esc(await bookmarklet(server + base));
  return new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cortex — bookmarklet</title><style>body{font:16px system-ui,sans-serif;margin:0 16px;max-width:40rem}textarea{width:100%;box-sizing:border-box;font:12px ui-monospace,monospace}
button{font:inherit;padding:.75rem 1rem;min-height:48px}</style></head><body><h1>Cortex : capturer un bloc</h1>
<p>Un bookmarklet pour Chrome Android : sur une page (fil LinkedIn, X, Reddit…), il te laisse toucher un post, l'élargir ou le réduire, puis l'envoie ici, où tu ajoutes une note avant de valider. Aucune appli à installer.</p>
<h2>Installer</h2><ol><li>Touche <b>Copier le bookmarklet</b> ci-dessous.</li>
<li>Dans Chrome, ajoute un favori quelconque (⋮ → ☆), puis ouvre-le pour le modifier (⋮ → Favoris → ⋮ sur le favori → Modifier).</li>
<li>Nomme-le <b>cortex</b> et colle le code dans le champ <b>URL</b>. Enregistre.</li></ol>
<h2>Utiliser</h2><p>Sur la page à capturer, tape <b>cortex</b> dans la barre d'adresse (sans valider) et touche la suggestion avec l'étoile. Touche un bloc, ajuste avec <b>Agrandir</b> / <b>Réduire</b>, puis <b>Envoyer</b> : la page de partage s'ouvre avec le texte, ajoute ta note et envoie. Les liens de la page ne sont pas suivis tant que le mode est actif ; <b>Annuler</b> le quitte.</p>
<p><button id="c">Copier le bookmarklet</button> <span id="m" role="status"></span></p>
<textarea id="code" rows="6" readonly>${code}</textarea>
<h2>Si le code collé est tronqué</h2><p>Le champ URL d'un favori sur Android peut couper un code long. Installe-le plutôt depuis Chrome sur ordinateur, connecté au même compte Google avec la synchronisation des favoris : ouvre cette page sur l'ordinateur et <b>glisse ce lien dans la barre de favoris</b> (Ctrl+Maj+B pour l'afficher). Il arrive tel quel sur le téléphone, dans « Favoris sur ordinateur ».</p>
<p><a href="${code}" style="display:inline-block;padding:.75rem 1rem;border:2px dashed #1a73e8;border-radius:8px;font-weight:bold">cortex</a></p>
<p>Adresse du serveur intégrée au code : <code>${(server + base).replace(/[<&>"]/g, "")}</code>. Si elle est fausse, ouvre cette page par la bonne adresse.</p>
<h2>Rien ne se passe ?</h2><p>Chrome Android peut refuser un favori trop long. Copie un de ces favoris de test (il encadre la page en rouge), installe-le comme ci-dessus sous le nom <b>cortextest</b>, et note la plus grande taille qui marche.</p>
${probes().map(({ k, code: c }) => `<p><button data-p="${k}">Copier le test ${k} Ko</button></p><textarea id="p${k}" hidden>${esc(c)}</textarea>`).join("")}
<p><a href="${base}/share/">Retour au partage</a></p>
<script>document.getElementById("c").onclick = async () => { const t = document.getElementById("code"), m = document.getElementById("m");
try { await navigator.clipboard.writeText(t.value); m.textContent = "Copié ✓"; } catch { t.select(); m.textContent = document.execCommand("copy") ? "Copié ✓" : "Sélectionné : copie-le à la main."; } };
for (const b of document.querySelectorAll("[data-p]")) b.onclick = async () => { await navigator.clipboard.writeText(document.getElementById("p" + b.dataset.p).value); b.textContent += " ✓"; };</script>
</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}

/**
 * The browser extension (chrome-extension://<id>) posts from its own origin: it is answered, other origins are not. `base`: where the app is
 * mounted when it is not at the root (`/s/<space>` under `cortex serve`): the request's path starts with it, and the pages, the manifest and
 * the API URL they carry are under it too, so a share made there is delivered by the space that serves it.
 */
export async function route(req: Request, deliver: Deliver = gitDeliver, base = ""): Promise<Response> {
  let { pathname } = new URL(req.url);
  if (base && pathname.startsWith(`${base}/`)) pathname = pathname.slice(base.length);
  const origin = req.headers.get("origin") ?? "";
  const cors: Record<string, string> = /^chrome-extension:\/\/[a-p]{32}$/.test(origin)
    ? { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "600", vary: "origin" }
    : {};
  if (pathname === "/share/api" && req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (pathname === "/share/api" && req.method === "POST") {
    const got = await shared(req);
    const r = got instanceof Response ? got : await put(got.share, deliver, got.uploads);
    for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
    return r;
  }
  if (pathname === "/share/manifest.webmanifest") return Response.json(manifest(base), { headers: { "content-type": "application/manifest+json" } });
  if (pathname === "/share/bookmarklet" && req.method === "GET") return bookmarkletPage(req, base);
  if (pathname === "/share/icon-192.png") return new Response(icon);
  if (pathname === "/share/icon-512.png") return new Response(icon512);
  if (pathname === "/share/" || pathname === "/share") return new Response(page(base), { headers: { "content-type": "text/html; charset=utf-8" } });
  return new Response("not found", { status: 404 });
}

/** Serves the share target on 127.0.0.1:SHARE_PORT (`cortex share`, or this file run directly), committing in `root`. */
export function start(root = checkout) {
  checkout = root;
  if (Bun.spawnSync(["git", "-C", root, "rev-parse", "--abbrev-ref", "@{u}"], { stderr: "ignore" }).exitCode !== 0)
    throw new Error(`${root}: not a git checkout with an upstream branch (clone the notes repo, then run cortex share in it).`);
  return Bun.serve({ hostname: "127.0.0.1", port: Number(SHARE_PORT), fetch: (req) => route(req) });
}

if (import.meta.main) start();
