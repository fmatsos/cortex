import { mkdirSync } from "node:fs";
import { expect, test } from "./helpers";
import { mockIndex, type IndexDoc } from "./search-fixtures";

// The palette never takes more room than the screen shows: no height floor (it was 180 px), the filter chips step aside when the room
// is short, and the panel opens upwards when there is more room above the field than below. The index is a mock: many pages, so that
// the list is longer than any panel.
test.use({ serviceWorkers: "block" });

const DOCS: IndexDoc[] = Array.from({ length: 40 }, (_, i) => ({ id: `concepts/p${i}`, title: `Gizmo page ${i}`, description: `Description ${i}`, text: "gizmo" }));
// the field of the page: the large one on the home page, the header one elsewhere (/tags/)
const field = (page: import("@playwright/test").Page) => page.getByRole("combobox").first();
const panel = (page: import("@playwright/test").Page) => page.getByRole("listbox").locator("xpath=..");

for (const [path, w, h] of [["/", 1024, 600], ["/", 800, 300], ["/", 800, 220], ["/tags/", 390, 330], ["/tags/", 844, 260], ["/tags/", 800, 200]] as const) {
  test(`${path} ${w}x${h}: the open palette stays inside the visible window and its options stay reachable`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await mockIndex(page, DOCS);
    await page.goto(path);
    await field(page).click();
    await field(page).fill("gizmo");
    await expect(page.getByRole("option").first()).toBeVisible();
    const box = (await panel(page).boundingBox())!;
    expect(box.y, "top of the panel is on screen").toBeGreaterThanOrEqual(-1);
    expect(box.y + box.height, "bottom of the panel is on screen").toBeLessThanOrEqual(h + 1);
    // the field itself is still seen, and the keyboard reaches the last option, which scrolls into view inside the panel
    await expect(field(page)).toBeInViewport();
    await field(page).press("ArrowUp");
    const last = page.getByRole("option").last();
    await expect(last).toBeInViewport();
    const after = (await panel(page).boundingBox())!;
    expect(after.y + after.height).toBeLessThanOrEqual(h + 1);
  });
}

test("a tall window keeps the filter chips; a short one gives their room to the options", async ({ page }) => {
  await mockIndex(page, DOCS);
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto("/tags/");
  await field(page).click();
  await field(page).fill("gizmo type:concept");
  await expect(page.getByRole("option").first()).toBeVisible();
  const chips = page.getByRole("button", { name: /Remove/ });
  await expect(chips).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 260 });
  await expect(page.getByRole("option").first()).toBeVisible();
  await expect(chips, "the chips step aside").toHaveCount(0);
  const box = (await panel(page).boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(261);
  expect(box.height).toBeLessThanOrEqual(260);
});

test("in a short window an option opens its page and Enter runs the search", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 240 });
  await page.goto("/tags/");
  await field(page).click();
  await field(page).fill("zebracorn");
  const option = page.getByRole("option", { name: /Beta concept/ }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(page).toHaveURL(/\/wiki\/concepts\/beta\//);
  await page.goto("/tags/");
  await field(page).click();
  await field(page).fill("zebracorn");
  await field(page).press("Enter");
  await expect(page).toHaveURL(/\/search\/\?q=zebracorn/);
});

test("screens of the palette in a short window", async ({ page }, info) => {
  const dir = process.env.CORTEX_UI_SHOTS;
  test.skip(!dir, "only with CORTEX_UI_SHOTS");
  mkdirSync(dir!, { recursive: true });
  await mockIndex(page, DOCS);
  await page.setViewportSize({ width: 844, height: 260 });
  await page.goto("/tags/");
  await field(page).click();
  await field(page).fill("gizmo");
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.screenshot({ path: `${dir}/palette-short-${info.project.name}.png` });
});
