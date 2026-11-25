import { expect, test } from "./helpers";

// Reading paths (/paths/, an article read in a path) and the maintenance page, on the committed fixture (its paths/ folder
// and its pending raw source); a wiki given through CORTEX_UI_WIKI has its own, so these are skipped there.
test.skip(!!process.env.CORTEX_UI_WIKI, "needs the fixture wiki");

const SLUG = "learn-the-fixture";

test("/paths/ lists the paths with their goal and number of steps, and opens one", async ({ page }) => {
  const res = await page.goto("/paths/");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reading paths");
  const row = page.getByRole("main").getByRole("link", { name: /Learn the fixture wiki/ });
  await expect(row).toContainText("Read the fixture wiki from its first concept to its overview.");
  await expect(row).toContainText("3 steps");
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/paths/${SLUG}/$`));
});

test("a path page: goal, introduction, ordered steps with their reason, links that keep the path", async ({ page, request }) => {
  await page.goto(`/paths/${SLUG}/`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Learn the fixture wiki");
  await expect(page.getByRole("main")).toContainText("Read the fixture wiki from its first concept to its overview.");
  await expect(page.getByRole("main")).toContainText("A short itinerary, written for the UI tests.");
  const steps = page.getByRole("list", { name: "Steps of the path" }).getByRole("listitem");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText("where everything starts.");
  await expect(steps.nth(1)).toContainText("builds on Alpha concept and adds the keyword.");
  await expect(steps.nth(1).getByRole("link", { name: "Alpha concept" })).toHaveAttribute("href", /wiki\/concepts\/alpha\/$/); // a link of the reason
  await expect(steps.nth(2)).toContainText("An entity of the fixture wiki."); // no reason written: the page's description stands in
  for (const [i, id] of ["concepts/alpha", "concepts/beta", "entities/gamma"].entries())
    await expect(steps.nth(i).getByRole("link").first()).toHaveAttribute("href", new RegExp(`wiki/${id}/\\?path=${SLUG}$`));
  await expect(page.getByRole("link", { name: "All paths" })).toHaveAttribute("href", /paths\/$/);
  expect((await request.get("/paths/no-such-path/")).status()).toBe(404);
});

test("an article read in a path: step, reason, Previous / Next at the top and at the bottom, along the whole walk", async ({ page }) => {
  await page.goto(`/paths/${SLUG}/`);
  await page.getByRole("link", { name: "Start the path" }).click();
  await expect(page).toHaveURL(new RegExp(`/wiki/concepts/alpha/\\?path=${SLUG}$`));
  const top = page.locator('[data-path-nav="top"]');
  await expect(top).toBeVisible();
  await expect(top.getByRole("link", { name: "Learn the fixture wiki" })).toHaveAttribute("href", new RegExp(`paths/${SLUG}/$`));
  await expect(top).toContainText("Step 1 of 3");
  await expect(top).toContainText("Why here: where everything starts.");
  await expect(top.getByRole("link", { name: /Previous/ })).toHaveCount(0); // first step
  await expect(page.getByRole("navigation", { name: "Path: Learn the fixture wiki", exact: true })).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Continue the path: Learn the fixture wiki" })).toBeVisible();

  await top.getByRole("link", { name: /Next.*Beta concept/ }).click();
  await expect(page).toHaveURL(new RegExp(`/wiki/concepts/beta/\\?path=${SLUG}$`));
  await expect(top).toContainText("Step 2 of 3");
  await expect(top.getByRole("link", { name: /Previous.*Alpha concept/ })).toBeVisible();
  // the bottom one is the same way on, reachable after the text
  await page.locator('[data-path-nav="bottom"]').getByRole("link", { name: /Next.*Gamma entity/ }).click();
  await expect(page).toHaveURL(new RegExp(`/wiki/entities/gamma/\\?path=${SLUG}$`));
  await expect(top).toContainText("Step 3 of 3");
  await expect(top.getByRole("link", { name: /Next/ })).toHaveCount(0); // last step
  await top.getByRole("link", { name: /Previous.*Beta concept/ }).click();
  await expect(top).toContainText("Step 2 of 3");
});

test("an article opened without a path, with an unknown one, or outside the path, shows no path navigation", async ({ page }) => {
  for (const url of ["/wiki/concepts/alpha/", `/wiki/concepts/alpha/?path=nope`, `/wiki/syntheses/overview/?path=${SLUG}`]) {
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("[data-path-nav]")).toHaveCount(0);
  }
});

test("/maintenance/: four blocks with their explanation and command; raw sources as a count only, never a title", async ({ page }) => {
  const res = await page.goto("/maintenance/");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wiki status");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([/Raw sources to compile/, /Orphan pages/, /Missing links/, /Content to review/]);
  const raw = page.getByRole("region", { name: "Raw sources to compile" });
  await expect(raw).toContainText("1 raw source is waiting to be compiled.");
  await expect(raw.locator("code")).toHaveText("cortex compile --pending");
  await expect(raw).toContainText("only their number is published");
  await expect(page.getByRole("main")).toContainText("1 block out of 4 calls for action.");
  for (const name of ["Orphan pages", "Missing links", "Content to review"]) await expect(page.getByRole("region", { name })).toContainText("Nothing to report.");
  expect(await page.content()).not.toContain("Pending private title");
  // the same facts, read without the page: the data files the export publishes carry no raw title either
  for (const file of ["/paths.json", "/footer.json"]) expect(await (await page.request.get(file)).text()).not.toContain("Pending private title");
});

test("the journal page links to the maintenance page", async ({ page }) => {
  await page.goto("/log/");
  await page.getByRole("main").getByRole("link", { name: "Wiki status" }).click();
  await expect(page).toHaveURL(/\/maintenance\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wiki status");
});
