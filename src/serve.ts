import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { openWiki } from "./context";
import { exportSite, render } from "./export";
import { askSitePrompt, scopePrefix } from "./prompts";
import { search } from "./search";
import { refresh } from "./embed";
import { inbox } from "./inbox";
import { verifyPage } from "./verify";
import { commitAndPush, pullRebase } from "./sync";

/**
 * `cortex serve`: the exported site, plus `POST /api/verify` (a human marks a page reviewed from the site). With
 * `sync`, the wiki is a git checkout kept in step with its remote: pull before a write, commit and push after it,
 * and `POST /api/sync` (loopback only: the CI, after its own push) pulls and rebuilds. The site is rebuilt after
 * every change into the other of two folders, then swapped; requests keep the previous build meanwhile.
 * It also serves the phone share target under /share/ (scripts/share-server.ts): a share is written to `inbox/`
 * (a local, untracked folder), then `cortex inbox` turns it into a source and only `raw/` and `wiki/` are committed.
 * An entry that fails stays in `inbox/` and is retried at the next share, sync or start.
 */
export type ServeOpts = { port: number; sync: boolean; reviewer: string; say?: (m: string) => void; ask?: AskFn };
/** A site question → the agent's Markdown answer (injectable for tests). */
export type AskFn = (root: string, question: string) => Promise<string>;

/** The cheapest model of each SDK client, used when `site_ask.model` is not set. */
const CHEAP: Record<string, string> = { claude: "haiku", codex: "gpt-6-luna" };
const MAX_QUESTION = 500;

/**
 * `POST /api/ask`: the client's agent in read mode, on a cheap model, with the site search's hits (BM25 fused with the
 * embeddings when `embed` is on) given up front. Not `askCtx`: no tree hashing, and process.env stays untouched.
 */
export const agentAsk: AskFn = async (root, question) => {
  const cfg = await openWiki(root).config();
  const model = cfg.site_ask?.model ?? (cfg.client && CHEAP[cfg.client]) ?? cfg.model;
  // a question rarely has all its words in one page ("qu'est-ce que…"): then any of them, BM25 ranking the pages that have most
  const find = (any: boolean) => search(root, question, { in: "wiki", limit: 8, any }).catch(() => []);
  const all = await find(false);
  const hits = all.length ? all : await find(true);
  const prompt = scopePrefix(root, false, cfg.language) + askSitePrompt({ question, language: cfg.language, hits: hits.map((h) => `/${h.path} « ${h.title} »`) });
  const { backendFor } = await import("./backends");
  return (await backendFor(root, { ...cfg, model, effort: undefined })).run(root, prompt, "read");
};

export { commitAndPush, pullRebase };

/** Same origin only (behind the proxy the scheme may differ, the host does not); `Origin: null` is cross-origin. */
export function sameOrigin(h: Headers): boolean {
  const origin = h.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === (h.get("x-forwarded-host") ?? h.get("host")); } catch { return false; }
}

/** Commit message of an inbox run: the subject, then one line per source processed. */
export const inboxCommitMessage = (sources: string[]) =>
  `inbox: add sources from inbox${sources.length ? `\n\n${sources.map((s) => `- ${s}`).join("\n")}` : ""}`;

/** File of the export for a URL path: `x/` → x/index.html, `x` → x, x.html or x/index.html; never outside `dir`. */
export function fileFor(dir: string, pathname: string): string | undefined {
  let p: string;
  try { p = decodeURIComponent(pathname); } catch { return; }
  const base = resolve(dir), f = resolve(base, "." + p);
  if (f !== base && !f.startsWith(base + sep)) return;
  for (const c of [f, f + ".html", join(f, "index.html")]) if (existsSync(c) && statSync(c).isFile()) return c;
}

export async function serve(root: string, o: ServeOpts) {
  const say = o.say ?? console.log;
  const dirs = [join(root, ".cortex/serve/a"), join(root, ".cortex/serve/b")];
  let current: string | undefined, next = 0;
  // one change at a time (pull, write, commit, push): git and the files are shared
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(f: () => Promise<T> | T): Promise<T> => { const r = queue.then(f); queue = r.catch(() => {}); return r; };
  // rebuilds coalesce: changes made during a build are picked up by one more build
  let building: Promise<void> | undefined, dirty = false;
  const rebuild = (): Promise<void> => {
    dirty = true;
    return building ??= (async () => {
      try {
        while (dirty) {
          dirty = false;
          const out = dirs[next]!;
          // the page embeddings (embed in cortex.json): incremental, for the site's questions and the related pages; never blocks the build
          await refresh(root).catch((e) => say(`embeddings: ${(e as Error).message}`));
          rmSync(out, { recursive: true, force: true });
          try { await exportSite(root, out, () => {}); current = out; next = 1 - next; say(`site rebuilt (${out})`); }
          catch (e) { say(`export failed: ${(e as Error).message}`); }
        }
      } finally { building = undefined; }
    })();
  };
  const pull = () => o.sync && pullRebase(root);

  /** `cortex inbox`, then (sync) the new sources committed and pushed; the site rebuilt when something was added. */
  const ingest = () => serial(async () => {
    pull();
    const r = await inbox(root, {}, (m) => say(m.text));
    if (!r.ok) say("inbox: some entries failed, they stay in inbox/ for the next run");
    const changed = Bun.spawnSync(["git", "-C", root, "status", "--porcelain", "--", "raw", "wiki"]).stdout.toString().trim();
    if (!changed) return;
    if (o.sync) commitAndPush(root, inboxCommitMessage(r.sources), ["raw", "wiki"]);
    void rebuild();
  }).catch((e) => say(`inbox: ${(e as Error).message}`));
  const { route: shareRoute } = await import("../scripts/share-server");
  const deliver = async (files: { path: string; content: string }[]) => {
    mkdirSync(join(root, "inbox"), { recursive: true });
    for (const f of files) await Bun.write(join(root, f.path), f.content);
    void ingest(); // the phone gets its answer now; the source is fetched and committed in the background
  };

  pull();
  await rebuild();
  void ingest(); // entries left by a previous run
  if (!current) throw new Error("the first export failed: nothing to serve.");

  let asking = false; // ponytail: one question at a time for the whole server, a queue if several people use it
  const server = Bun.serve({
    port: o.port,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/api/verify") {
        if (req.method === "HEAD" || req.method === "GET") return new Response(null, { status: 204 }); // probe: the site shows its button
        if (req.method !== "POST") return new Response(null, { status: 405 });
        if (!sameOrigin(req.headers)) return Response.json({ error: "cross-origin request refused" }, { status: 403 });
        const id = await req.json().then((b: { id?: unknown }) => b?.id, () => undefined);
        if (typeof id !== "string" || !id) return Response.json({ error: "expected { id }" }, { status: 400 });
        try {
          const path = await serial(async () => {
            pull();
            const p = await verifyPage(openWiki(root), id, o.reviewer);
            if (o.sync) commitAndPush(root, `review: ${id} (human:${o.reviewer})`);
            return p;
          });
          void rebuild();
          say(`reviewed: ${path}`);
          return Response.json({ ok: true, path, by: `human:${o.reviewer}` });
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: /unknown page/.test((e as Error).message) ? 404 : 500 });
        }
      }
      if (url.pathname === "/api/ask") {
        // opt-in (the route spends tokens), and only through an SDK client: the agnostic CLI ignores the model and may keep its own tools
        const askCfg = await openWiki(root).config();
        if (!askCfg.site_ask || !askCfg.client) return new Response(null, { status: 404 });
        if (req.method === "HEAD" || req.method === "GET") return new Response(null, { status: 204 }); // probe: the site shows its ask button
        if (req.method !== "POST") return new Response(null, { status: 405 });
        // a browser always sends Origin on a POST fetch: no Origin is a script, not the site
        if (!req.headers.get("origin") || !sameOrigin(req.headers)) return Response.json({ error: "cross-origin request refused" }, { status: 403 });
        const q = await req.json().then((b: { q?: unknown }) => b?.q, () => undefined);
        if (typeof q !== "string" || !q.trim() || q.length > MAX_QUESTION) return Response.json({ error: `expected { q } (1 to ${MAX_QUESTION} characters)` }, { status: 400 });
        if (asking) return Response.json({ error: "a question is already being answered" }, { status: 429 });
        asking = true;
        srv.timeout(req, 0); // an agent answer outlasts Bun's 10 s idle timeout
        try {
          const md = await (o.ask ?? agentAsk)(root, q.trim());
          const pages = new Set((await openWiki(root).pages()).map((p) => p.path));
          return Response.json({ html: render(md, "search/", pages).html }); // sanitized, /wiki/x.md links made relative to /search/
        } catch (e) {
          say(`ask: ${(e as Error).message}`);
          return Response.json({ error: (e as Error).message }, { status: 500 });
        } finally { asking = false; }
      }
      if (url.pathname === "/share" || url.pathname.startsWith("/share/")) return shareRoute(req, deliver);
      if (url.pathname === "/api/sync" && req.method === "POST") {
        const ip = srv.requestIP(req)?.address ?? "";
        // the CI's direct call only: a request through the reverse proxy (same host, so loopback too) carries x-forwarded-*
        if (!/^(127\.|::1$|::ffff:127\.)/.test(ip) || req.headers.has("x-forwarded-for") || req.headers.has("x-forwarded-host")) return new Response(null, { status: 403 });
        try { await serial(pull); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
        void rebuild();
        void ingest();
        return Response.json({ ok: true });
      }
      if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405 });
      const f = fileFor(current!, url.pathname);
      if (f) return new Response(Bun.file(f));
      const nf = join(current!, "404.html");
      return new Response(existsSync(nf) ? Bun.file(nf) : "Not found", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
    },
  });
  say(`cortex serve: http://localhost:${server.port}${o.sync ? " (sync: pull before, commit and push after each review)" : ""}`);
  return server;
}
