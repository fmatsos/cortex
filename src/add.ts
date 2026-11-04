import { join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { localIso, normUrl, readDocs, serializeDoc, sha256 } from "./lib";
import { free, naming, rawIdTaken } from "./naming";
import { expand } from "./template";
import { appendLog } from "./log";
import { paint } from "./style";

const UA = "Mozilla/5.0 (X11; Linux x86_64) cortex-cli/0.1";
/** Cap on any fetched body (HTML and PDF), checked on content-length and while streaming. */
export const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

export type Extract = {
  title: string; content: string; kind: string; extractor: string;
  url?: string; author?: string; published?: string; partial?: string; blob?: Uint8Array; blobExt?: string;
};

/** `publicOnly`: MCP path, refuses loopback/private/link-local targets (the CLI stays permissive). `maxBytes`: body cap, injectable for tests. */
export type FetchOpts = { publicOnly?: boolean; maxBytes?: number };

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
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`Schéma refusé : ${u.protocol} (http(s) uniquement).`);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addrs.some(privateIp)) throw new Error(`Adresse refusée : ${host} pointe vers un réseau local ou privé (accès MCP limité aux adresses publiques).`);
}

/** Body read as a stream, aborted past `max` (a bare `res.text()` would load a multi-GB response in memory). */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const tooBig = () => new Error(`Réponse trop volumineuse (> ${Math.round(max / 1024 / 1024)} Mo) : rien n'est écrit.`);
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
  const signal = AbortSignal.timeout(30_000);
  let cur = url;
  for (let hop = 0; ; hop++) {
    if (o.publicOnly) await assertPublic(cur);
    const res = await fetch(cur, { headers: { "user-agent": UA, "accept-language": "fr,en;q=0.8" }, signal, redirect: o.publicOnly ? "manual" : "follow" });
    const next = res.headers.get("location");
    if (o.publicOnly && res.status >= 300 && res.status < 400 && next) {
      await res.body?.cancel();
      if (hop >= MAX_REDIRECTS) throw new Error(`Trop de redirections (> ${MAX_REDIRECTS}) sur ${url}.`);
      cur = new URL(next, cur).href;
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url} (paywall, blocage anti-bot ?) : rien n'est écrit.`);
    return { res, bytes: await readCapped(res, o.maxBytes ?? MAX_BODY_BYTES), url: o.publicOnly ? cur : res.url };
  }
}

/**
 * Web page → Markdown. defuddle first; Readability + Turndown in parallel, kept if clearly longer
 * (defuddle sometimes truncates without warning, cf. OKF at step 0).
 */
export async function extractUrl(url: string, opts: FetchOpts = {}): Promise<Extract> {
  const { res, bytes, url: finalUrl } = await fetchCapped(url, opts);
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("pdf")) return extractPdf(bytes, url);
  const html = new TextDecoder().decode(bytes);
  const d = await Defuddle(parseHTML(html).document, url, { markdown: true });
  const doc = parseHTML(html).document; // second DOM on purpose: Readability mutates its input (REL-26: a clone is not clearly cheaper)
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href");
  const r = new Readability(doc as any).parse(); // mutates doc: canonical read beforehand
  const rb = r?.content ? new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" }).turndown(r.content) : "";
  const [wd, wr] = [words(d.content ?? ""), words(rb)];
  // ponytail: threshold 1.3 calibrated on the 21 sources of step 0; to revisit if false positives appear
  const useRb = wr > wd * 1.3;
  const content = useRb ? rb : d.content ?? "";
  if (words(content) < 50) throw new Error(`Corps quasi vide (${words(content)} mots) sur ${url} : blocage anti-bot ? Rien n'est écrit.`);
  // verified markers: Next (« Il reste 69 % de l'article »), Substack (« This post is for paid subscribers »)
  const paywall = /Il reste \d+ ?% de l.article|This post is for paid subscribers/i.test(html);
  return {
    title: d.title || r?.title || url, content, kind: "article",
    url: canonical ? new URL(canonical, finalUrl).href : finalUrl,
    author: [d.author, r?.byline].find((a) => a && !/^\d+$/.test(a)) ?? undefined /* gist: defuddle returns a numeric id */, published: d.published || undefined,
    extractor: useRb ? "readability/0.6+turndown" : "defuddle/0.19.6+linkedom",
    partial: paywall ? "paywall : contenu partiel" : undefined,
  };
}

export async function extractPdf(bytes: Uint8Array, url?: string, name = "document"): Promise<Extract> {
  const p = Bun.spawn(["pdftotext", "-layout", "-", "-"], { stdin: bytes, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) throw new Error(`pdftotext a échoué : ${await new Response(p.stderr).text()}`);
  if (words(out) < 20) throw new Error("PDF sans texte (scanné ?) : à faire décrire par l'agent, pas encore géré.");
  const title = out.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 120) ?? name;
  return { title, content: out, kind: "pdf", url, extractor: "pdftotext", blob: bytes, blobExt: "pdf" };
}

export function extractText(txt: string, name?: string): Extract {
  const h1 = txt.match(/^#\s+(.+)$/m)?.[1];
  return { title: h1 ?? name ?? txt.trim().split("\n")[0].slice(0, 80), content: txt, kind: "note", extractor: "manual" };
}

/** Source already present (one of the normalized URLs or same fingerprint) → its id, otherwise undefined. */
export async function findDuplicate(root: string, urls: (string | undefined)[], hash?: string): Promise<string | undefined> {
  const u = new Set(urls.filter(Boolean).map((x) => normUrl(x!)));
  for (const d of (await readDocs(root, "raw")).docs) {
    if ((hash && d.fm.sha256 === hash) || (d.fm.url && u.has(normUrl(String(d.fm.url))))) return d.path.split("/").at(-2);
  }
}

export async function add(root: string, input: string, opts: { note?: string; dryRun?: boolean; now?: Date; text?: string } & FetchOpts): Promise<{ id: string; duplicate: boolean; ex?: Extract }> {
  const now = opts.now ?? new Date();
  let ex: Extract;
  const isUrl = /^https?:\/\//.test(input);
  if (isUrl) {
    const known = await findDuplicate(root, [input]); // before the fetch: no needless request
    if (known) return { id: known, duplicate: true };
    ex = await extractUrl(input, opts);
  }
  else if (input === "-") ex = extractText(opts.text ?? await Bun.stdin.text()); // text: content supplied without stdin (MCP server)
  else {
    const f = Bun.file(input);
    if (!(await f.exists())) throw new Error(`Fichier introuvable : ${input}`);
    const name = input.split("/").at(-1)!.replace(/\.[^.]+$/, "");
    ex = /\.pdf$/i.test(input) ? await extractPdf(new Uint8Array(await f.arrayBuffer()), undefined, name)
      : /\.(md|markdown|txt)$/i.test(input) ? extractText(await f.text(), name)
      : (() => { throw new Error(`Format non géré à l'étape 1 : ${input} (URL, .md, .txt, .pdf)`); })();
  }
  const hash = sha256(ex.content);
  const dup = await findDuplicate(root, [isUrl ? input : undefined, ex.url], hash);
  if (dup) return { id: dup, duplicate: true, ex };

  const iso = localIso(now);
  // folder according to raw_path (config.json); its last segment is the id, unique under raw/
  const rel = free(expand((await naming(root)).raw_path, { at: now, title: ex.title, kind: ex.kind }), (p) => rawIdTaken(root, p.split("/").at(-1)!) || existsSync(join(root, "raw", p)));
  const id = rel.split("/").at(-1)!;
  if (opts.dryRun) return { id, duplicate: false, ex };

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

  const dir = join(root, "raw", rel);
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, "source.md"), serializeDoc(fm, `${ex.content.trim()}\n`));
  await appendLog(root, { kind: "add", text: `\`${id}\`${opts.note ? "" : " : `note` manquante"}${ex.partial ? " (partiel)" : ""}.`, sources: [id] }, now);
  return { id, duplicate: false, ex };
}

/** Report line of a successful `add`, shared by `cortex add` and `cortex inbox`. */
export function describe(r: Awaited<ReturnType<typeof add>>, dryRun?: boolean): string {
  if (r.duplicate || !r.ex) return `${paint.dim("=")} déjà présent : ${r.id}`;
  return `${dryRun ? paint.accent("~ (dry-run)") : paint.ok("+")} ${paint.bold(r.id)}  [${r.ex.extractor}${r.ex.partial ? ", partiel" : ""}] ${r.ex.content.split(/\s+/).length} mots`;
}
