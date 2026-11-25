import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request } from "@playwright/test";
import { expect, test } from "./helpers";
import { staticServer } from "./static-server";

// Incremental offline update. The site is exported, the whole wiki is kept offline, then one page of the wiki changes and the site
// is exported again and served on the same origin (as `cortex serve` swaps its builds): the new service worker must download
// only the files that changed, and nothing that its predecessor already holds. The service worker's own network requests are
// the measure (as in fonts.spec.ts); the files that changed are told by comparing the two exports byte for byte.
const here = import.meta.dirname;
const PAGE = "wiki/concepts/beta/";
const SENTENCE = "A quokka sentence added after the first export.";

const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
const filesOf = (dir: string) => (readdirSync(dir, { recursive: true }) as string[]).map((f) => f.split("\\").join("/")).filter((f) => statSync(join(dir, f)).isFile()).sort();
// URL path of an exported file, as the service worker caches it (`x/index.html` is `x/`)
const urlPath = (f: string) => (f === "index.html" ? "" : f.endsWith("/index.html") ? f.slice(0, -"index.html".length) : f);

function exportTo(wiki: string, out: string) {
  // a wiki-wide lock (site/.export.lock) is held by whichever export runs: wait and retry
  for (let attempt = 0; ; attempt++) {
    const r = spawnSync("bun", [join(here, "../../src/cortex.ts"), "export", "--out", out], { env: { ...process.env, CORTEX_ROOT: wiki }, encoding: "utf8" });
    if (r.status === 0) return;
    if (attempt < 20 && /export is already running/.test(r.stderr + r.stdout)) { sleepSync(1500); continue; }
    throw new Error(`cortex export failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
  }
}
const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

test.describe("incremental offline update", () => {
  test.skip(({ isMobile }) => isMobile, "one scenario, one export pair: desktop project only (two exports at once would meet the export lock)");
  test.describe.configure({ mode: "serial" });

  let tmp: string, out1: string, out2: string, current: string, down = false, server: Server, base: string;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    tmp = mkdtempSync(join(tmpdir(), "cortex-ui-update-"));
    const wiki = join(tmp, "wiki-root");
    out1 = join(tmp, "site-1"); out2 = join(tmp, "site-2");
    cpSync(join(here, "fixture"), wiki, { recursive: true });
    exportTo(wiki, out1);
    appendFileSync(join(wiki, "wiki/concepts/beta.md"), `\n${SENTENCE}\n`); // a single page of the wiki changes
    exportTo(wiki, out2);
    current = out1;
    server = staticServer(() => current, () => down);
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  test.afterAll(async () => {
    server?.closeAllConnections();
    await new Promise((ok) => server?.close(ok));
    rmSync(tmp, { recursive: true, force: true });
  });

  test("the new service worker downloads only the changed files, and the changed page reads offline", async ({ page, context }) => {
    // what changed between the two exports (the service worker's script and the files it never caches left aside)
    const changed = filesOf(out2).filter((f) => !filesOf(out1).includes(f) || sha(join(out1, f)) !== sha(join(out2, f)));
    const expected = changed.filter((f) => !["service-worker.js", "404.html", "_app/version.json"].includes(f)).map(urlPath).sort();
    expect(expected).toEqual(["footer.json", "search-index.json", PAGE, `${PAGE}__data.json`].sort()); // the page, its data, the shared data
    expect(changed.some((f) => f.startsWith("_app/immutable/"))).toBe(false); // the hashed resources are the same files

    await page.goto(`${base}/`);
    await page.evaluate(() => navigator.serviceWorker.ready); // installed: its base is complete

    // offline mode: the whole wiki kept (the preferences menu's own action)
    await page.getByRole("banner").getByRole("button", { name: /^(Preferences|Préférences)/ }).click();
    await page.getByRole("menuitem", { name: "Download the whole wiki" }).click();
    const cached = () => page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) urls.push(r.url);
      return urls;
    });
    await expect.poll(async () => (await cached()).filter((u) => /\/wiki\/.*\/(__data\.json)?$/.test(u)).length).toBe(10); // 5 pages, each with its data
    const before = await page.evaluate(async () => (await caches.keys()).sort());
    expect(before).toHaveLength(2); // base and visited pages

    // the same site, rebuilt: the service worker looks for an update and installs it
    const requests: Request[] = [];
    context.on("request", (r) => { if (r.serviceWorker()) requests.push(r); });
    current = out2;
    await page.evaluate(async () => {
      const reg = (await navigator.serviceWorker.getRegistration())!;
      await reg.update();
      const next = reg.installing ?? reg.waiting;
      if (next && next.state !== "activated") await new Promise<void>((ok) => next.addEventListener("statechange", () => next.state === "activated" && ok()));
    });
    await expect.poll(async () => (await page.evaluate(async () => (await caches.keys()).sort())).some((n) => before.includes(n))).toBe(false); // the old version is purged
    expect(await page.evaluate(async () => (await caches.keys()).length)).toBe(2);

    const downloaded = requests.map((r) => new URL(r.url())).filter((u) => u.pathname !== "/service-worker.js");
    let bytes = 0;
    for (const r of requests) if (new URL(r.url()).pathname !== "/service-worker.js") bytes += (await (await r.response())?.body())?.length ?? 0;
    const paths = [...new Set(downloaded.map((u) => u.pathname.slice(1)))].sort();
    console.log(`MEASURE update after one changed page: ${downloaded.length} requests, ${bytes} bytes (${paths.join(", ")})`);
    expect(paths).toEqual(expected);
    expect(downloaded).toHaveLength(expected.length); // each once
    expect(downloaded.some((u) => /\/_app\/immutable\//.test(u.pathname) || /cascadia/.test(u.pathname))).toBe(false);
    expect(downloaded.some((u) => u.pathname.startsWith("/api/"))).toBe(false);

    // the server goes away: the changed page reads up to date, the pages that did not change are still there
    down = true;
    await page.goto(`${base}/${PAGE}`);
    await expect(page.locator("main")).toContainText(SENTENCE);
    await page.goto(`${base}/wiki/concepts/alpha/`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alpha concept");
    await page.goto(`${base}/wiki/entities/gamma/`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Gamma entity");
    await page.goto(`${base}/`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("banner").getByRole("button", { name: /^(Preferences|Préférences)/ }).click();
    await expect(page.getByRole("menu")).toContainText("The whole wiki is available offline"); // still the whole wiki, after the update
  });
});
