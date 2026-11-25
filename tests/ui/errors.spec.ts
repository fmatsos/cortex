import { expect, test } from "./helpers";

// The error page (site/src/routes/+error.svelte) must render for an unknown address, both when the static host serves
// 404.html (no layout data on that fallback) and when the client router reaches the address. Its search box and quick
// links are scoped to <main>: the header carries its own search box on these pages.
// The unknown address itself answers 404 (the document and its __data.json): that is the journey, not a failure.
const allowUnknownAddress404 = (errors: string[]) => {
  const kept = errors.filter((e) => !(e.includes("status of 404") && e.includes("/no/such/page/")));
  errors.splice(0, errors.length, ...kept);
};

const errorPage = async (page: import("@playwright/test").Page) => {
  await expect(page.locator("#error-title")).toBeVisible();
  await expect(page.locator("#error-title")).not.toBeEmpty();
  await expect(page.getByRole("main").getByRole("combobox")).toBeVisible();
  for (const to of ["tags/", "log/", "graph/", "/"]) {
    await expect(page.getByRole("main").locator(`a[href$="${to}"]`).first()).toBeVisible();
  }
};

test("a direct load of an unknown address answers 404 with the error page", async ({ page, errors }) => {
  const res = await page.goto("/no/such/page/");
  expect(res?.status()).toBe(404);
  await errorPage(page);
  allowUnknownAddress404(errors);
});

test("client-side navigation to an unknown address shows the error page", async ({ page, errors }) => {
  await page.goto("/");
  // a plain internal link, clicked: the site's router handles it without a full load
  await page.evaluate(() => {
    const a = document.createElement("a");
    a.href = "/no/such/page/";
    a.id = "unknown-link";
    a.textContent = "unknown";
    document.body.append(a);
  });
  await page.locator("#unknown-link").click();
  await expect(page).toHaveURL(/\/no\/such\/page\/$/);
  await errorPage(page);
  allowUnknownAddress404(errors);
});
