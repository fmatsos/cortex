import { expect, test } from "./helpers";

// Home page sections "Pages à la une" and "Actualité du wiki". Counts depend on the wiki (fixture or CORTEX_UI_WIKI):
// the featured pool may hold fewer than three pages, and the log may have no entry with several pages.
const FEATURED = /^(Pages à la une|Featured pages)$/;
const NEWS = /^(Actualité du wiki|Wiki news)$/;
const FACTS = /^(Le saviez-vous \?|Did you know\?)$/;
const HUBS = /^(Pages centrales|Central pages)$/;
const PORTALS = /^(Portails|Portals)$/;

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
});

// The two sections of a row share one height (the shorter one spreads its content), and the link that closes a section sits
// at its bottom right, whatever the section holds.
test.describe("home rows at 1440", () => {
  test.skip(({ isMobile }) => isMobile, "two-column layout: desktop project only");
  test.use({ viewport: { width: 1440, height: 900 } });

  const heights = (page: import("@playwright/test").Page, names: RegExp[]) =>
    Promise.all(names.map(async (n) => (await section(page, n).count() ? (await section(page, n).boundingBox())!.height : undefined)));

  for (const [label, a, b] of [["featured and news", FEATURED, NEWS], ["facts and central pages", FACTS, HUBS]] as const) {
    test(`${label} have the same height`, async ({ page }) => {
      await page.goto("/");
      const [ha, hb] = await heights(page, [a, b]);
      test.skip(ha === undefined || hb === undefined, "one of the two sections is absent from this wiki");
      expect(Math.abs(ha! - hb!), `${ha} vs ${hb}`).toBeLessThanOrEqual(1);
    });
  }

  test("the link closing a section is right-aligned at its bottom", async ({ page }) => {
    await page.goto("/");
    let seen = 0;
    for (const [name, link] of [[NEWS, /^(Tout le journal|The whole log)/], [HUBS, /^(Voir le graphe|See the graph)/], [PORTALS, /^(Tous les tags|All tags)/]] as const) {
      const sec = section(page, name);
      if (!(await sec.count())) continue;
      seen++;
      const box = (await sec.boundingBox())!, a = (await sec.getByRole("link", { name: link }).boundingBox())!;
      // content edge: 1 px border + 16 px padding
      expect(Math.abs(box.x + box.width - 17 - (a.x + a.width)), `${name} link right edge`).toBeLessThanOrEqual(2);
      // bottom: the link's own padding and 1 px border + 16 px padding
      expect(box.y + box.height - (a.y + a.height), `${name} link at the bottom`).toBeLessThanOrEqual(17 + 2);
    }
    expect(seen).toBeGreaterThan(0);
  });
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
