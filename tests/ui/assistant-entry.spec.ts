import type { Page, Route } from "@playwright/test";
import { expect, test } from "./helpers";

// Entry points to the assistant: the header button, the button in the search fields, the palette item and Ctrl+Enter in the
// field. A static host has no /api/ask, so the server is faked: HEAD says it is there, POSTs are recorded and answered.
const ASK = /Ask the assistant|Demander à l'assistant/;

async function mockAsk(page: Page) {
  const posts: { q: string }[] = [];
  await page.route("**/api/ask", async (route: Route) => {
    const req = route.request();
    if (req.method() === "HEAD") return route.fulfill({ status: 204 });
    posts.push(req.postDataJSON());
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ segments: [{ html: "<p>An answer.</p>" }], md: "An answer.", cited: [], retained: [], related: [] }) });
  });
  return posts;
}

const headerField = (page: Page) => page.getByRole("banner").locator("input[role=combobox]");
const draft = (page: Page) => page.locator("#assistant-q");
const prefs = (page: Page) => page.getByRole("banner").getByRole("button", { name: /^(Preferences|Préférences)/ });

test.describe("desktop 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.skip(({ isMobile }) => isMobile, "keyboard flows: desktop project only");

  test("the header button shows the sparkles icon and its label, and opens and closes the panel", async ({ page }) => {
    await mockAsk(page);
    await page.goto("/graph");
    const toggle = page.locator("#assistant-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText("Assistant");
    await expect(toggle.locator("svg.folio")).toHaveCount(0);
    await expect(toggle.locator("svg use")).toHaveAttribute("href", "#cx-assistant");
    expect((await toggle.locator("svg").boundingBox())?.width).toBe(20);
    await expect(toggle).not.toHaveAttribute("aria-busy", /.*/);
    await expect(toggle).toHaveAttribute("aria-controls", "assistant-panel");
    await expect(toggle).toHaveAttribute("aria-keyshortcuts", "Control+I Meta+I");
    await expect(toggle).toHaveAttribute("title", /Ctrl I/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    // right after the search field, before the preferences
    const [field, btn, theme] = await Promise.all([headerField(page).boundingBox(), toggle.boundingBox(), prefs(page).boundingBox()]);
    expect(btn!.x).toBeGreaterThanOrEqual(field!.x + field!.width);
    expect(btn!.x + btn!.width).toBeLessThan(theme!.x);
    await toggle.click();
    await expect(page.locator("#assistant-panel")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(page.locator("#assistant-panel")).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("the button in the header field opens the panel with the typed text, nothing is sent", async ({ page }) => {
    const posts = await mockAsk(page);
    await page.goto("/graph");
    const field = headerField(page);
    await field.fill("how does context rot happen");
    await expect(page.getByRole("banner").getByRole("button", { name: ASK }).locator("svg use")).toHaveAttribute("href", "#cx-assistant");
    await page.getByRole("banner").getByRole("button", { name: ASK }).click();
    await expect(page.locator("#assistant-panel")).toBeVisible();
    await expect(draft(page)).toHaveValue("how does context rot happen");
    await expect(draft(page)).toBeFocused();
    expect(await draft(page).evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([27, 27]);
    expect(posts).toEqual([]);
    await draft(page).press("Enter");
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].q).toBe("how does context rot happen");
  });

  test("an empty field opens the panel empty", async ({ page }) => {
    const posts = await mockAsk(page);
    await page.goto("/graph");
    await page.getByRole("banner").getByRole("button", { name: ASK }).click();
    await expect(page.locator("#assistant-panel")).toBeVisible();
    await expect(draft(page)).toHaveValue("");
    expect(posts).toEqual([]);
  });

  test("the palette offers the assistant first for a question, by keyboard, without sending", async ({ page }) => {
    const posts = await mockAsk(page);
    await page.goto("/graph");
    const field = headerField(page);
    await field.fill("what is in the wiki about context?");
    const item = page.locator("[role=listbox]").getByRole("option", { name: ASK });
    await expect(item).toBeVisible();
    await expect(item).toContainText("« what is in the wiki about context? »");
    await expect(item.locator("svg use")).toHaveAttribute("href", "#cx-assistant");
    await expect(item).toContainText(/Ctrl (Enter|Entrée)/);
    await field.press("ArrowDown");
    await expect(item).toHaveAttribute("aria-selected", "true");
    await field.press("Enter");
    await expect(page.locator("#assistant-panel")).toBeVisible();
    await expect(draft(page)).toHaveValue("what is in the wiki about context?");
    expect(posts).toEqual([]);
  });

  test("for plain search words the item comes after the suggestions, the first ArrowDown still lands on the search", async ({ page }) => {
    await mockAsk(page);
    await page.goto("/graph");
    const field = headerField(page);
    await field.fill("context");
    const options = page.locator("[role=listbox] [role=option]");
    await expect(page.locator("[role=listbox]").getByRole("option", { name: ASK })).toBeVisible();
    await field.press("ArrowDown");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await expect(options.first()).not.toContainText(ASK);
    // pointing at the item opens the panel with the words as a draft
    await page.locator("[role=listbox]").getByRole("option", { name: ASK }).click();
    await expect(draft(page)).toHaveValue("context");
  });

  for (const path of ["/", "/search"]) {
    test(`the large field of ${path} has its button, with the label`, async ({ page }) => {
      const posts = await mockAsk(page);
      await page.goto(path);
      const field = page.locator("main input[role=combobox]");
      await field.fill("context rot");
      const btn = page.getByRole("main").getByRole("button", { name: ASK });
      await expect(btn).toBeVisible();
      await expect(btn).toContainText(ASK);
      await btn.click();
      await expect(draft(page)).toHaveValue("context rot");
      expect(posts).toEqual([]);
    });
  }

  test("Enter searches as before, Ctrl+Enter sends the typed text to the assistant", async ({ page }) => {
    const posts = await mockAsk(page);
    await page.goto("/graph");
    const field = headerField(page);
    await field.fill("context");
    await field.press("Enter");
    await expect(page).toHaveURL(/\/search\/?\?q=context/);
    expect(posts).toEqual([]);
    await expect(page.locator("#assistant-panel")).toBeHidden();

    await page.goto("/graph");
    await field.fill("context rot");
    await field.press("ArrowDown"); // a highlighted suggestion does not change where Ctrl+Enter goes
    await field.press("Control+Enter");
    await expect(page.locator("#assistant-panel")).toBeVisible();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].q).toBe("context rot");
    await expect(page.locator("#assistant-panel article")).toHaveCount(1);
    await expect(page.locator("#assistant-panel article")).toContainText("An answer.");
    await expect(page).toHaveURL(/\/graph/);
    // empty field: Ctrl+Enter does nothing special
    await field.fill("");
    await field.press("Control+Enter");
    expect(posts.length).toBe(1);
  });

  test("Ctrl+Enter on the home field also reaches the assistant", async ({ page }) => {
    const posts = await mockAsk(page);
    await page.goto("/");
    const field = page.locator("main input[role=combobox]");
    await field.fill("context rot");
    await field.press("Control+Enter");
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].q).toBe("context rot");
  });
});

for (const width of [390, 320]) {
  test.describe(`narrow ${width}`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("the header keeps the assistant by its name, without overflow", async ({ page }) => {
      await mockAsk(page);
      await page.goto("/graph");
      const toggle = page.getByRole("button", { name: "Assistant", exact: true });
      await expect(toggle).toBeVisible();
      // the label collapses: the icon alone shows, the name stays
      expect(((await toggle.boundingBox())?.width ?? 99)).toBeLessThan(56);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const right = await prefs(page).boundingBox();
      expect(right!.x + right!.width).toBeLessThanOrEqual(width);
      await toggle.click();
      await expect(page.locator("#assistant-panel")).toBeVisible();
    });

    test("the home field keeps its assistant button, without overflow", async ({ page }) => {
      await mockAsk(page);
      await page.goto("/");
      await expect(page.getByRole("main").getByRole("button", { name: ASK })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  });
}

test("without /api/ask (static host) no entry point to the assistant renders", async ({ page }) => {
  for (const path of ["/graph", "/", "/search"]) {
    await page.goto(path);
    const field = page.locator("input[role=combobox]").first();
    await field.fill("context");
    // the palette is open on the pages where it lists more than suggestions: it would carry the item
    if (path !== "/search") await expect(field).toHaveAttribute("aria-expanded", "true");
    expect(await page.locator("#assistant-toggle, #assistant-panel").count(), path).toBe(0);
    await expect(page.getByRole("button", { name: ASK })).toHaveCount(0);
    await expect(page.locator("[role=listbox]").getByRole("option", { name: ASK })).toHaveCount(0);
  }
});
