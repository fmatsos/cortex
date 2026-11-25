import { expect, test } from "./helpers";

// The log: the search field stays visible, the other filters sit in one panel whose summary names the choices in force
// (closed on a phone, so the entries come first), the whole text of an entry stays reachable.
const summary = (page: import("@playwright/test").Page) => page.locator("main details > summary").first();
const noHScroll = (page: import("@playwright/test").Page) => page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth);

test.describe("phone", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile project only");

  test("the entries start in the first screen; the filters are one line until opened", async ({ page }) => {
    await page.goto("/log");
    await expect(page.getByLabel(/Search the log|Rechercher dans le journal/)).toBeVisible();
    await expect(summary(page)).toContainText(/Filters|Filtres/);
    await expect(summary(page)).toContainText(/no active filter|aucun filtre actif/);
    await expect(page.getByRole("button", { name: /^(All|Tout)/ })).toBeHidden();
    const entry = page.locator("main ol ol > li").first();
    await expect(entry).toBeVisible();
    const vh = page.viewportSize()!.height;
    expect((await entry.boundingBox())!.y).toBeLessThan(vh);
    expect(await noHScroll(page)).toBe(true);
  });

  test("opening the panel gives the type chips and the period; the summary names a chosen type", async ({ page }) => {
    await page.goto("/log");
    await summary(page).click();
    const chip = page.getByRole("button", { name: /^(Update|Mise à jour)/ });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page).toHaveURL(/type=update/);
    await expect(summary(page)).toContainText(/Type\s*:\s*\S+/);
    await expect(page.locator("main ol ol > li")).toHaveCount(1);
  });
});

test.describe("wide", () => {
  test.skip(({ isMobile }) => isMobile, "desktop project only");

  test("the panel is open from the start", async ({ page }) => {
    await page.goto("/log");
    await expect(page.getByRole("button", { name: /^(All|Tout)/ })).toBeVisible();
  });
});

test("a filter in the URL is named in the summary, and a direct link keeps its entry displayed", async ({ page }) => {
  await page.goto("/log/?type=update");
  await expect(summary(page)).toContainText(/Type\s*:/);
  await expect(page.locator("main ol ol > li")).toHaveCount(1);
});

test("the whole text of an entry stays reachable", async ({ page }) => {
  await page.goto("/log");
  const entry = page.locator("main ol ol > li").nth(1);
  await expect(entry).toContainText("A link and bold.");
  await expect(entry.getByRole("link", { name: "link", exact: true })).toBeAttached();
});
