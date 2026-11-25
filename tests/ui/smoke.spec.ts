import { expect, test } from "./helpers";

// The pages must load, expose their landmarks, and raise no error. Heading texts depend on the wiki (fixture or
// CORTEX_UI_WIKI), so only structure is asserted.
const landmarks = async (page: import("@playwright/test").Page) => {
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
};

test("home", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await landmarks(page);
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Design system" })).toHaveAttribute("href", /design-system\/$/);
});

test("a wiki article", async ({ page }) => {
  // first article link on the home page: works on the fixture and on any wiki
  await page.goto("/");
  const href = await page.locator('main a[href*="/wiki/"]').first().getAttribute("href");
  expect(href, "the home page links to at least one article").toBeTruthy();
  const res = await page.goto(href!);
  expect(res?.status()).toBe(200);
  await landmarks(page);
  await expect(page.locator("main article, main .prose").first()).toBeVisible();
});

test("search with a query", async ({ page }) => {
  const res = await page.goto("/search/?q=alpha");
  expect(res?.status()).toBe(200);
  await landmarks(page);
  await expect(page.getByRole("main").getByRole("combobox")).toHaveValue("alpha");
});

test("the static server answers an unknown path with 404", async ({ request }) => {
  // request-level only: the in-browser 404 page is covered by its own journey
  expect((await request.get("/no/such/page/")).status()).toBe(404);
});
