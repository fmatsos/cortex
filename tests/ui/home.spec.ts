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

// News: an editorial timeline, an ordered list of days holding an ordered list of briefs, one sentence per brief.
test("news: no kind badge, an ordered list of days with a dated heading, briefs as ordered lists", async ({ page }) => {
  await page.goto("/");
  const news = section(page, NEWS);
  await expect(news.getByRole("heading", { level: 2, name: NEWS })).toBeVisible();
  await expect(news.locator('[data-slot="badge"]'), "no kind badge in the news block").toHaveCount(0);
  const days = news.locator("ol > li > h3");
  const nd = await days.count();
  expect(nd).toBeGreaterThan(0);
  expect(await days.locator("time[datetime]").count(), "a <time datetime> per day heading").toBe(nd);
  for (const d of await days.locator("time").evaluateAll((els) => els.map((e) => e.getAttribute("datetime")))) expect(d).toMatch(/^\d{4}-\d\d-\d\d$/);
  // 3 briefs at most, each one a list item of a nested ordered list
  const briefs = news.locator("ol ol > li");
  const n = await briefs.count();
  expect(n).toBeGreaterThanOrEqual(1);
  expect(n).toBeLessThanOrEqual(3);
  expect(await news.locator("ol ol").evaluateAll((els) => els.every((e) => e.tagName === "OL" && e.parentElement?.tagName === "LI"))).toBe(true);
  // the vertical rule and the square markers are decorative
  expect(await briefs.locator("> span[aria-hidden=true]").count(), "one hidden marker per brief").toBe(n);
  // square system: no radius, and only the light relief of an in-page surface (--shadow-surface), never the overlay shadow
  const style = await news.evaluate((el) => {
    const c = getComputedStyle(el), i = document.createElement("i");
    i.style.boxShadow = "var(--shadow-surface)";
    document.body.append(i);
    const surface = getComputedStyle(i).boxShadow;
    i.remove();
    return { r: c.borderTopLeftRadius, s: c.boxShadow.endsWith(surface) };
  });
  expect(style).toEqual({ r: "0px", s: true });
});

test("news: one sentence per brief, times are links to the log entry, no 00:00 invented", async ({ page }) => {
  await page.goto("/");
  const briefs = section(page, NEWS).locator("ol ol > li");
  const n = await briefs.count();
  for (let i = 0; i < n; i++) {
    const li = briefs.nth(i);
    const sentence = ((await li.locator("> p").first().textContent()) ?? "").replace(/\s+/g, " ").trim();
    expect(sentence, "ends like a sentence").toMatch(/[.»]$/);
    expect(sentence, "starts with the verb of the kind").toMatch(/^(Source|Compil|Mise à jour|Contrôle|Question|Updat|Check|Compiled)/);
    const first = sentence.split(" : ")[0]!;
    expect(first.length, sentence).toBeGreaterThan(3);
    // a count is never invented: « N pages créées / mises à jour » (read from the log) or « N pages référencées »
    expect(sentence).not.toMatch(/undefined|NaN|\{|\}/);
    const meta = li.locator("> p").nth(1);
    const link = meta.locator("a").first();
    expect(await link.getAttribute("href")).toMatch(/\/log\/?#e-\d{8}-/);
    for (const dt of await meta.locator("time").evaluateAll((els) => els.map((e) => e.getAttribute("datetime")))) expect(dt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d/); // a time only when the log has one
  }
});

test("news: pages of a brief are separated with spaces and stay links", async ({ page }) => {
  await page.goto("/");
  const metas = section(page, NEWS).locator("ol ol > li > p:nth-of-type(2)");
  const count = await metas.count();
  for (let i = 0; i < count; i++) {
    const text = ((await metas.nth(i).textContent()) ?? "").replace(/\s+/g, " ");
    expect(text, "no comma glued to the next title").not.toMatch(/,\S/);
    expect(await metas.nth(i).locator("a").count()).toBeGreaterThanOrEqual(1);
  }
});

test("news: sentences are 16 px, meta lines 14 px, day headings in the sans family", async ({ page }) => {
  await page.goto("/");
  const news = section(page, NEWS);
  const px = (sel: string, prop: string) => news.locator(sel).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
  expect(await px("ol ol > li > p:nth-of-type(1)", "font-size")).toBe("16px");
  expect(await px("ol ol > li > p:nth-of-type(2)", "font-size")).toBe("14px");
  expect(await px("ol > li > h3", "font-family")).toContain("Inter");
});

test("no horizontal overflow of the home page at 390", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth)).toBe(true);
  const news = section(page, NEWS);
  const box = (await news.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});

// The home tab carries a translated subtitle; the other pages keep "Page · Cortex".
test("home: the tab title is 'Cortex · subtitle' in both languages", async ({ page }) => {
  await page.goto("/");
  const pick = async (name: string) => {
    await page.getByRole("banner").getByRole("button", { name: /^(Préférences|Preferences)$/ }).click();
    await page.getByRole("menu").getByRole("menuitemradio", { name, exact: true }).click();
  };
  await pick("Français");
  await expect(page).toHaveTitle("Cortex · Wiki de connaissances");
  await pick("English");
  await expect(page).toHaveTitle("Cortex · Knowledge wiki");
});
