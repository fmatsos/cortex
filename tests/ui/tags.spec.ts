import { expect, test } from "./helpers";

// The tags index: one row per tag (name left, count in its own right-aligned column), filter and sort kept in the URL.
const noHScroll = (page: import("@playwright/test").Page) => page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth);

test("one row per tag, a link to the search of that tag, the counts aligned on their right edge", async ({ page }) => {
  await page.goto("/tags");
  const rows = page.locator("main ul > li > a");
  expect(await rows.count()).toBeGreaterThanOrEqual(3);
  await expect(rows.first()).toHaveAttribute("href", /\/search\/\?q=%23\w+/);
  const rights = await page.locator("main ul > li > a > span:nth-child(2)").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().right)));
  expect(new Set(rights).size).toBe(1);
  // no badge cloud left: rows stack, they do not sit side by side
  const tops = await rows.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(tops.length);
  expect(await noHScroll(page)).toBe(true);
});

test("the count is read with its noun", async ({ page }) => {
  await page.goto("/tags");
  await expect(page.getByRole("link", { name: /^#alpha 4 pages$/ })).toBeVisible();
});

test("filter and sort come from the URL, and the empty state offers to clear the filter", async ({ page }) => {
  await page.goto("/tags/?q=gra&sort=alpha");
  await expect(page.getByLabel(/Filter tags|Filtrer les tags/)).toHaveValue("gra");
  await expect(page.locator("main ul > li > a")).toHaveCount(1);
  await page.getByLabel(/Filter tags|Filtrer les tags/).fill("zzzz");
  await expect(page).toHaveURL(/q=zzzz/);
  await expect(page.locator("main ul > li > a")).toHaveCount(0);
  await page.getByRole("button", { name: /Clear the filter|Effacer le filtre/ }).click();
  await expect(page.getByLabel(/Filter tags|Filtrer les tags/)).toHaveValue("");
  await expect(page.getByLabel(/Filter tags|Filtrer les tags/)).toBeFocused();
  expect(await page.locator("main ul > li > a").count()).toBeGreaterThanOrEqual(3);
});

test("a very long tag name wraps inside its row", async ({ page }) => {
  await page.goto("/tags");
  await page.evaluate(() => {
    const a = document.querySelector("main ul > li > a > span")!;
    a.textContent = `#${"averylongtagname".repeat(8)}`;
  });
  expect(await noHScroll(page)).toBe(true);
});
