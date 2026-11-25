import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";

const here = import.meta.dirname;
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

// Exports the wiki once (CORTEX_UI_WIKI, else the committed fixture) into a temp folder and serves it on a free port.
// Workers read the address from CORTEX_UI_BASE. The wiki is copied first: an export writes under the wiki's .cortex/.
export default async function globalSetup() {
  const tmp = mkdtempSync(join(tmpdir(), "cortex-ui-"));
  const wiki = join(tmp, "wiki-root"), out = join(tmp, "site");
  cpSync(process.env.CORTEX_UI_WIKI || join(here, "fixture"), wiki, { recursive: true });
  const r = spawnSync("bun", [join(here, "../../src/cortex.ts"), "export", "--out", out], { env: { ...process.env, CORTEX_ROOT: wiki }, encoding: "utf8" });
  if (r.status !== 0) { rmSync(tmp, { recursive: true, force: true }); throw new Error(`cortex export failed (${r.status}):\n${r.stdout}\n${r.stderr}`); }

  const server: Server = createServer((req, res) => {
    const f = fileFor(out, new URL(req.url ?? "/", "http://x").pathname);
    const nf = join(out, "404.html");
    const [status, file] = f ? [200, f] : [404, existsSync(nf) ? nf : undefined];
    if (!file) { res.writeHead(404, { "content-type": "text/plain" }).end("Not found"); return; }
    res.writeHead(status, { "content-type": status === 404 ? "text/html; charset=utf-8" : TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : readFileSync(file));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const addr = server.address();
  process.env.CORTEX_UI_BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  return async () => {
    await new Promise((ok) => server.close(ok));
    rmSync(tmp, { recursive: true, force: true });
  };
}
