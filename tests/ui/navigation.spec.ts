import { expect, test } from "./helpers";

// The header's main navigation: one row of links with visible text on a wide header, a "Menu" button with a visible label
// that opens the same links as a list on a narrow one (never icons alone).
const LABELS = /^(Search|Graph|Tags|Log|Review|What's new|Paths|Favorites|Recherche|Graphe|Journal|Relecture|Nouveautés|Parcours|Favoris)$/;
const nav = (page: import("@playwright/test").Page) => page.getByRole("banner").getByRole("navigation");
const noHScroll = (page: import("@playwright/test").Page) => page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth);

test.describe("wide header", () => {
  test.skip(({ isMobile }) => isMobile, "desktop project only");

  test("the links are in a row with their text, and there is no Menu button", async ({ page }) => {
    await page.goto("/graph");
    await expect(nav(page).getByRole("button")).toBeHidden();
    const links = nav(page).getByRole("link");
    expect(await links.count()).toBeGreaterThanOrEqual(5);
    for (const link of await links.all()) {
      await expect(link).toBeVisible();
      expect((await link.innerText()).trim()).toMatch(LABELS);
    }
    await expect(nav(page).getByRole("link", { name: "Graph" })).toHaveAttribute("aria-current", "page");
  });

  // the fixture has a reading path and review is off: What's new and Paths (once footer.json says there is one) but not Review
  test("What's new and Paths are there, Review is not (off); the footer links the reading paths and the wiki status", async ({ page }) => {
    await page.goto("/graph");
    await expect(nav(page).getByRole("link", { name: "Paths" })).toHaveAttribute("href", /\/paths\/$/);
    await expect(nav(page).getByRole("link", { name: "What's new" })).toHaveAttribute("href", /\/changes\/$/);
    await expect(nav(page).getByRole("link", { name: "Review", exact: true })).toHaveCount(0);
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: "Reading paths" })).toHaveAttribute("href", /\/paths\/$/);
    await expect(footer.getByRole("link", { name: "Wiki status" })).toHaveAttribute("href", /\/maintenance\/$/);
  });

  test("no Paths entry, in the header or the footer, when footer.json says no path is published", async ({ page }) => {
    await page.route("**/footer.json", async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, json: { ...(await r.json()), paths: 0 } }); });
    await page.goto("/graph");
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Wiki status" })).toBeVisible(); // footer.json is loaded
    await expect(nav(page).getByRole("link", { name: "Paths" })).toHaveCount(0);
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Reading paths" })).toHaveCount(0);
  });

  // the row has to fit with its entries (review-changes.spec.ts checks the longest one, with Review too), at the widths
  // where it is laid out: one line of links, no horizontal scroll, no Menu; below the threshold (896 px) the Menu takes over
  for (const width of [1440, 1280, 1100, 900]) {
    test(`${width} px: one line of links beside no Menu button, nothing overflows`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/graph");
      await expect(nav(page).getByRole("link", { name: "Paths" })).toBeVisible(); // footer.json loaded
      await expect(nav(page).getByRole("button")).toBeHidden();
      const tops = await Promise.all((await nav(page).getByRole("link").all()).map(async (l) => Math.round((await l.boundingBox())!.y)));
      expect(new Set(tops).size, `link tops ${tops}`).toBe(1);
      expect(await noHScroll(page)).toBe(true);
      // on the single-line header (1280 and up) the links keep their text, not their icon; the two-line one keeps both
      await (width >= 1280 ? expect(nav(page).locator("a svg").first()).toBeHidden() : expect(nav(page).locator("a svg").first()).toBeVisible());
      const header = (await page.getByRole("banner").boundingBox())!;
      expect(header.height, "header height").toBeLessThan(width >= 1280 ? 70 : 110);
    });
  }

  test("895 px: the links are behind the Menu button, nothing overflows", async ({ page }) => {
    await page.setViewportSize({ width: 895, height: 800 });
    await page.goto("/graph");
    await expect(nav(page).getByRole("button", { name: "Menu" })).toBeVisible();
    await expect(nav(page).getByRole("link").first()).toBeHidden();
    expect(await noHScroll(page)).toBe(true);
  });
});

test.describe("narrow header", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile project only");

  test("the links are behind a Menu button with a visible label; each one is listed with its text", async ({ page }) => {
    await page.goto("/graph");
    const button = nav(page).getByRole("button", { name: "Menu" });
    await expect(button).toBeVisible();
    expect((await button.innerText()).trim()).toBe("Menu");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(nav(page).getByRole("link").first()).toBeHidden();

    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const links = nav(page).getByRole("link");
    expect(await links.count()).toBeGreaterThanOrEqual(5);
    for (const link of await links.all()) {
      await expect(link).toBeVisible();
      expect((await link.innerText()).trim()).toMatch(LABELS);
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(24);
    }
    await expect(nav(page).getByRole("link", { name: "Graph" })).toHaveAttribute("aria-current", "page");
    expect(await noHScroll(page)).toBe(true);
    // the panel is under the whole header and over the page: the last link is what is at its own centre
    const last = links.last();
    const box = (await last.boundingBox())!;
    expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest("header nav a"), [box.x + box.width / 2, box.y + box.height / 2])).toBe(true);
  });

  test("Escape closes it and gives the focus back; following a link closes it", async ({ page }) => {
    await page.goto("/graph");
    const button = nav(page).getByRole("button", { name: "Menu" });
    await button.click();
    await expect(nav(page).getByRole("link").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toBeFocused();
    await expect(nav(page).getByRole("link").first()).toBeHidden();

    await button.click();
    await nav(page).getByRole("link", { name: "Tags" }).click();
    await expect(page).toHaveURL(/\/tags\/$/);
    await expect(nav(page).getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
  });

  test("a tap outside closes it", async ({ page }) => {
    await page.goto("/graph");
    const button = nav(page).getByRole("button", { name: "Menu" });
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await page.mouse.click(5, 800); // under the panel (eight entries of 44 px), on the page
    await expect(button).toHaveAttribute("aria-expanded", "false");
  });

  test("the preferences button and the build indicator spot stay in the header row", async ({ page }) => {
    await page.goto("/graph");
    await expect(page.getByRole("banner").getByRole("button", { name: /^(Preferences|Préférences)/ })).toBeVisible();
  });
});
