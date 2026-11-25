import type { Page, Route } from "@playwright/test";
import { expect, test } from "./helpers";

// Cascadia Code weighs ~219 KB and is for real code only: a browser fetches an @font-face once a rendered element uses it, so a
// page without code must not download it (no kbd, header or palette element may be set in --font-mono, and nothing preloads it).
// Requests are read on the page, not on the service worker's background precache of the offline copy.
function cascadia(page: Page) {
  const urls: string[] = [];
  page.on("request", (r) => { if (/cascadia-code/.test(r.url())) urls.push(r.url()); });
  return urls;
}
// Inter is used by every page: seeing it requested proves that the font requests are observed, so that "no Cascadia" means something
async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.evaluate(() => document.fonts.check('16px Inter', "x"))).toBe(true);
}

test("the home page, the search page and a page without code do not download Cascadia Code", async ({ page }) => {
  const urls = cascadia(page);
  for (const path of ["/", "/search", "/search?q=alpha", "/graph", "/wiki/concepts/alpha"]) {
    await page.goto(path);
    await settled(page);
  }
  expect(urls).toEqual([]);
});

test("a first visit does not fetch Cascadia Code either through the service worker's offline precache", async ({ page, context }) => {
  const urls: string[] = [];
  context.on("request", (r) => { if (/cascadia-code/.test(r.url())) urls.push(r.url()); }); // page and service worker requests
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready); // installed, so its precache is done
  await settled(page);
  expect(urls).toEqual([]);
});

test("the keyboard shortcuts are set in Inter with tabular figures, not in the code font", async ({ page, isMobile }) => {
  test.skip(isMobile, "the shortcut hint of the search field is hidden on touch screens");
  await page.goto("/graph");
  const kbd = page.getByRole("banner").locator("kbd").first();
  await expect(kbd).toBeVisible();
  await expect(kbd).toHaveCSS("font-family", /^Inter,/);
  await expect(kbd).toHaveCSS("font-variant-numeric", "tabular-nums");
});

test("a wiki page with code downloads Cascadia Code and sets its code in it", async ({ page }) => {
  const urls = cascadia(page);
  await page.goto("/wiki/concepts/beta");
  await expect(page.locator("main .wiki pre code")).toHaveCSS("font-family", /^"Cascadia Code"/);
  await expect.poll(() => urls.length).toBeGreaterThan(0);
  await settled(page);
  expect(await page.evaluate(() => document.fonts.check('14px "Cascadia Code"', "x != y"))).toBe(true);
});

test("the service worker keeps Cascadia Code in its cache once a page has asked for it", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.goto("/wiki/concepts/beta"); // now controlled by the service worker, which fetches the font and keeps it
  await settled(page);
  await expect.poll(() => page.evaluate(async () => {
    for (const name of await caches.keys()) if ((await (await caches.open(name)).keys()).some((r) => /cascadia-code\.[^/]*\.woff2$/.test(r.url))) return true;
    return false;
  })).toBe(true);
});

test("the assistant fetches Cascadia Code only when an answer contains code", async ({ page, isMobile }) => {
  test.skip(isMobile, "assistant panel flows: desktop project only");
  const answer = { segments: [{ html: "<p>Run <code>cortex export</code>:</p><pre><code>cortex export --out ./site</code></pre>" }], md: "x", cited: [], retained: [], related: [] };
  await page.route("**/api/ask", (route: Route) => route.request().method() === "HEAD" ? route.fulfill({ status: 204 }) : route.fulfill({ contentType: "application/json", body: JSON.stringify(answer) }));
  const urls = cascadia(page);
  await page.goto("/graph");
  await page.locator("#assistant-toggle").click();
  await expect(page.locator("#assistant-panel")).toBeVisible();
  await settled(page);
  expect(urls, "an open panel without an answer").toEqual([]);
  await page.locator("#assistant-q").fill("how do I export?");
  await page.keyboard.press("Enter");
  await expect(page.locator("#assistant-panel pre code")).toBeVisible();
  await expect.poll(() => urls.length).toBeGreaterThan(0);
});
