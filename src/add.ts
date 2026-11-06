import { dirname, join } from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { openWiki, type Wiki } from "./context";
import { rawId } from "./doc";
import { localIso, normUrl, rawPath, serializeDoc, sha256 } from "./lib";
import { free } from "./naming";
import { expand } from "./template";
import { appendLogCtx } from "./log";
import { paint } from "./style";
import { LIMITS } from "./limits";
import pkg from "../package.json";

const UA = `Mozilla/5.0 (X11; Linux x86_64) cortex-cli/${pkg.version}`;
/** Version of a dependency as installed by package.json (range prefix stripped), for the `extractor` field. */
const depVersion = (name: keyof typeof pkg.dependencies) => pkg.dependencies[name].replace(/^[\^~]/, "");
/** Cap on any fetched body (HTML and PDF), checked on content-length and while streaming. */
export const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;

export type Extract = {
  title: string; content: string; kind: string; extractor: string;
  url?: string; author?: string; published?: string; partial?: string; blob?: Uint8Array; blobExt?: string;
};

/** `publicOnly`: MCP path, refuses loopback/private/link-local targets (the CLI stays permissive). `maxBytes`: body cap, injectable for tests. */
export type FetchOpts = { publicOnly?: boolean; maxBytes?: number; mirrors?: string[]; timeoutMs?: number };

/** `--via` → mirror bases, tried in order; the article URL is appended as is. */
// ponytail: hardcoded, the .cfd domains move; make them a cortex.json setting once one dies
export const VIA: Record<string, string[]> = { freedium: ["https://freedium-mirror.cfd/", "https://freedium.cfd/"] };

/** IPv4 in dotted form → private/loopback/link-local/CGNAT/unspecified/multicast-reserved? */
function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Any address that must not be reached from the MCP path; IPv6 is expanded to 8 groups to catch the IPv4-embedding forms. */
export function privateIp(ip: string): boolean {
  if (isIP(ip) === 4) return privateV4(ip);
  let tail: number[] = [];
  let h = ip.split("%")[0].toLowerCase();
  const v4 = h.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) { const o = v4[1].split(".").map(Number); tail = [o[0] << 8 | o[1], o[2] << 8 | o[3]]; h = h.slice(0, -v4[1].length) + "0:0"; }
  const [l, r = ""] = h.split("::");
  const [lg, rg] = [l, r].map((x) => (x ? x.split(":") : []));
  const g = h.includes("::") ? [...lg, ...Array(8 - lg.length - rg.length).fill("0"), ...rg] : lg;
  const n = g.map((x) => parseInt(x, 16));
  if (tail.length) n.splice(6, 2, ...tail);
  const embedded = (a: number, b: number) => privateV4(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`);
  if (n.slice(0, 5).every((x) => x === 0) && (n[5] === 0 || n[5] === 0xffff)) return n[5] === 0xffff ? embedded(n[6], n[7]) : true; // ::, ::1, ::a.b.c.d, ::ffff:a.b.c.d
  if (n[0] === 0x64 && n[1] === 0xff9b && n.slice(2, 6).every((x) => x === 0)) return embedded(n[6], n[7]); // NAT64
  if (n[0] === 0x2002) return embedded(n[1], n[2]); // 6to4
  return (n[0] & 0xfe00) === 0xfc00 || (n[0] & 0xffc0) === 0xfe80;
}

/** Refuses a non-http(s) URL, or a host (literal or resolved, ANY address) in a non-public range. */
async function assertPublic(url: string): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`Scheme refused: ${u.protocol} (http(s) only).`);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addrs.some(privateIp)) throw new Error(`Address refused: ${host} points to a local or private network (MCP access is limited to public addresses).`);
}

/** Body read as a stream, aborted past `max` (a bare `res.text()` would load a multi-GB response in memory). */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const tooBig = () => new Error(`Response too large (> ${Math.round(max / 1024 / 1024)} MB): nothing written.`);
  if (Number(res.headers.get("content-length")) > max) { await res.body?.cancel(); throw tooBig(); }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { await reader.cancel(); throw tooBig(); }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** GET with a body cap; with `publicOnly`, redirects are followed by hand so every hop is checked. */
async function fetchCapped(url: string, o: FetchOpts): Promise<{ res: Response; bytes: Uint8Array; url: string }> {
  const signal = AbortSignal.timeout(o.timeoutMs ?? LIMITS.fetchTimeoutMs);
  let cur = url;
  for (let hop = 0; ; hop++) {
    if (o.publicOnly) await assertPublic(cur);
    const res = await fetch(cur, { headers: { "user-agent": UA, "accept-language": "fr,en;q=0.8" }, signal, redirect: o.publicOnly ? "manual" : "follow" });
    const next = res.headers.get("location");
    if (o.publicOnly && res.status >= 300 && res.status < 400 && next) {
      await res.body?.cancel();
      if (hop >= MAX_REDIRECTS) throw new Error(`Too many redirects (> ${MAX_REDIRECTS}) on ${url}.`);
      cur = new URL(next, cur).href;
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${url} (paywall, anti-bot block?): nothing written.`);
    return { res, bytes: await readCapped(res, o.maxBytes ?? MAX_BODY_BYTES), url: o.publicOnly ? cur : res.url };
  }
}

/**
 * Title of a web page. defuddle sometimes keeps the site side of « Page · Site » (« Qwen/Qwen3-4B-Instruct-2507 ·
 * Hugging Face » gave « Hugging Face »): when its title is the part after the last « · », « | » or « – » of the full
 * document title, the part before it is taken. Otherwise defuddle, then the full title, then the first heading, then the URL.
 */
export function pageTitle(defuddle: string | undefined, full: string | undefined, heading: string | undefined, url: string): string {
  const d = defuddle?.trim(), f = full?.trim();
  const m = f?.match(/^(.*\S)\s+[·|–—]\s+([^·|–—]+)$/);
  if (m && d && m[2].trim().toLowerCase() === d.toLowerCase()) return m[1];
  return d || f || heading?.trim() || url;
}

/**
 * Social post (LinkedIn, and any page declaring a schema.org SocialMediaPosting / DiscussionForumPosting in JSON-LD):
 * the post's own text, without the comments and the page around it that defuddle would keep.
 */
export function socialPost(html: string): { body: string; author?: string; published?: string } | undefined {
  for (const [, raw] of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try { data = JSON.parse(raw); } catch { continue; }
    const nodes = [data].flat().flatMap((n: any) => (n?.["@graph"] ? [n, ...[n["@graph"]].flat()] : [n]));
    for (const n of nodes as any[]) {
      if (!/^(SocialMediaPosting|DiscussionForumPosting)$/.test(String(n?.["@type"]))) continue;
      const body = String(n.articleBody ?? n.text ?? "").trim();
      if (!body) continue;
      const author = [n.author].flat()[0]?.name;
      return { body, author: typeof author === "string" ? author : undefined, published: n.datePublished || undefined };
    }
  }
}

/**
 * Web page → Markdown. A social post (see socialPost) is taken as is. Otherwise defuddle first; Readability + Turndown in parallel, kept if clearly longer
 * (defuddle sometimes truncates without warning, cf. OKF at step 0).
 */
export async function extractUrl(url: string, opts: FetchOpts = {}): Promise<Extract> {
  if (opts.mirrors?.length) return viaMirrors(url, opts.mirrors, opts);
  const api = socialApi(url);
  if (api) {
    try { return await api.parse(JSON.parse(new TextDecoder().decode((await fetchCapped(api.url, opts)).bytes))); }
    catch (e) { if (!api.fallback) throw new Error(`${api.name}: ${(e as Error).message}`); } // any /@user/123 path looks like Mastodon: maybe it is not
  }
  const { res, bytes, url: finalUrl } = await fetchCapped(url, opts);
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("pdf")) return extractPdf(bytes, url);
  const html = new TextDecoder().decode(bytes);
  const post = socialPost(html);
  if (post) {
    const canonical = parseHTML(html).document.querySelector('link[rel="canonical"]')?.getAttribute("href");
    return {
      title: post.body.split("\n")[0].trim().slice(0, LIMITS.textTitleChars), content: post.body, kind: "article",
      url: canonical ? new URL(canonical, finalUrl).href : finalUrl, author: post.author, published: post.published,
      extractor: "json-ld",
    };
  }
  const d = await Defuddle(parseHTML(html).document, url, { markdown: true });
  const doc = parseHTML(html).document; // second DOM on purpose: Readability mutates its input (REL-26: a clone is not clearly cheaper)
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href");
  const r = new Readability(doc as any).parse(); // mutates doc: canonical read beforehand
  const rb = r?.content ? new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" }).turndown(r.content) : "";
  const [wd, wr] = [countWords(d.content ?? ""), countWords(rb)];
  const useRb = wr > wd * LIMITS.readabilityRatio; // calibration: see LIMITS.readabilityRatio
  const content = useRb ? rb : d.content ?? "";
  if (countWords(content) < LIMITS.minArticleWords) throw new Error(`Almost empty body (${countWords(content)} words) on ${url}: anti-bot block? Nothing written.`);
  // verified markers: Next (« Il reste 69 % de l'article »), Substack (« This post is for paid subscribers »)
  const paywall = /Il reste \d+ ?% de l.article|This post is for paid subscribers/i.test(html);
  return {
    title: pageTitle(d.title, r?.title ?? undefined, content.match(/^#{1,3}[ \t]+(.+)$/m)?.[1], url), content, kind: "article",
    url: canonical ? new URL(canonical, finalUrl).href : finalUrl,
    author: [d.author, r?.byline].find((a) => a && !/^\d+$/.test(a)) ?? undefined /* gist: defuddle returns a numeric id */, published: d.published || undefined,
    extractor: useRb ? `readability/${depVersion("@mozilla/readability")}+turndown` : `defuddle/${depVersion("defuddle")}+linkedom`,
    partial: paywall ? "paywall: partial content" : undefined,
  };
}

type SocialApi = { name: string; url: string; fallback?: boolean; parse: (j: any) => Extract };

/** A post as a source: its text, then the quoted post and the media links. */
function post(name: string, url: string, text: string, author: string | undefined, published: string | undefined, media: string[], quote?: string): Extract {
  const body = [text.trim(), quote && quote.trim().split("\n").map((l) => `> ${l}`).join("\n"), ...media.map((m) => `![](${m})`)].filter(Boolean).join("\n\n");
  if (!body) throw new Error(`empty post on ${url}: nothing written.`);
  return { title: body.split("\n")[0].slice(0, LIMITS.textTitleChars), content: body, kind: "article", url, author, published, extractor: name };
}

const who = (name?: string, handle?: string) => (name && handle ? `${name} (@${handle})` : name || handle) || undefined;
const iso = (d?: string) => (d && !isNaN(Date.parse(d)) ? new Date(d).toISOString() : undefined);

/**
 * X, Bluesky and Mastodon posts read through a public API (the pages need a login or JavaScript).
 * X goes through fxtwitter, a third-party service: it can disappear, x.com has no login-free API.
 */
export function socialApi(url: string): SocialApi | undefined {
  const u = new URL(url), host = u.hostname.replace(/^(www|mobile)\./, "");
  let m: RegExpMatchArray | null;
  if ((host === "x.com" || host === "twitter.com") && (m = u.pathname.match(/^\/[^/]+\/status\/(\d+)/)))
    return { name: "fxtwitter-api", url: `https://api.fxtwitter.com/status/${m[1]}`, parse: ({ tweet: t }) =>
      post("fxtwitter-api", url, t.text ?? "", who(t.author?.name, t.author?.screen_name), iso(t.created_at),
        (t.media?.all ?? []).map((x: any) => x.url), t.quote && `${t.quote.author?.name ?? ""}: ${t.quote.text}`) };
  if (host === "bsky.app" && (m = u.pathname.match(/^\/profile\/([^/]+)\/post\/([^/]+)/)))
    return { name: "bsky-api", url: `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?depth=0&uri=${encodeURIComponent(`at://${m[1]}/app.bsky.feed.post/${m[2]}`)}`,
      parse: ({ thread: { post: p } }) => post("bsky-api", url, p.record?.text ?? "", who(p.author?.displayName, p.author?.handle), iso(p.record?.createdAt),
        (p.embed?.images ?? p.embed?.media?.images ?? []).map((i: any) => i.fullsize), p.embed?.record?.value?.text ?? p.embed?.record?.record?.value?.text) };
  if ((m = u.pathname.match(/^\/@[^/]+\/(\d+)\/?$/)))
    return { name: "mastodon-api", url: `${u.origin}/api/v1/statuses/${m[1]}`, fallback: true, parse: (s) => {
      if (!s?.account) throw new Error("not a Mastodon status");
      const text = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" }).turndown(s.content ?? "");
      return post("mastodon-api", url, text, who(s.account.display_name, s.account.acct), iso(s.created_at), (s.media_attachments ?? []).map((a: any) => a.url));
    } };
}

/** Each mirror in turn (a down mirror hangs or serves an error page); the source keeps the original URL. */
async function viaMirrors(url: string, mirrors: string[], opts: FetchOpts): Promise<Extract> {
  const errs: string[] = [];
  for (const m of mirrors) {
    try {
      const ex = await extractUrl(m + url, { ...opts, mirrors: undefined });
      if (/Could not load this article|Reconnect to read new articles/.test(ex.content)) throw new Error("mirror error page");
      return { ...ex, url, author: ex.author?.replace(/\s*\d+\s*min read\s*$/i, "") || undefined, extractor: `${new URL(m).host}+${ex.extractor}` };
    } catch (e) { errs.push(`${new URL(m).host}: ${(e as Error).message}`); }
  }
  throw new Error(`No mirror served ${url}: nothing written.\n  ${errs.join("\n  ")}`);
}

export async function extractPdf(bytes: Uint8Array, url?: string, name = "document"): Promise<Extract> {
  if (!Bun.which("pdftotext")) throw new Error("pdftotext not found: it extracts the text of PDFs. Install it (apt install poppler-utils).");
  const p = Bun.spawn(["pdftotext", "-layout", "-", "-"], { stdin: bytes, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) throw new Error(`pdftotext failed: ${await new Response(p.stderr).text()}`);
  if (countWords(out) < LIMITS.minPdfWords) throw new Error("PDF without text (scanned?): to be described by the agent, not handled yet.");
  const title = out.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, LIMITS.pdfTitleChars) ?? name;
  return { title, content: out, kind: "pdf", url, extractor: "pdftotext", blob: bytes, blobExt: "pdf" };
}

export function extractText(txt: string, name?: string): Extract {
  const h1 = txt.match(/^#\s+(.+)$/m)?.[1];
  return { title: h1 ?? name ?? txt.trim().split("\n")[0].slice(0, LIMITS.textTitleChars), content: txt, kind: "note", extractor: "manual" };
}

/** Source already present (one of the normalized URLs or same fingerprint) → its id, otherwise undefined. */
export async function findDuplicate(w: Wiki, urls: (string | undefined)[], hash?: string): Promise<string | undefined> {
  const u = new Set(urls.filter(Boolean).map((x) => normUrl(x!)));
  for (const d of await w.raws()) {
    if ((hash && d.fm.sha256 === hash) || (d.fm.url && u.has(normUrl(String(d.fm.url))))) return rawId(d.path);
  }
}

type AddOpts = { note?: string; dryRun?: boolean; now?: Date; text?: string } & FetchOpts;
type AddResult = { id: string; duplicate: boolean; ex?: Extract };

export async function addCtx(w: Wiki, input: string, opts: AddOpts): Promise<AddResult> {
  const root = w.root;
  const now = opts.now ?? new Date();
  let ex: Extract;
  const isUrl = /^https?:\/\//.test(input);
  if (isUrl) {
    const known = await findDuplicate(w, [input]); // before the fetch: no needless request
    if (known) return { id: known, duplicate: true };
    const secs = (await w.config()).fetch_timeout;
    ex = await extractUrl(input, { ...opts, timeoutMs: opts.timeoutMs ?? (secs ? secs * 1000 : undefined) });
  }
  else if (input === "-") ex = extractText(opts.text ?? await Bun.stdin.text()); // text: content supplied without stdin (MCP server)
  else {
    const f = Bun.file(input);
    if (!(await f.exists())) throw new Error(`File not found: ${input}`);
    const name = input.split("/").at(-1)!.replace(/\.[^.]+$/, "");
    ex = /\.pdf$/i.test(input) ? await extractPdf(new Uint8Array(await f.arrayBuffer()), undefined, name)
      : /\.(md|markdown|txt)$/i.test(input) ? extractText(await f.text(), name)
      : (() => { throw new Error(`Unsupported format: ${input} (URL, .md, .txt, .pdf)`); })();
  }
  const hash = sha256(ex.content);
  const dup = await findDuplicate(w, [isUrl ? input : undefined, ex.url], hash);
  if (dup) return { id: dup, duplicate: true, ex };

  const iso = localIso(now);
  // folder according to raw_path (cortex.json); its last segment is the id, unique under raw/
  const base = expand((await w.naming()).raw_path, { at: now, title: ex.title, kind: ex.kind });
  const tried = new Set<string>(); // folders another writer took between the probe and the mkdir
  const taken = (p: string) => tried.has(p) || !!rawPath(root, p.split("/").at(-1)!) || existsSync(join(root, "raw", p));
  let rel = free(base, taken);
  if (opts.dryRun) return { id: rel.split("/").at(-1)!, duplicate: false, ex };

  const fm: Record<string, unknown> = { type: "RawSource", title: ex.title };
  if (ex.url) fm.url = ex.url;
  fm.kind = ex.kind;
  if (ex.author) fm.author = ex.author;
  if (ex.published) fm.published = ex.published;
  fm.sha256 = hash;
  if (ex.blob) {
    const b = `.cortex/blobs/${sha256(ex.blob)}.${ex.blobExt}`;
    await Bun.write(join(root, b), ex.blob);
    fm.blob = b;
  }
  Object.assign(fm, { fetched_at: iso, extractor: ex.extractor, note: opts.note ?? "" });
  if (ex.partial) fm.partial = ex.partial;
  fm.status = "pending";

  // The leaf folder is created without `recursive`: EEXIST means a concurrent add took the name, so the next free suffix is tried.
  let dir: string;
  for (;;) {
    dir = join(root, "raw", rel);
    mkdirSync(dirname(dir), { recursive: true });
    try { mkdirSync(dir); break; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; tried.add(rel); rel = free(base, taken); }
  }
  const id = rel.split("/").at(-1)!;
  const tmp = join(dir, ".source.md.tmp");
  try {
    await writeFile(tmp, serializeDoc(fm, `${ex.content.trim()}\n`), { flag: "wx" });
    await rename(tmp, join(dir, "source.md"));
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; } // the folder is ours: no half-written source stays behind
  await appendLogCtx(w, { kind: "add", text: `\`${id}\`${opts.note ? "" : ": missing `note`"}${ex.partial ? " (partial)" : ""}.`, sources: [id] }, now);
  return { id, duplicate: false, ex };
}
export const add = (root: string, input: string, opts: AddOpts) => addCtx(openWiki(root), input, opts);

/** Report line of a successful `add`, shared by `cortex add` and `cortex inbox`. */
export function formatAdd(r: Awaited<ReturnType<typeof add>>, dryRun?: boolean): string {
  if (r.duplicate || !r.ex) return `${paint.dim("=")} already present: ${r.id}`;
  return `${dryRun ? paint.accent("~ (dry-run)") : paint.ok("+")} ${paint.bold(r.id)}  [${r.ex.extractor}${r.ex.partial ? ", partial" : ""}] ${r.ex.content.split(/\s+/).length} words`;
}
