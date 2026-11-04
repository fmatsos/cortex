import { join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { localIso, normUrl, readDocs, sha256 } from "./lib";
import { expand, free, naming, rawIdTaken } from "./naming";
import { appendLog } from "./log";

const UA = "Mozilla/5.0 (X11; Linux x86_64) cortex-cli/0.1";
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

export type Extract = {
  title: string; content: string; kind: string; extractor: string;
  url?: string; author?: string; published?: string; partial?: string; blob?: Uint8Array; blobExt?: string;
};

/**
 * Web page → Markdown. defuddle first; Readability + Turndown in parallel, kept if clearly longer
 * (defuddle sometimes truncates without warning, cf. OKF at step 0).
 */
export async function extractUrl(url: string): Promise<Extract> {
  const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "fr,en;q=0.8" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url} (paywall, blocage anti-bot ?) : rien n'est écrit.`);
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("pdf")) return extractPdf(new Uint8Array(await res.arrayBuffer()), url);
  const html = await res.text();
  const d = await Defuddle(parseHTML(html).document, url, { markdown: true });
  const doc = parseHTML(html).document;
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
    url: canonical ? new URL(canonical, res.url).href : res.url,
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
  for (const d of await readDocs(root, "raw")) {
    if ((hash && d.fm.sha256 === hash) || (d.fm.url && u.has(normUrl(String(d.fm.url))))) return d.path.split("/").at(-2);
  }
}

export async function add(root: string, input: string, opts: { note?: string; dryRun?: boolean; now?: Date; text?: string }): Promise<{ id: string; duplicate: boolean; ex?: Extract }> {
  const now = opts.now ?? new Date();
  let ex: Extract;
  const isUrl = /^https?:\/\//.test(input);
  if (isUrl) {
    const known = await findDuplicate(root, [input]); // before the fetch: no needless request
    if (known) return { id: known, duplicate: true };
    ex = await extractUrl(input);
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
  await Bun.write(join(dir, "source.md"), `---\n${Bun.YAML.stringify(fm, null, 2)}\n---\n${ex.content.trim()}\n`);
  await appendLog(root, { kind: "add", text: `\`${id}\`${opts.note ? "" : " : `note` manquante"}${ex.partial ? " (partiel)" : ""}.`, sources: [id] }, now);
  return { id, duplicate: false, ex };
}

/** Report line of a successful `add`, shared by `cortex add` and `cortex inbox`. */
export function describe(r: Awaited<ReturnType<typeof add>>, dryRun?: boolean): string {
  if (r.duplicate || !r.ex) return `= déjà présent : ${r.id}`;
  return `${dryRun ? "~ (dry-run)" : "+"} ${r.id}  [${r.ex.extractor}${r.ex.partial ? ", partiel" : ""}] ${r.ex.content.split(/\s+/).length} mots`;
}
