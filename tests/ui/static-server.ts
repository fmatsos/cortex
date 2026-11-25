import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

// Same lookup as `fileFor` in src/serve.ts: the file, file.html, file/index.html; anything else is the 404 page with status 404.
function fileFor(dir: string, pathname: string): string | undefined {
  let p: string;
  try { p = decodeURIComponent(pathname); } catch { return; }
  const base = resolve(dir), f = resolve(base, "." + p);
  if (f !== base && !f.startsWith(base + sep)) return;
  for (const c of [f, f + ".html", join(f, "index.html")]) if (existsSync(c) && statSync(c).isFile()) return c;
}

/**
 * Serves an exported site. `dir` is read at each request: a test can swap the site under a running server (same origin, so the
 * service worker registration stays) the way `cortex serve` swaps its builds. `unreachable()` true: the connection is cut, as offline.
 */
export function staticServer(dir: () => string, unreachable: () => boolean = () => false, seen?: (pathname: string) => void): Server {
  return createServer((req, res) => {
    if (unreachable()) { req.socket.destroy(); return; }
    const out = dir(), pathname = new URL(req.url ?? "/", "http://x").pathname;
    seen?.(pathname);
    const f = fileFor(out, pathname);
    const nf = join(out, "404.html");
    const [status, file] = f ? [200, f] : [404, existsSync(nf) ? nf : undefined];
    if (!file) { res.writeHead(404, { "content-type": "text/plain" }).end("Not found"); return; }
    res.writeHead(status, { "content-type": status === 404 ? "text/html; charset=utf-8" : TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : readFileSync(file));
  });
}
