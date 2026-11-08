import { existsSync, rmSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { openWiki } from "./context";
import { exportSite } from "./export";
import { verifyPage } from "./verify";

/**
 * `cortex serve`: the exported site, plus `POST /api/verify` (a human marks a page reviewed from the site). With
 * `sync`, the wiki is a git checkout kept in step with its remote: pull before a write, commit and push after it,
 * and `POST /api/sync` (loopback only: the CI, after its own push) pulls and rebuilds. The site is rebuilt after
 * every change into the other of two folders, then swapped; requests keep the previous build meanwhile.
 */
export type ServeOpts = { port: number; sync: boolean; reviewer: string; say?: (m: string) => void };

const git = (root: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", "-C", root, ...args], { stderr: "pipe", stdout: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString().trim();
};

/**
 * Pull with rebase: local commits a failed push left behind go on top of the remote, pushed by the next change.
 * A conflict leaves the checkout at the remote (local commits dropped) rather than stuck in a rebase.
 */
export function pullRebase(root: string) {
  try { git(root, "pull", "-q", "--rebase"); }
  catch (e) {
    try { git(root, "rebase", "--abort"); } catch {}
    git(root, "reset", "-q", "--hard", "@{u}");
    throw new Error(`conflict with the remote, change dropped: ${(e as Error).message}`);
  }
}

/** Commit `paths` (default `wiki/`) and push to the checkout's remote, whatever it is; a rejected push is rebased once (`pullRebase`). */
export function commitAndPush(root: string, message: string, paths = ["wiki"], who = "cortex-serve") {
  git(root, "add", "--", ...paths);
  git(root, "-c", `user.name=${who}`, "-c", `user.email=${who}@localhost`, "commit", "-q", "-m", message);
  try { git(root, "push", "-q"); return; } catch {}
  pullRebase(root);
  git(root, "push", "-q");
}

/** Same origin only (behind the proxy the scheme may differ, the host does not); `Origin: null` is cross-origin. */
export function sameOrigin(h: Headers): boolean {
  const origin = h.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === (h.get("x-forwarded-host") ?? h.get("host")); } catch { return false; }
}

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
          rmSync(out, { recursive: true, force: true });
          try { await exportSite(root, out, () => {}); current = out; next = 1 - next; say(`site rebuilt (${out})`); }
          catch (e) { say(`export failed: ${(e as Error).message}`); }
        }
      } finally { building = undefined; }
    })();
  };
  const pull = () => o.sync && pullRebase(root);

  pull();
  await rebuild();
  if (!current) throw new Error("the first export failed: nothing to serve.");

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
      if (url.pathname === "/api/sync" && req.method === "POST") {
        const ip = srv.requestIP(req)?.address ?? "";
        // the CI's direct call only: a request through the reverse proxy (same host, so loopback too) carries x-forwarded-*
        if (!/^(127\.|::1$|::ffff:127\.)/.test(ip) || req.headers.has("x-forwarded-for") || req.headers.has("x-forwarded-host")) return new Response(null, { status: 403 });
        try { await serial(pull); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
        void rebuild();
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
