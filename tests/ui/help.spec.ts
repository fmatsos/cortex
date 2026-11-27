import type { Page } from "@playwright/test";
import { expect, test } from "./helpers";

// The help page (/help/): a button right after the account / preferences button of the header, a page with sections and a short
// FAQ, in the site language (the fixture wiki has no `language`, so English; French through the remembered language).
const prefs = (page: Page) => page.getByRole("banner").locator("[data-prefs-trigger]");
const helpLink = (page: Page, name: RegExp = /^Help$/) => page.getByRole("banner").getByRole("link", { name });
const noHScroll = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth);

const SECTIONS_EN = ["What this wiki is", "Finding information", "Reading a page", "The assistant", "Favorites, preferences and account", "Following what changes", "Adding content", "Frequently asked questions"];
const SECTIONS_FR = ["Ce qu'est ce wiki", "Trouver une information", "Lire une page", "L'assistant", "Favoris, préférences et compte", "Suivre ce qui change", "Ajouter du contenu", "Questions fréquentes"];

test("header: the help button comes right after the account button, is reachable by keyboard and leads to the help page", async ({ page }) => {
  await page.goto("/");
  const a = (await prefs(page).boundingBox())!, h = (await helpLink(page).boundingBox())!;
  expect(h.x).toBeGreaterThanOrEqual(a.x + a.width - 1); // after it...
  expect(Math.abs(h.y - a.y)).toBeLessThan(a.height / 2); // ...on the same row
  expect(Math.abs(h.height - a.height)).toBeLessThanOrEqual(1); // same size as its neighbour
  await expect(helpLink(page).locator("svg use")).toHaveAttribute("href", "#cx-help");
  await expect(helpLink(page)).not.toHaveAttribute("aria-current", /.*/);

  await prefs(page).focus();
  await page.keyboard.press("Tab");
  await expect(helpLink(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/help\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Help and user guide");
  await expect(helpLink(page)).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveTitle(/^Help and user guide · Cortex$/);
});

test("the page has a title, a table of contents, its sections and a FAQ of seven questions", async ({ page }) => {
  await page.goto("/help/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Help and user guide");
  await expect(page.getByRole("heading", { level: 2, name: "On this page" })).toBeVisible();
  const toc = page.getByRole("navigation", { name: "On this page" });
  await expect(toc.getByRole("link")).toHaveText(SECTIONS_EN);
  const h2 = page.locator(".wiki h2");
  await expect(h2).toHaveText(SECTIONS_EN);
  await expect(page.getByRole("heading", { level: 2, name: "Frequently asked questions" })).toBeVisible();
  expect(await page.locator("#faq ~ h3").count()).toBe(7);
  // every table of contents link leads to a section of the page
  for (const l of await toc.getByRole("link").all()) {
    const id = (await l.getAttribute("href"))!.slice(1);
    await expect(page.locator(`h2#${id}`)).toHaveCount(1);
  }
  await toc.getByRole("link", { name: "Frequently asked questions" }).click();
  await expect(page).toHaveURL(/#faq$/);
  // no dictionary key left bare, no markup symbol left in the text
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/\bhelp\.[a-z]+\.[a-zA-Z.]+/);
  expect(text).not.toMatch(/\*\*/);
  // an in-page link to another page of the site works (the tags page)
  await page.locator(".wiki").getByRole("link", { name: "Tags", exact: true }).click();
  await expect(page).toHaveURL(/\/tags\/$/);
});

test("the page and the header button follow the site language (French)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cortex:lang", "fr"));
  await page.goto("/");
  await expect(helpLink(page, /^Aide$/)).toBeVisible();
  await helpLink(page, /^Aide$/).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aide et mode d'emploi");
  await expect(page.locator(".wiki h2")).toHaveText(SECTIONS_FR);
  await expect(page.getByRole("heading", { level: 2, name: "Questions fréquentes" })).toBeVisible();
  expect(await page.locator("#faq ~ h3").count()).toBe(7);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
});

test("no horizontal overflow, at the project's width and at 320 px, in both languages", async ({ page }) => {
  for (const lang of ["en", "fr"]) {
    await page.addInitScript((l) => localStorage.setItem("cortex:lang", l), lang);
    for (const width of [null, 320]) {
      if (width) await page.setViewportSize({ width, height: 800 });
      await page.goto("/help/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await noHScroll(page), `${lang} ${width ?? "default"}`).toBe(true);
      // the header keeps the help button visible and within the viewport
      const box = (await helpLink(page, /^(Help|Aide)$/).boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
  }
});
