import { mkdirSync } from "node:fs";
import { expect, test } from "./helpers";
import { mockIndex, type IndexDoc } from "./search-fixtures";

// Result rows: the page's own description is text, never HTML; long texts are clamped with a way to read them whole; the column keeps
// a readable measure. The index is a mock (`search-fixtures.ts`), service workers are blocked so that nothing answers in its place.
test.use({ serviceWorkers: "block" });

const ACTIVE = `<img src=x onerror="window.__xss = 1"><b>bold</b>`;
const XSS: IndexDoc = { id: "concepts/evil", title: "Evil page", description: ACTIVE, text: "zebracorn marker" };
const LONG = "A long description that goes on and on about nothing in particular, ".repeat(12);

test("a description holding active HTML is shown as text on the home favorites and runs nothing", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cortex:favs", JSON.stringify(["concepts/evil"])));
  await mockIndex(page, [XSS]);
  await page.goto("/");
  const fav = page.getByRole("region", { name: /Favorites/ });
  await expect(fav.getByRole("link", { name: "Evil page" })).toBeVisible();
  await expect(fav).toContainText(ACTIVE); // literally, as typed
  await expect(fav.locator("img, b")).toHaveCount(0);
  await page.waitForTimeout(300); // an onerror would have run by now
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test("a description holding active HTML is shown as text in the search results too", async ({ page }) => {
  await mockIndex(page, [XSS]);
  await page.goto("/search/?q=zebracorn");
  const row = page.locator("main li", { hasText: "Evil page" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("<img src=x");
  await expect(row.locator("img, b")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test("the palette shows a description as text as well", async ({ page }) => {
  await mockIndex(page, [{ ...XSS, title: "Zebracorn guide", text: "" }]);
  await page.goto("/");
  await page.getByRole("combobox").first().fill("zebracorn");
  await expect(page.getByRole("option", { name: /Zebracorn guide/ })).toBeVisible();
  await expect(page.getByRole("listbox").locator("img, b")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test("a long description and excerpt are clamped, a button reads them whole, and the column keeps a bounded measure", async ({ page }) => {
  await mockIndex(page, [
    { id: "concepts/long", title: "Long page", description: LONG, text: `${LONG} zebracorn ${LONG}` },
    { id: "concepts/short", title: "Short page zebracorn", description: "Brief.", text: "" },
  ]);
  await page.goto("/search/?q=zebracorn");
  const row = page.locator("main li", { hasText: "Long page" });
  const desc = row.locator("[data-row-description]"), snip = row.locator("[data-row-snippet]");
  await expect(desc).toBeVisible();
  await expect(snip).toBeVisible();
  const more = row.locator("button[aria-expanded]");
  await expect(more).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(more).toContainText("Show more");
  await expect(more).toContainText("Long page"); // its accessible name says which result
  const clamped = (await desc.boundingBox())!.height;
  // the passage is set apart from the description (a rule on its left), not the same grey paragraph
  expect(await snip.evaluate((e) => getComputedStyle(e).borderLeftWidth)).toBe("2px");
  expect(await desc.evaluate((e) => getComputedStyle(e).borderLeftWidth)).toBe("0px");
  // measure: the text column is never wider than 80 characters (of its own font)
  const col = await desc.evaluate((e) => { const c = e.parentElement!, p = document.createElement("span"); p.style.cssText = "width:80ch;display:block;position:absolute;visibility:hidden"; c.appendChild(p); const w = p.getBoundingClientRect().width; p.remove(); return { max: w, box: c.getBoundingClientRect().width }; });
  expect(col.box).toBeLessThanOrEqual(col.max + 1);

  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(more).toContainText("Show less");
  expect((await desc.boundingBox())!.height).toBeGreaterThan(clamped);
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  // a short row has no button
  await expect(page.locator("main li", { hasText: "Short page" }).getByRole("button", { name: /Show/ })).toHaveCount(0);
});

// Screens for the review of the design: CORTEX_UI_SHOTS=<folder> bunx playwright test tests/ui/search.spec.ts
test("screens of the result rows", async ({ page }, info) => {
  const dir = process.env.CORTEX_UI_SHOTS;
  test.skip(!dir, "only with CORTEX_UI_SHOTS");
  mkdirSync(dir!, { recursive: true });
  await mockIndex(page, [
    { id: "concepts/long", title: "Long page", description: LONG, text: `${LONG} zebracorn ${LONG}`, tags: ["x"] },
    { id: "concepts/short", title: "Short page zebracorn", description: "Brief.", text: "" },
    { id: "entities/third", title: "Third page", description: "A medium description about zebracorn things.", type: "Entity", text: "More zebracorn text here." },
  ]);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/search/?q=zebracorn");
    await expect(page.locator("main li[data-page]").first()).toBeVisible();
    await page.screenshot({ path: `${dir}/rows-${info.project.name}-${scheme}.png`, fullPage: true });
  }
});
