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

// One inline sprite per document: each icon instance is a `<use>` of a symbol that exists exactly once.
const ARTICLE = "/wiki/sources/source-one/";

test("the sprite is embedded once and every use resolves to a symbol", async ({ page }) => {
  const res = await page.goto(ARTICLE);
  expect(res?.status()).toBe(200);
  await expect(page.locator("#cx-search")).toHaveCount(1);
  const dup = await page.evaluate(() => {
    const ids = [...document.querySelectorAll("symbol")].map((s) => s.id);
    return ids.filter((id, i) => ids.indexOf(id) !== i);
  });
  expect(dup, "duplicate symbol ids").toEqual([]);
  const missing = await page.evaluate(() =>
    [...document.querySelectorAll('use[href^="#cx-"]')].map((u) => u.getAttribute("href")!).filter((h) => !document.querySelector(h)),
  );
  expect(missing, "use references without a symbol").toEqual([]);
  expect(await page.locator('use[href^="#cx-"]').count()).toBeGreaterThan(0);
  // the sprite is zero-size and out of flow, not display:none
  const sprite = page.locator("svg:has(> symbol)").first();
  const box = await sprite.evaluate((el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return { w: r.width, h: r.height, display: s.display, position: s.position }; });
  expect({ w: box.w, h: box.h, position: box.position }).toEqual({ w: 0, h: 0, position: "absolute" });
  expect(box.display).not.toBe("none");
});

test("a header icon, drawn from the sprite, has a real size and is visible", async ({ page }) => {
  await page.goto(ARTICLE);
  const icon = page.getByRole("banner").locator("nav svg").first();
  await expect(icon).toBeVisible();
  const box = await icon.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);
  // the stroke contract lives on the instance and reaches the symbol through <use>
  const painted = await icon.evaluate((el) => getComputedStyle(el.querySelector("use")!).stroke);
  expect(painted).not.toBe("none");
});

test("the callouts of an article draw their icon from the sprite", async ({ page }) => {
  await page.goto(ARTICLE);
  for (const [cls, symbol] of [["personal-note", "cx-note"], ["callout-warning", "cx-warning"]] as const) {
    const icon = page.locator(`.wiki .${cls} svg.callout-icon`);
    await expect(icon).toHaveCount(1);
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute("aria-hidden", "true");
    await expect(icon.locator("use")).toHaveAttribute("href", `#${symbol}`);
    const box = await icon.boundingBox();
    expect(box?.width).toBeGreaterThan(8);
    expect(box?.height).toBeGreaterThan(8);
  }
});

test("the 404 page has the sprite and renders its icons", async ({ page, errors }) => {
  const res = await page.goto("/no/such/page/");
  expect(res?.status()).toBe(404);
  await expect(page.locator("#cx-search")).toHaveCount(1);
  const icon = page.getByRole("banner").locator("nav svg").first();
  await expect(icon).toBeVisible();
  const box = await icon.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  const missing = await page.evaluate(() =>
    [...document.querySelectorAll('use[href^="#cx-"]')].map((u) => u.getAttribute("href")!).filter((h) => !document.querySelector(h)),
  );
  expect(missing).toEqual([]);
  // the unknown address itself answers 404 (the document and its __data.json): that is the journey, not a failure
  const kept = errors.filter((e) => !(e.includes("status of 404") && e.includes("/no/such/page/")));
  errors.splice(0, errors.length, ...kept);
});
