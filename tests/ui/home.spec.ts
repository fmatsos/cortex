import { expect, test } from "./helpers";

// Home page sections "Pages à la une" and "Actualité du wiki". Counts depend on the wiki (fixture or CORTEX_UI_WIKI):
// the featured pool may hold fewer than three pages, and the log may have no entry with several pages.
const FEATURED = /^(Pages à la une|Featured pages)$/;
const NEWS = /^(Actualité du wiki|Wiki news)$/;

const section = (page: import("@playwright/test").Page, name: RegExp) => page.getByRole("region", { name });

test("featured pages: up to three distinct entries, listed under the plural heading", async ({ page }) => {
  await page.goto("/");
  const featured = section(page, FEATURED);
  if (!(await featured.count())) {
    // no page qualifies in this wiki: the section is simply absent
    await expect(page.getByRole("heading", { name: FEATURED })).toHaveCount(0);
    return;
  }
  await expect(featured.getByRole("heading", { level: 2, name: FEATURED })).toBeVisible();
  const items = featured.getByRole("listitem");
  const n = await items.count();
  expect(n).toBeGreaterThanOrEqual(1);
  expect(n).toBeLessThanOrEqual(3);
  const hrefs = await featured.locator("li > a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  expect(new Set(hrefs).size, "distinct pages").toBe(n);
  // the section follows its content: no stretched empty space under the last entry
  const box = (await featured.boundingBox())!, last = (await items.last().boundingBox())!;
  expect(box.y + box.height - (last.y + last.height)).toBeLessThan(40);
});

test("featured pages: the same day gives the same picks after a reload", async ({ page }) => {
  await page.goto("/");
  const links = () => section(page, FEATURED).locator("li > a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  if (!(await section(page, FEATURED).count())) return;
  const first = await links();
  await page.reload();
  expect(await links()).toEqual(first);
});

test("news: badges share one width and one left edge, dates line up", async ({ page }) => {
  await page.goto("/");
  const news = section(page, NEWS);
  await expect(news.getByRole("heading", { level: 2, name: NEWS })).toBeVisible();
  const badges = news.locator('[data-slot="badge"]');
  const n = await badges.count();
  expect(n).toBeGreaterThan(0);
  const boxes = await badges.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, w: r.width }; }));
  expect(new Set(boxes.map((b) => Math.round(b.w))).size, "one badge width").toBe(1);
  expect(new Set(boxes.map((b) => Math.round(b.x))).size, "one left edge").toBe(1);
  const dates = await news.locator("time").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
  expect(new Set(dates).size, "one date column").toBe(1);
});

test("news: pages of an entry are separated with spaces and stay links", async ({ page }) => {
  await page.goto("/");
  const lists = section(page, NEWS).locator("li > p");
  const count = await lists.count();
  for (let i = 0; i < count; i++) {
    const p = lists.nth(i);
    const links = await p.locator("a").count();
    const text = (await p.textContent()) ?? "";
    expect(text.trim()).not.toBe("");
    if (links > 1) expect(text, "separators between titles").toMatch(/[^,]+, [^,]|[^·]+ · [^·]| (et|and) /);
    expect(text, "no comma glued to the next title").not.toMatch(/,\S/);
  }
});

test("no horizontal overflow of the home page at 390", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth)).toBe(true);
  const news = section(page, NEWS);
  const box = (await news.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});
