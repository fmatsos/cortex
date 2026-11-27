import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./helpers";

// A browser that visited a legacy instance (site at the root, service worker of scope `/`) comes back after `cortex space migrate`: the
// server now serves the wiki as a space, and must not leave the old worker serving the old root site from its caches. Real `cortex serve`,
// real Chrome: the worker installs and caches, the server stops, the wiki is migrated, the server starts again on the same origin.
const cli = join(import.meta.dirname, "../../src/cortex.ts");

const freePort = () => new Promise<number>((ok) => { const s = createServer().listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => ok(port)); }); });

test.describe("service worker of a site served at the root, before and after migration", () => {
  test.skip(({ isMobile }) => isMobile, "one scenario, real servers: desktop project only");
  test.setTimeout(180_000);

  test("the old worker and its caches are removed, and the old URLs end in the space with current content", async ({ page }) => {
    const root = mkdtempSync(join(tmpdir(), "cortex-legacy-worker-"));
    cpSync(join(import.meta.dirname, "fixture"), root, { recursive: true });
    const env = { ...process.env, CORTEX_ROOT: root, CORTEX_REVIEWER: "t" };
    const port = await freePort(), origin = `http://127.0.0.1:${port}`;
    let server: ChildProcess | undefined;
    // the first export of `serve` takes the export lock of the machine: another export (a parallel test) makes it fail, so try again
    const serve = async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const child = spawn("bun", [cli, "serve", "--port", String(port)], { env, cwd: root, stdio: "ignore" });
        let exited = false;
        child.on("exit", () => { exited = true; });
        for (let i = 0; i < 240 && !exited; i++) {
          const up = await fetch(origin + "/", { redirect: "manual" }).then((r) => r.status === 200 || r.status === 302, () => false);
          if (up) return (server = child);
          await new Promise((r) => setTimeout(r, 250));
        }
        child.kill();
        await new Promise((r) => setTimeout(r, 1500));
      }
      throw new Error("cortex serve did not start");
    };
    const stop = async () => { const s = server; server = undefined; if (!s) return; const gone = new Promise((r) => s.once("exit", r)); s.kill(); await gone; };
    try {
      await serve();
      await page.goto(origin + "/");
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.goto(origin + "/wiki/concepts/alpha/"); // the worker controls this page and keeps it
      const before = await page.evaluate(async () => ({ scopes: (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname), caches: await caches.keys() }));
      expect(before.scopes).toEqual(["/"]);
      expect(before.caches.some((c) => c.startsWith("cortex-wiki:/:"))).toBe(true);
      await stop();

      const m = spawnSync("bun", [cli, "space", "migrate", "veille"], { env, cwd: root, encoding: "utf8" });
      expect(m.status, m.stderr).toBe(0);
      await serve();

      for (const [path, ends] of [["/", "/s/veille/"], ["/wiki/concepts/alpha/", "/s/veille/wiki/concepts/alpha/"]] as const) {
        await page.goto(origin + path);
        await page.waitForURL(origin + ends);
        // the retiring worker updates, deletes the root site's caches and removes itself; the space's own worker takes over
        await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname)), { timeout: 30_000 }).toEqual(["/s/veille/"]);
        const after = await page.evaluate(async () => ({ caches: await caches.keys(), title: document.title }));
        expect(after.caches.filter((c) => c.startsWith("cortex-wiki:/:")), "no cache of the old root site").toEqual([]);
        expect(await page.locator("main").innerText()).toMatch(/Alpha|alpha|Cortex|wiki/i);
      }
      // the old script itself is now the retiring one
      expect(await (await fetch(origin + "/service-worker.js")).text()).toContain("unregister()");
    } finally {
      await stop();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
