import { expect, test } from "./helpers";

// The icon pack is drawn in the square language: butt ends, mitered joins. Checked on the real rendered page.
test("the header nav renders icons with butt ends and mitered joins", async ({ page }) => {
  await page.goto("/");
  const icon = page.getByRole("banner").locator("nav svg").first();
  await expect(icon).toBeVisible();
  const box = await icon.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);
  const style = await icon.evaluate((el) => {
    const s = getComputedStyle(el);
    return { cap: s.strokeLinecap, join: s.strokeLinejoin, limit: s.strokeMiterlimit };
  });
  expect(style).toEqual({ cap: "butt", join: "miter", limit: "2" });
});
