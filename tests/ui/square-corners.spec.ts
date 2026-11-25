import { expect, test } from "./helpers";

// Square corners (owner decision): no capsule, no disc, no rounded timeline dot on the pages that carried some (collections and
// sort chips, journal timeline, home examples, filters). The computed radius of every element is 0, whatever its class.
const PAGES = ["/", "/tags/", "/log/", "/search/?q=alpha", "/wiki/concepts/alpha/", "/changes/", "/paths/", "/maintenance/"];

for (const path of PAGES) {
  test(`${path}: no element has a rounded corner`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const rounded = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => !(e instanceof SVGElement) && (e.closest("svg") === null)).flatMap((e) => {
      const r = getComputedStyle(e);
      return ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"].some((k) => parseFloat(r[k as "borderTopLeftRadius"]) > 0) ? [`${e.tagName.toLowerCase()}.${String(e.getAttribute("class") ?? "").slice(0, 60)}`] : [];
    }));
    expect(rounded).toEqual([]);
  });
}
