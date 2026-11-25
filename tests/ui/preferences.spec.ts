import type { Page, Route } from "@playwright/test";
import { expect, test } from "./helpers";

// The header's preferences menu: theme, interface language and offline status in one native dropdown menu, and the header
// room that frees for the search field. The assistant is faked (a static host has no /api/ask) where the header carries it.
const PREFS = /^(Preferences|Préférences)/;

async function mockAsk(page: Page) {
  await page.route("**/api/ask", (route: Route) => route.fulfill({ status: 204 }));
}

const trigger = (page: Page) => page.getByRole("banner").getByRole("button", { name: PREFS });
const menu = (page: Page) => page.getByRole("menu");
const noHScroll = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth);

test.describe("menu", () => {
  test.skip(({ isMobile }) => isMobile, "keyboard and pointer flows: desktop project only");
  test.use({ viewport: { width: 1440, height: 900 } });

  test("opens with Enter and ArrowDown, and with the mouse; Escape closes it and gives the focus back", async ({ page }) => {
    await page.goto("/graph");
    const btn = trigger(page);
    await expect(btn).toHaveAttribute("aria-haspopup", "menu");
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await expect(menu(page)).toBeHidden();

    await btn.focus();
    await page.keyboard.press("Enter");
    await expect(menu(page)).toBeVisible();
    await expect(btn).toHaveAttribute("aria-expanded", "true");
    await expect(menu(page).getByRole("menuitemradio").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeHidden();
    await expect(btn).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole("menuitemradio").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu(page).getByRole("menuitemradio").nth(1)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(btn).toBeFocused();

    await btn.click();
    await expect(menu(page)).toBeVisible();
    // two radio groups (theme, language), each named by its label, and the offline section
    await expect(menu(page).getByRole("group", { name: /^(Theme|Thème)$/ }).getByRole("menuitemradio")).toHaveCount(3);
    await expect(menu(page).getByRole("group", { name: /^(Language|Langue)$/ }).getByRole("menuitemradio")).toHaveCount(3);
    await expect(menu(page).getByRole("group", { name: /^(Offline mode|Mode hors ligne)$/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeHidden();
    await expect(btn).toBeFocused();
  });

  test("a click outside closes it", async ({ page }) => {
    await page.goto("/graph");
    await trigger(page).click();
    await expect(menu(page)).toBeVisible();
    await page.mouse.click(5, 600);
    await expect(menu(page)).toBeHidden();
  });

  test("Sombre sets data-theme=dark and survives a reload; Système removes it", async ({ page }) => {
    await page.goto("/graph");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
    await trigger(page).click();
    await menu(page).getByRole("menuitemradio", { name: /^(Dark|Sombre)$/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(menu(page)).toBeHidden();
    await expect(trigger(page)).toBeFocused();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await trigger(page).click();
    await expect(menu(page).getByRole("menuitemradio", { name: /^(Dark|Sombre)$/ })).toHaveAttribute("aria-checked", "true");
    await menu(page).getByRole("menuitemradio", { name: /^(System|Système)$/ }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  });

  test("the language changes the page language and the labels, and the focus returns to the trigger", async ({ page }) => {
    await page.goto("/graph");
    const lang = (name: string | RegExp) => menu(page).getByRole("menuitemradio", { name, exact: typeof name === "string" });
    await trigger(page).click();
    await lang("Français").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByRole("navigation").first().getByRole("link", { name: "Recherche", exact: true })).toBeVisible();
    await expect(trigger(page)).toHaveText("Préférences");
    await expect(trigger(page)).toBeFocused();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await trigger(page).click();
    await expect(lang("Français")).toHaveAttribute("aria-checked", "true");
    await lang("English").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("navigation").first().getByRole("link", { name: "Search", exact: true })).toBeVisible();
    await expect(trigger(page)).toHaveText("Preferences");
    // the default entry names the export's language
    await trigger(page).click();
    await expect(lang(/^(Default|Par défaut) \(/)).toBeVisible();
  });

  test("without a service worker the offline section says so, without a floating button", async ({ page }) => {
    await page.goto("/graph");
    await trigger(page).click();
    const section = menu(page).getByRole("group", { name: /^(Offline mode|Mode hors ligne)$/ });
    await expect(section).toBeVisible();
    await expect(section.locator("dl")).toContainText(/online|en ligne/);
    // no permanent floating control: the only fixed element is the (hidden) toast
    await page.keyboard.press("Escape");
    expect(await page.locator("body button").evaluateAll((els) => els.filter((e) => getComputedStyle(e).position === "fixed").length)).toBe(0);
  });
});

// header room: the search field gets the width the two selects used to take
for (const withAssistant of [false, true]) {
  test.describe(withAssistant ? "with the assistant" : "static host", () => {
    test("the header search field is at least 240 px wide at 1440, beside the assistant and the preferences", async ({ page }) => {
      test.skip(test.info().project.name === "mobile", "wide layout: desktop project only");
      await page.setViewportSize({ width: 1440, height: 900 });
      if (withAssistant) await mockAsk(page);
      await page.goto("/graph");
      if (withAssistant) await expect(page.locator("#assistant-toggle")).toBeVisible();
      const field = await page.getByRole("banner").locator("input[role=combobox]").boundingBox();
      expect(field!.width).toBeGreaterThanOrEqual(240);
      const pref = (await trigger(page).boundingBox())!;
      expect(pref.x).toBeGreaterThanOrEqual(field!.x + field!.width);
      if (withAssistant) {
        const btn = (await page.locator("#assistant-toggle").boundingBox())!;
        expect(btn.x).toBeGreaterThanOrEqual(field!.x + field!.width);
        expect(btn.x + btn.width).toBeLessThanOrEqual(pref.x);
      }
      // the label shows at this width
      await expect(trigger(page)).toHaveText(PREFS);
      expect((await trigger(page).locator("span").first().boundingBox())!.width).toBeGreaterThan(8);
    });

    for (const width of [320, 390, 768, 1280, 1440]) {
      test(`no horizontal scroll at ${width}, menu inside the screen`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        if (withAssistant) await mockAsk(page);
        for (const path of ["/graph", "/"]) {
          await page.goto(path);
          if (withAssistant) await expect(page.locator("#assistant-toggle")).toBeVisible();
          expect(await noHScroll(page), `${path} at ${width}`).toBe(true);
          const right = (await trigger(page).boundingBox())!;
          expect(right.x + right.width).toBeLessThanOrEqual(width);
          expect(right.x).toBeGreaterThanOrEqual(0);
        }
        await trigger(page).click();
        await expect(menu(page)).toBeVisible();
        const box = (await menu(page).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(await noHScroll(page)).toBe(true);
      });
    }
  });
}
