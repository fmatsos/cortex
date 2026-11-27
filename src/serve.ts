import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { Server, Subprocess } from "bun";
import { openWiki } from "./context";
import { answerSegments, blockRegistry, draftMarkdown } from "./answer-blocks";
import { EXTRA_TOOLS, type Stream } from "./backends/backend";
import { pageId } from "./doc";
import type { Config } from "./config";
import { askSitePrompt, askSiteSystem, scopePrefix } from "./prompts";
import { historyPart, pagesPart, relevantPages, wikiTools, type Core, type Turn } from "./ask-site";
import { LIMITS } from "./limits";
import { search } from "./search";
import { searchSite } from "./search-api";
import { refresh } from "./embed";
import { searchInfo } from "./search-index";
import { inbox } from "./inbox";
import { verifyPage } from "./verify";
import { commitAndPush, pullRebase } from "./sync";
import { accountRoute } from "./account-api";
import { addSpaceMember, forgetSpace, getSpace, memberRole, ownsASpace, setSpace, spaceVisibility, type User } from "./accounts";
import { configFile, loadConfig, readConfig, writeConfig } from "./config";
import { isMultiSpace, listSpaces, spaceRoot, SPACE_NAME } from "./lib";
import { addSpace } from "./space";

/**
 * `cortex serve`: the exported site, plus `POST /api/verify` (a human marks a page reviewed from the site). With
 * `sync`, the wiki is a git checkout kept in step with its remote: pull before a write, commit and push after it,
 * and `POST /api/sync` (loopback only: the CI, after its own push) pulls and rebuilds. The site is rebuilt after
 * every change into the other of two folders, then swapped; requests keep the previous build meanwhile. The build (Vite and the
 * prerender: seconds of CPU) runs in a child `cortex export`, never in this process, so the server stays responsive; a complete
 * build left by a previous run is served at once on start (`.cortex/serve/<a|b>.done` marks it complete), the rebuild follows.
 * It also serves the phone share target under /share/ (scripts/share-server.ts): a share is written to `inbox/`
 * (a local, untracked folder), then `cortex inbox` turns it into a source and only `raw/` and `wiki/` are committed.
 * An entry that fails stays in `inbox/` and is retried at the next share, sync or start.
 * `GET /api/search`: the hybrid search with the site's operators, and with `judge=1` the judge's ranking (src/search-api.ts).
 * `GET /api/status`: is the site being rebuilt (a build running or waiting), and how the last one ended; the site shows a small indicator.
 * User accounts (`auth` in cortex.json, src/account-api.ts): `/api/auth/*`, `/api/me*`, `/api/conversations*`, `/api/journeys*`,
 * stored in `.cortex/accounts.db`. The exported site (`cortex export`) has none of these routes and works without them.
 */
export type ServeOpts = {
  port: number; sync: boolean; reviewer: string; say?: (m: string) => void; ask?: AskFn;
  /** The command that exports the site into `out` (a child process; exit 0 = the site is complete). Default: this very cortex, `export --out`. */
  exportCmd?: (root: string, out: string) => string[];
  /** Quiet time before a rebuild starts, so the requests of one burst (sync, inbox, review) share one build. Default 300 ms. */
  settleMs?: number;
  /** The page embeddings' refresh (injectable for tests). Default: embed.ts. */
  embeddings?: (root: string) => Promise<{ embedded: number; removed: number } | undefined>;
};
/** `draft`: set by the agent that prepares display blocks, so the live draft can draw them (the text so far in, Markdown with the blocks out). `log`: the service journal. */
export type AskStream = Stream & { draft?: (md: string) => string; log?: (m: string) => void };
/** A site question and the earlier turns → the agent's Markdown answer, and the pages it rests on when a judge chose them (injectable for tests). */
export type AskFn = (root: string, question: string, history: Turn[], stream?: AskStream) => Promise<{ md: string; core?: Core }>;

/** The cheapest model of each SDK client, used when `site_ask.model` is not set. */
const CHEAP: Record<string, string> = { claude: "haiku", codex: "gpt-6-luna" };
/** Earlier exchanges sent per client, for one whose provider defines a turn limit; the others get 10 (`site_ask.history_turns` wins). */
export const HISTORY_TURNS: Record<string, number> = {};
/** Exchanges (a question and its answer) of the conversation sent with each question: `site_ask.history_turns`, else the client's, else 10. */
export const askHistoryTurns = (cfg: Config) => cfg.site_ask?.history_turns ?? HISTORY_TURNS[askClient(cfg) ?? ""] ?? 10;
/** The client that answers the site's questions: `site_ask.client`, else the global one. */
export const askClient = (cfg: Config) => cfg.site_ask?.client ?? cfg.client;
/** The model that answers the site's questions (also shown on the site, next to the answer); the global one only for the global client. */
export const askModel = (cfg: Config) => {
  const client = askClient(cfg);
  return cfg.site_ask?.model ?? (client && CHEAP[client]) ?? (client === cfg.client ? cfg.model : undefined);
};

/**
 * Backend settings of the site's questions: site_ask's client, model and effort over the global ones (the global effort is
 * for compiling: not sent). The server: `site_ask.base_url`, else $CORTEX_ASK_BASE_URL, else the openai client's. Secret:
 * environment only, as $OPENAI_API_KEY: $CORTEX_ASK_API_KEY only goes to $CORTEX_ASK_BASE_URL (or a site_ask.base_url equal
 * to it), never to a URL only cortex.json names, since a cloned wiki could point it at any host.
 */
export function askSetup(cfg: Config): { cfg: Config & { temperature?: number }; ep?: { url: string; key?: string } } {
  const own = cfg.site_ask?.base_url, envUrl = process.env.CORTEX_ASK_BASE_URL, named = own ?? envUrl;
  const ep = named ? { url: named.replace(/\/+$/, ""), key: !own || own === envUrl ? process.env.CORTEX_ASK_API_KEY : undefined } : undefined;
  return { cfg: { ...cfg, client: askClient(cfg), model: askModel(cfg), effort: cfg.site_ask?.effort ?? undefined, temperature: cfg.site_ask?.temperature ?? undefined }, ep };
}

/**
 * The answer as the site shows it: segments of sanitized HTML (wiki links relative to the site root, which the assistant
 * resolves wherever it is open) and display blocks (answer-blocks.ts), and the ids of the wiki pages it cites, for the site
 * to list them with their real status: the trust signals never depend on what the model chose to write. `titles`: path → title.
 */
export function askAnswer(md: string, titles: Map<string, string>) {
  const cited = [...new Set([...md.matchAll(/\]\(\/?(wiki\/[^)\s#]+\.md)/g)].map((m) => m[1]).filter((p) => titles.has(p)))].map(pageId);
  return { segments: answerSegments(md, titles), cited };
}
/**
 * What the agent is doing, as the site words it (structured, never free text from the model): a tool about to run, or "pages"
 * (choosing the pages). `titles`: wiki path → title. The path is read as the `get` tool does: relative to the root even with a
 * leading "/" (the prompt lists "/wiki/x.md"). `related` is only "work".
 */
export function stepOf(name: string, args: Record<string, unknown>, titles: Map<string, string>) {
  if (name === "pages") return { kind: "pages" };
  if (name === "render_blocks") return { kind: "layout" };
  const arg = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  if (name === "search") return { kind: "search", query: arg("q").slice(0, 60) };
  const path = arg("path").trim().replace(/^\.?\/+/, "");
  if (name === "get" && /^wiki\/.+\.md$/.test(path)) return { kind: "read", path, title: titles.get(path) };
  return { kind: "work" };
}
const MAX_QUESTION = 500;
/** An earlier answer comes back as the site received it: long, but bounded (ask-site.ts cuts it again for the prompt). */
const MAX_TURN = 40_000;

/** The earlier turns the site sent (the last `exchanges` of them), the malformed ones dropped. */
export function turnsOf(value: unknown, exchanges: number): Turn[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-2 * exchanges).flatMap((t) => {
    const { role, text } = (t ?? {}) as Record<string, unknown>;
    return (role === "user" || role === "assistant") && typeof text === "string" && text.trim() ? [{ role, text: text.slice(0, MAX_TURN) }] : [];
  });
}

/**
 * `POST /api/ask`: the client's agent in read mode, on a cheap model. With a judge, the pages it retained for the question
 * are given in full (ask-site.ts); without one, the site search's hits (BM25 fused with the embeddings when `embed` is on).
 * Not `askCtx`: no tree hashing, and process.env stays untouched.
 */
export const agentAsk: AskFn = async (root, question, history, stream) => {
  stream?.step?.("pages", {});
  const cfg = await openWiki(root).config();
  const core = await relevantPages(root, question, history);
  stream?.signal?.throwIfAborted(); // the reader left while the pages were judged: the agent never starts
  let hits: string[] = [];
  if (!core) {
    // a question rarely has all its words in one page ("qu'est-ce que…"): then any of them, BM25 ranking the pages that have most
    const find = (any: boolean) => search(root, question, { in: "wiki", limit: 8, any }).catch(() => []);
    const all = await find(false);
    hits = (all.length ? all : await find(true)).map((h) => `/${h.path} « ${h.title} »`);
  }
  const ask = askSetup(cfg);
  // the wiki tools and the display blocks go through the run's own tools: only the clients that take them (the others answer in plain Markdown)
  const titles = new Map((await openWiki(root).pages()).map((p) => [p.path, String(p.fm.title ?? p.path)]));
  const blocks = EXTRA_TOOLS.has(ask.cfg.client ?? "") ? blockRegistry({ titles, log: stream?.log }) : undefined;
  const prompt = scopePrefix(root, false, cfg.language) + askSitePrompt({ question, language: cfg.language, pages: pagesPart(core, hits), history: historyPart(history, askHistoryTurns(cfg)), blocks: !!blocks });
  const { backendFor } = await import("./backends");
  if (blocks && stream) stream.draft = blocks.draft; // the live draft draws the blocks the agent prepared, where the text names them
  const md = await (await backendFor(root, ask.cfg, ask.ep)).run(root, prompt, "read", undefined, undefined, blocks && [...wikiTools(root), blocks.tool], { ...stream, onlyExtra: true, system: askSiteSystem(cfg.language), toolRounds: LIMITS.askToolRounds, blocksReady: blocks?.ready });
  return { md: blocks ? blocks.assemble(md) : md, core };
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

/**
 * A build folder is complete once its marker exists: `<dir>.done`, a sibling (never served), written by `serve` after the export
 * child exited with 0 and removed before the folder is emptied for the next build. A folder without it (a build running, killed or
 * failed) is never served.
 */
export const markerOf = (dir: string) => `${dir}.done`;
export function markComplete(dir: string) {
  const tmp = `${markerOf(dir)}.tmp`;
  writeFileSync(tmp, JSON.stringify({ at: new Date().toISOString() }));
  renameSync(tmp, markerOf(dir)); // atomic: the marker is whole or absent
}
/** When a complete build ended (ms since the epoch), undefined when the folder is not a complete one. */
export function completedAt(dir: string): number | undefined {
  try {
    const at = Date.parse(JSON.parse(readFileSync(markerOf(dir), "utf8")).at);
    return Number.isFinite(at) && existsSync(join(dir, "index.html")) ? at : undefined;
  } catch { return undefined; }
}

/** The export children running now: killed when this process stops, so none keeps `site/.export.lock` or writes into a folder of the next run. */
const children = new Set<Subprocess>();
let hooked = false;
function hookExit() {
  if (hooked) return;
  hooked = true;
  process.on("exit", () => children.forEach((c) => c.kill()));
  for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) process.once(sig, () => process.exit(code));
}
/** Longest an export may take before it is killed (a stuck build must not hold the single build slot for ever). */
const EXPORT_TIMEOUT_MS = 15 * 60_000;

/** The child that exports the site: the cortex running this code (the sources, or the sources a binary unpacked; `BUN_BE_BUN` is inherited in the latter). */
export const exportArgv = (_root: string, out: string) => [process.execPath, join(import.meta.dir, "cortex.ts"), "export", "--out", out];

/** Runs `argv` with `root` as the wiki; resolves on exit 0, rejects with the end of its output otherwise (or when it is killed). */
async function runChild(root: string, argv: string[], onStart: (c: Subprocess) => void, env: Record<string, string> = {}): Promise<void> {
  hookExit();
  const child = Bun.spawn(argv, { env: { ...process.env, ...env, CORTEX_ROOT: root }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: EXPORT_TIMEOUT_MS });
  children.add(child); onStart(child);
  try {
    const [out, err, code] = await Promise.all([new Response(child.stdout as ReadableStream).text(), new Response(child.stderr as ReadableStream).text(), child.exited]);
    if (code === 0) return;
    const tail = `${err}\n${out}`.trim().split("\n").slice(-6).join("\n");
    throw new Error(`export exited with ${child.signalCode ?? `code ${code}`}${tail ? `:\n${tail}` : ""}`);
  } finally { children.delete(child); }
}

/** What the sites of one server share: the git queue, and the guards of the routes that cost (a model call). */
type Shared = { say: (m: string) => void; serial: <T>(f: () => Promise<T> | T) => Promise<T>; busy: { asking: boolean; judging: boolean } };
/** One space's site and APIs, as `serve` mounts it: `fetch` gets the URL with the space's prefix already stripped. */
type Site = {
  fetch(req: Request, srv: Server<undefined>, url: URL): Promise<Response>;
  /** Serves the build of a previous run at once (and rebuilds in the background), or awaits the first build. Returns when the previous build ended, if any. */
  start(): Promise<number | undefined>;
  /** What `POST /api/sync` does: pull, then rebuild and take in the inbox (both queued, not awaited). */
  sync(): Promise<void>;
  stop(): void;
};

/** `base`: where the site is mounted (`/s/<space>` in a multi-space instance, "" otherwise), the export's `CORTEX_SITE_BASE`. */
async function makeSite(root: string, o: ServeOpts, { say, serial, busy }: Shared, base = ""): Promise<Site> {
  const dirs = [join(root, ".cortex/serve/a"), join(root, ".cortex/serve/b")];
  const settleMs = o.settleMs ?? 300, exportCmd = o.exportCmd ?? exportArgv, embeddings = o.embeddings ?? refresh;
  // the newest complete build of a previous run is served at once; the other folder is where the next build goes
  const done = dirs.map((d) => completedAt(d)), previous = done[0] === undefined && done[1] === undefined ? undefined : (done[1] ?? -1) > (done[0] ?? -1) ? 1 : 0;
  let current: string | undefined = previous === undefined ? undefined : dirs[previous], next = previous === undefined ? 0 : 1 - previous;

  // Rebuilds: one build at a time, in a child process, and one slot of waiting. A request made while a build runs, or while the
  // quiet time before it lasts, joins the next build: any number of requests give one build, plus one if they came during it.
  // Callers do not wait (`void rebuild()`): a response means "accepted", the site is swapped in once the build ends.
  let building: Promise<void> | undefined, dirty = false, requests = 0, stopped = false, exporter: Subprocess | undefined;
  // what `GET /api/status` tells: since when the site has been busy (a build running or waiting: `building` is set), and how the last build ended
  let since: number | undefined, last: { at: string; ok: boolean; ms: number } | undefined;
  const asked = (n: number) => (n === 1 ? "1 request" : `${n} requests merged into one build`);
  const rebuild = (now = false): Promise<void> => {
    dirty = true; requests++;
    if (!building) since = Date.now();
    return building ??= (async () => {
      try {
        for (let first = true; dirty && !stopped; first = false) {
          if (!(now && first)) await Bun.sleep(settleMs);
          if (stopped) break;
          dirty = false;
          const out = dirs[next]!, n = requests, t0 = performance.now(), took = () => `${((performance.now() - t0) / 1000).toFixed(1)} s`;
          requests = 0;
          rmSync(markerOf(out), { force: true }); // first: a folder being emptied is never taken for a complete one
          await rm(out, { recursive: true, force: true });
          try {
            await runChild(root, exportCmd(root, out), (c) => (exporter = c), base ? { CORTEX_SITE_BASE: base } : {});
            if (!existsSync(join(out, "index.html"))) throw new Error("the export wrote no index.html");
            markComplete(out);
            current = out; next = 1 - next;
            last = { at: new Date().toISOString(), ok: true, ms: Math.round(performance.now() - t0) }; // with the swap: "not building" is only seen once the new site is served
            say(`site rebuilt in ${took()} (${out}), ${asked(n)}`);
            void reindex(); // after the swap: the site never waits for the embeddings
          } catch (e) {
            if (!stopped) {
              last = { at: new Date().toISOString(), ok: false, ms: Math.round(performance.now() - t0) };
              say(`export failed after ${took()}, the previous site stays (${asked(n)}): ${(e as Error).message}`);
            }
          }
          finally { exporter = undefined; }
        }
      } finally { building = undefined; since = undefined; }
    })();
  };

  // the page embeddings (embed in cortex.json): incremental, for the site's questions and the related pages. Its own slot, apart from
  // the build: a first index of a large wiki takes minutes and delays neither the swap nor the next build. Failure: a line, nothing else.
  let indexing: Promise<void> | undefined, indexDirty = false;
  const reindex = (): Promise<void> => {
    indexDirty = true;
    return indexing ??= (async () => {
      try {
        while (indexDirty && !stopped) {
          indexDirty = false;
          const t0 = performance.now();
          try {
            const r = await embeddings(root);
            if (r && (r.embedded || r.removed)) say(`embeddings: ${r.embedded} embedded, ${r.removed} page(s) removed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
          } catch (e) { say(`embeddings: ${(e as Error).message}`); }
        }
      } finally { indexing = undefined; }
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

  const site: Site = {
    async start() {
      if (!current) { // no complete build: the first one is awaited, as nothing can be served before it
        pull();
        await rebuild(true);
        if (!current) throw new Error("the first export failed: nothing to serve.");
        void ingest(); // entries left by a previous run
      }
      if (previous !== undefined) {
        // started on a previous build: what changed since (the remote, the inbox, the binary itself) is picked up in the background
        void serial(pull).catch((e) => say(`pull: ${(e as Error).message}`)).then(() => { void rebuild(true); void ingest(); });
      }
      return previous === undefined ? undefined : done[previous];
    },
    async sync() { await serial(pull); void rebuild(); void ingest(); },
    // stopping the server stops the export child too (it holds site/.export.lock)
    stop() { stopped = true; exporter?.kill(); },
    async fetch(req, srv, url) {
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
      if (url.pathname === "/api/status") {
        // is the site being rebuilt: the state of the build queue, read-only, no account. Polled by the site, so never cached
        const headers = { "cache-control": "no-store" };
        if (req.method === "HEAD") return new Response(null, { status: 204, headers }); // probe
        if (req.method !== "GET") return new Response(null, { status: 405, headers });
        const isBuilding = building !== undefined; // a build, or the quiet time before it, or one more build waiting behind it
        return Response.json({ building: isBuilding, ...(isBuilding && since !== undefined && { since: new Date(since).toISOString() }), ...(last && { last }) }, { headers });
      }
      if (url.pathname === "/api/search") {
        // the hybrid search with the site's operators; `judge=1` also ranks the hits with the judge (search-api.ts). Always on in serve: reading, no account
        const headers = { "cache-control": "no-store" };
        if (req.method === "HEAD") return new Response(null, { status: 204, headers }); // probe: the site offers the search by meaning
        if (req.method !== "GET") return new Response(null, { status: 405, headers });
        const judge = ["1", "true"].includes(url.searchParams.get("judge") ?? "");
        // the judge spends tokens: a page of another site must not start it (the answer stays unreadable to it, the cost does not)
        if (judge && (req.headers.get("sec-fetch-site") === "cross-site" || !sameOrigin(req.headers))) return Response.json({ error: "cross-origin request refused" }, { status: 403, headers });
        if (judge) srv.timeout(req, 0); // up to `judge.search_candidates` calls outlast Bun's 10 s idle timeout
        try {
          const r = await searchSite(root, url.searchParams.get("q") ?? "", {
            limit: Number(url.searchParams.get("limit")), judge,
            lock: () => { if (busy.judging) return; busy.judging = true; return () => { busy.judging = false; }; },
          });
          return Response.json(r.body, { status: r.status, headers });
        } catch (e) {
          say(`search: ${(e as Error).message}`);
          return Response.json({ error: (e as Error).message }, { status: 500, headers });
        }
      }
      if (url.pathname === "/api/ask/render") {
        // the answers of a saved conversation drawn again as the site shows them (no model involved): the panel resumes it
        const askCfg = await openWiki(root).config();
        if (!askCfg.site_ask || !askClient(askCfg)) return new Response(null, { status: 404 });
        if (req.method !== "POST") return new Response(null, { status: 405 });
        if (!req.headers.get("origin") || !sameOrigin(req.headers)) return Response.json({ error: "cross-origin request refused" }, { status: 403 });
        const body = await req.json().then((b: { answers?: unknown }) => b ?? {}, () => ({} as { answers?: unknown }));
        const answers = body.answers;
        if (!Array.isArray(answers) || answers.length > 200 || answers.some((a) => typeof a !== "string") || answers.reduce((n: number, a: string) => n + a.length, 0) > 1_000_000) {
          return Response.json({ error: "expected { answers } (up to 200 Markdown answers, 1,000,000 characters in all)" }, { status: 400 });
        }
        const titles = new Map((await openWiki(root).pages()).map((p) => [p.path, String(p.fm.title ?? p.path)]));
        return Response.json({ answers: (answers as string[]).map((md) => askAnswer(md, titles)) });
      }
      if (url.pathname === "/api/ask") {
        // opt-in (the route spends tokens), and only through an SDK client: the agnostic CLI ignores the model and may keep its own tools
        const askCfg = await openWiki(root).config();
        if (!askCfg.site_ask || !askClient(askCfg)) return new Response(null, { status: 404 });
        if (req.method === "HEAD" || req.method === "GET") return new Response(null, { status: 204, headers: { "x-ask-history-turns": String(askHistoryTurns(askCfg)) } }); // probe: the site shows its ask button, and the depth of the history
        if (req.method !== "POST") return new Response(null, { status: 405 });
        // a browser always sends Origin on a POST fetch: no Origin is a script, not the site
        if (!req.headers.get("origin") || !sameOrigin(req.headers)) return Response.json({ error: "cross-origin request refused" }, { status: 403 });
        const body = await req.json().then((b: { q?: unknown; history?: unknown }) => b ?? {}, () => ({} as { q?: unknown; history?: unknown }));
        const q = body.q;
        if (typeof q !== "string" || !q.trim() || q.length > MAX_QUESTION) return Response.json({ error: `expected { q } (1 to ${MAX_QUESTION} characters)` }, { status: 400 });
        if (busy.asking) return Response.json({ error: "a question is already being answered" }, { status: 429 });
        busy.asking = true;
        srv.timeout(req, 0); // an agent answer outlasts Bun's 10 s idle timeout
        const answer = async (stream?: AskStream) => {
          const { md, core } = await (o.ask ?? agentAsk)(root, q.trim(), turnsOf(body.history, askHistoryTurns(askCfg)), stream);
          const titles = new Map((await openWiki(root).pages()).map((p) => [p.path, String(p.fm.title ?? p.path)]));
          // the pages under the answer: retained and related are chosen by code (the judge), never by what the model wrote
          const ids = (refs?: { id: string }[]) => refs?.map((r) => r.id) ?? [];
          return { ...askAnswer(md, titles), md, retained: ids(core?.retained), related: ids(core?.related), model: askModel(askCfg) ?? askClient(askCfg) };
        };
        // the site reads the answer as it is written: one JSON event per line (step, delta, draft, reset, then done with the payload below, or error)
        if (req.headers.get("accept")?.includes("application/x-ndjson")) {
          const enc = new TextEncoder();
          const known = new Map((await openWiki(root).pages()).map((p) => [p.path, String(p.fm.title ?? p.path)]));
          let ctrl: ReadableStreamDefaultController<Uint8Array>;
          const left = new AbortController(); // the client left: the run stops (it would be paid for nobody) and frees the lock as it settles
          const send = (e: object) => { if (!left.signal.aborted) try { ctrl.enqueue(enc.encode(`${JSON.stringify(e)}\n`)); } catch { /* the client is gone */ } };
          // the text so far, drawn as the final answer is (same renderer, so already sanitized), at most every 200 ms and always the last state
          let draft = "", timer: ReturnType<typeof setTimeout> | undefined;
          const flush = () => { timer = undefined; try { send({ t: "draft", segments: answerSegments(live.draft?.(draft) ?? draftMarkdown(draft), known, true) }); } catch { /* half-written Markdown: the next draft will do */ } };
          const live: AskStream = {
            text: (text) => { draft += text; send({ t: "delta", text }); timer ??= setTimeout(flush, 200); },
            reset: () => { draft = ""; clearTimeout(timer); timer = undefined; send({ t: "reset" }); },
            step: (name, args) => send({ t: "step", step: stepOf(name, args, known) }),
            signal: left.signal,
            log: say,
          };
          const out = new ReadableStream<Uint8Array>({
            start(c) {
              ctrl = c;
              void answer(live).then(
                (r) => send({ t: "done", ...r }),
                (e) => { say(left.signal.aborted ? "ask: aborted, the client left" : `ask: ${(e as Error).message}`); send({ t: "error", error: (e as Error).message }); },
              ).finally(() => { clearTimeout(timer); busy.asking = false; try { c.close(); } catch { /* already cancelled */ } });
            },
            cancel() { left.abort(); clearTimeout(timer); },
          });
          return new Response(out, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache", "x-accel-buffering": "no" } });
        }
        try {
          return Response.json(await answer({ signal: req.signal, log: say }));
        } catch (e) {
          if (req.signal.aborted) { say("ask: aborted, the client left"); return new Response(null, { status: 499 }); }
          say(`ask: ${(e as Error).message}`);
          return Response.json({ error: (e as Error).message }, { status: 500 });
        } finally { busy.asking = false; }
      }
      if (url.pathname === "/share" || url.pathname.startsWith("/share/")) return shareRoute(req, deliver);
      if (url.pathname === "/api/sync" && req.method === "POST") {
        if (!loopback(req, srv)) return new Response(null, { status: 403 });
        try { await site.sync(); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
        return Response.json({ ok: true }); // pulled; the rebuild is queued, not finished (the site is swapped when it ends)
      }
      if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405 });
      const f = fileFor(current!, url.pathname);
      if (f) return new Response(Bun.file(f));
      const nf = join(current!, "404.html");
      return new Response(existsSync(nf) ? Bun.file(nf) : "Not found", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
    },
  };
  return site;
}

/** The CI's direct call only: loopback, and not through the reverse proxy (same host, so loopback too, but it carries x-forwarded-*). */
const loopback = (req: Request, srv: Server<undefined>) =>
  /^(127\.|::1$|::ffff:127\.)/.test(srv.requestIP(req)?.address ?? "") && !req.headers.has("x-forwarded-for") && !req.headers.has("x-forwarded-host");

const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
const noStore = { "cache-control": "no-store" };

export async function serve(root: string, o: ServeOpts) {
  const say = o.say ?? console.log;
  // one change at a time (pull, write, commit, push): git and the files are shared
  // ponytail: one queue (and one "question at a time") for every space of the instance, a monorepo has one git index; per space when it hurts
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(f: () => Promise<T> | T): Promise<T> => { const r = queue.then(f); queue = r.catch(() => {}); return r; };
  const shared: Shared = { say, serial, busy: { asking: false, judging: false } };
  // multi-space instance (a `spaces/` folder): every space under /s/<name>/, the accounts and /api/spaces at the root. Otherwise one site, at the root.
  const multi = isMultiSpace(root), sites = new Map<string, Site>(), creating = new Set<string>();
  let previous: number | undefined;
  const accounts = accountRoute({
    root, say, config: () => loadConfig(root),
    titles: async () => multi ? new Map() : new Map((await openWiki(root).pages()).map((p) => [pageId(p.path), String(p.fm.title ?? p.path)])),
  });
  const mount = (name: string) => makeSite(spaceRoot(root, name), o, shared, `/s/${name}`);
  if (multi) {
    for (const name of listSpaces(root)) {
      const site = await mount(name);
      try { await site.start(); sites.set(name, site); } catch (e) { site.stop(); say(`space ${name}: ${(e as Error).message}`); }
    }
    if (!sites.size) throw new Error("no space to serve: cortex space add <name> first.");
  } else {
    sites.set("", await makeSite(root, o, shared));
    previous = await sites.get("")!.start();
  }

  /**
   * Who may see a space: anyone for an open one (no row in `spaces` is open), its members for a private one. Whatever is not sure is a no:
   * a private space stays hidden when the store fails, when sign-in is not configured (nobody can be a member) or when cortex.json is broken.
   */
  const access = async (name: string, req: Request): Promise<"ok" | "denied" | "error"> => {
    const store = accounts.store();
    try {
      if (spaceVisibility(store, name) === "open") return "ok";
      const user = await accounts.userOf(req);
      return user && memberRole(store, name, user.id) ? "ok" : "denied";
    } catch { return "error"; }
  };
  const may = async (name: string, req: Request) => (await access(name, req)) === "ok";
  const visible = async (req: Request) => { const out: string[] = []; for (const n of sites.keys()) if (await may(n, req)) out.push(n); return out; };
  /** The space `/` leads to: `default_space` if the visitor may see it, else the first they may. */
  const landing = async (names: string[]) => { const def = await loadConfig(root).then((c) => c.default_space, () => undefined); return def && names.includes(def) ? def : names[0]; };

  /** Who may create a space: any signed-in person with `site_spaces.create: "anyone"`; by default only someone who already owns a space (the first owner is named with `cortex space member <name> add <user> --role owner`). */
  const mayCreate = async (user: User) => {
    try { return (await loadConfig(root)).site_spaces?.create === "anyone" || ownsASpace(accounts.store(), user.id); } catch { return false; }
  };

  /** `POST /api/spaces`: a signed-in visitor creates a space they alone can see, and gets its URL once its first build is served. */
  const createSpace = async (req: Request): Promise<Response> => {
    if (!req.headers.get("origin") || !sameOrigin(req.headers)) return Response.json({ error: "cross-origin request refused" }, { status: 403, headers: noStore });
    if (!(await accounts.configured())) return Response.json({ error: "sign-in is not configured: spaces are created with cortex space add." }, { status: 403, headers: noStore });
    const user = await accounts.userOf(req);
    if (!user) return Response.json({ error: "not signed in" }, { status: 401, headers: noStore });
    if (!(await mayCreate(user))) return Response.json({ error: "creating a space is for the owners of a space (site_spaces.create in cortex.json)." }, { status: 403, headers: noStore });
    const body = await req.json().then((b: { name?: unknown; schema?: unknown }) => b ?? {}, () => ({} as { name?: unknown; schema?: unknown }));
    const { name, schema } = body;
    if (typeof name !== "string" || !SPACE_NAME.test(name) || (schema != null && schema !== "notes")) // the schema is never a path from the web
      return Response.json({ error: 'expected { name, schema? }: a name of lowercase letters, digits and dashes (40 at most, starting with a letter or digit); schema, if any, is "notes".' }, { status: 400, headers: noStore });
    if (sites.has(name) || creating.has(name) || existsSync(spaceRoot(root, name))) return Response.json({ error: `space ${name} already exists.` }, { status: 409, headers: noStore });
    creating.add(name);
    const store = accounts.store();
    let site: Site | undefined;
    try {
      await addSpace(root, name, undefined, schema ?? undefined); // what `cortex space add` does
      forgetSpace(store, name); // nothing of an earlier space of that name carries over
      setSpace(store, name, { visibility: "private" });
      addSpaceMember(store, name, user.id, "owner");
      site = await mount(name);
      await site.start();
      sites.set(name, site);
    } catch (e) {
      site?.stop(); rmSync(spaceRoot(root, name), { recursive: true, force: true }); forgetSpace(store, name);
      if (schema) await readConfig(root).then((c) => { delete (c.spaces as Record<string, unknown> | undefined)?.[name]; return writeConfig(configFile(root), c); }).catch(() => {});
      say(`space ${name}: ${(e as Error).message}`);
      return Response.json({ error: `the space could not be created: ${(e as Error).message}` }, { status: 500, headers: noStore });
    } finally { creating.delete(name); }
    say(`space ${name} created for ${user.name ?? user.id}`);
    if (o.sync) await serial(() => commitAndPush(root, `space: add ${name}`, [...(schema ? ["cortex.json"] : []), `spaces/${name}/wiki`, `spaces/${name}/raw`])).catch((e) => say(`space ${name}: not committed: ${(e as Error).message}`));
    return Response.json({ name, url: `/s/${name}/` }, { status: 201, headers: noStore });
  };

  const server = Bun.serve({
    port: o.port,
    async fetch(req, srv) {
      const url = new URL(req.url);
      const account = await accounts(req);
      if (account) return account;
      if (!multi) return sites.get("")!.fetch(req, srv, url);
      if (url.pathname === "/api/spaces") {
        if (req.method === "POST") { srv.timeout(req, 0); return createSpace(req); } // the first build of the space outlasts Bun's 10 s idle timeout
        if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405 });
        const names = await visible(req);
        const title = (name: string) => { try { return getSpace(accounts.store(), name)?.title ?? undefined; } catch { return undefined; } };
        return Response.json({ spaces: names.map((name) => ({ name, ...(title(name) && { title: title(name) }) })), canCreate: await (async () => { const user = await accounts.userOf(req); return !!user && (await accounts.configured()) && (await mayCreate(user)); })(), default: (await landing(names)) ?? null }, { headers: noStore });
      }
      const at = /^\/s\/([a-z0-9][a-z0-9-]*)(\/.*)?$/.exec(url.pathname);
      if (at) {
        const site = sites.get(at[1]!);
        if (!site || !(await may(at[1]!, req))) return notFound(); // a space the visitor may not see is a space that does not exist
        if (!at[2]) return new Response(null, { status: 302, headers: { location: `/s/${at[1]}/${url.search}` } });
        const inner = new URL(url);
        inner.pathname = at[2];
        return site.fetch(req, srv, inner);
      }
      if (url.pathname === "/") {
        const to = await landing(await visible(req));
        return to ? new Response(null, { status: 302, headers: { location: `/s/${to}/`, ...noStore } }) : notFound();
      }
      // the phone's share target: a stable URL, it delivers to the default space
      if (url.pathname === "/share" || url.pathname.startsWith("/share/")) {
        const to = await landing(await visible(req));
        return to ? sites.get(to)!.fetch(req, srv, url) : notFound();
      }
      if (url.pathname === "/api/sync" && req.method === "POST") {
        if (!loopback(req, srv)) return new Response(null, { status: 403 });
        try { for (const site of sites.values()) await site.sync(); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
        return Response.json({ ok: true });
      }
      return notFound();
    },
  });
  const where = multi ? ` (${sites.size} space${sites.size > 1 ? "s" : ""}: ${[...sites.keys()].join(", ")})` : "";
  say(`cortex serve: http://localhost:${server.port}${where}${o.sync ? " (sync: pull before, commit and push after each review)" : ""}${previous === undefined ? "" : ` (serving the build of ${new Date(previous).toISOString()} while the site is rebuilt)`}`);
  void searchInfo().then((i) => say(`search: SQLite ${i.sqlite} (${i.library}), sqlite-vec ${i.knn ? i.vec : "not loaded (nearest neighbours in JS)"}`), () => {});
  const stop = server.stop.bind(server);
  server.stop = (force?: boolean) => { for (const s of sites.values()) s.stop(); return stop(force); };
  return server;
}
