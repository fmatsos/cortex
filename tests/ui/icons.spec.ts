import { expect, test } from "./helpers";
import { ICON_NAMES } from "../../site/src/lib/icons";

// The icon pack is Phosphor Light: filled shapes painted with currentColor, no stroke. Checked on the real rendered page.
test("the header renders Phosphor Light icons: filled with currentColor, no stroke", async ({ page }) => {
  await page.goto("/");
  const icon = page.getByRole("banner").locator("svg:has(use):visible").first();
  await expect(icon).toBeVisible();
  const box = await icon.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);
  const style = await icon.evaluate((el) => {
    const s = getComputedStyle(el);
    const u = getComputedStyle(el.querySelector("use")!);
    return { viewBox: el.getAttribute("viewBox"), fill: s.fill === s.color, stroke: s.stroke, useFill: u.fill === s.color };
  });
  expect(style).toEqual({ viewBox: "0 0 256 256", fill: true, stroke: "none", useFill: true });
});

// One inline sprite per document, holding only the symbols that document uses; each icon instance is a `<use>` of a
// symbol that exists exactly once.
const ARTICLE = "/wiki/sources/source-one/";
type Pg = import("@playwright/test").Page;

const unresolved = (page: Pg) =>
  page.evaluate(() => [...document.querySelectorAll('use[href^="#cx-"]')].map((u) => u.getAttribute("href")!).filter((h) => !document.querySelector(h)));
const duplicates = (page: Pg) =>
  page.evaluate(() => {
    const ids = [...document.querySelectorAll("symbol")].map((s) => s.id);
    return ids.filter((id, i) => ids.indexOf(id) !== i);
  });

// The names an HTML document references, and those its sprite defines, read from the raw response (before any script).
const used = (html: string) => [...new Set([...html.matchAll(/<use href="#(cx-[\w-]+)"/g)].map((m) => m[1]))].sort();
const defined = (html: string) => {
  const sprite = /<svg[^>]*\bid="cx-sprite"[^>]*>(.*?)<\/svg>/s.exec(html)?.[1] ?? "";
  return [...sprite.matchAll(/<symbol id="(cx-[\w-]+)"/g)].map((m) => m[1]).sort();
};

for (const path of ["/", ARTICLE]) {
  test(`${path}: the served document carries exactly the symbols it uses`, async ({ request }) => {
    const html = await (await request.get(path)).text();
    expect(used(html).length).toBeGreaterThan(0);
    expect(defined(html)).toEqual(used(html));
    expect(defined(html).length, "a subset of the pack, not all of it").toBeLessThan(ICON_NAMES.length);
    expect(html.match(/id="cx-sprite"/g)?.length, "one sprite per document").toBe(1);
  });
}

test("the sprite is embedded once, hydration leaves it alone and every use resolves to a symbol", async ({ page, request }) => {
  const raw = await (await request.get(ARTICLE)).text();
  const res = await page.goto(ARTICLE);
  expect(res?.status()).toBe(200);
  await expect(page.locator("#cx-search")).toHaveCount(1);
  expect(await page.locator("#cx-sprite").count()).toBe(1);
  expect(await duplicates(page), "duplicate symbol ids").toEqual([]);
  expect(await unresolved(page), "use references without a symbol").toEqual([]);
  expect(await page.locator('use[href^="#cx-"]').count()).toBeGreaterThan(0);
  // what hydration may add is only what the raw page could not know; it never drops a symbol
  const ids = await page.evaluate(() => [...document.querySelectorAll("#cx-sprite > symbol")].map((s) => s.id).sort());
  expect(ids).toEqual(expect.arrayContaining(defined(raw)));
  expect(ids.length).toBeLessThan(ICON_NAMES.length);
  // the sprite is a direct child of <body>, zero-size and out of flow, not display:none
  expect(await page.evaluate(() => document.getElementById("cx-sprite")!.parentElement === document.body)).toBe(true);
  const box = await page.locator("#cx-sprite").evaluate((el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return { w: r.width, h: r.height, display: s.display, position: s.position }; });
  expect({ w: box.w, h: box.h, position: box.position }).toEqual({ w: 0, h: 0, position: "absolute" });
  expect(box.display).not.toBe("none");
});

test("client navigation from home to an article with callouts: every use resolves, callouts are painted", async ({ page }) => {
  await page.goto("/");
  const before = await page.locator("#cx-sprite > symbol").count();
  // no home link leads to this article: reach it through the search field, which navigates on the client
  const field = page.getByRole("main").getByRole("combobox");
  await expect(async () => {
    await field.fill("Source one");
    await page.getByRole("option", { name: /Source one/ }).first().click({ timeout: 1000 });
  }).toPass();
  await expect(page).toHaveURL(/\/wiki\/sources\/source-one\//);
  for (const cls of ["personal-note", "callout-warning"]) await expect(page.locator(`.wiki .${cls} svg.callout-icon`)).toBeVisible();
  await expect.poll(() => unresolved(page), { message: "use references without a symbol after navigation" }).toEqual([]);
  expect(await duplicates(page)).toEqual([]);
  expect(await page.locator("#cx-sprite").count()).toBe(1);
  expect(await page.locator("#cx-sprite > symbol").count(), "the callout symbols were added to the sprite").toBeGreaterThanOrEqual(before);
  for (const id of ["cx-note", "cx-warning"]) await expect(page.locator(`#${id}`)).toHaveCount(1);
  // painted for real: the fill reaches the symbol and the instance has a size
  for (const cls of ["personal-note", "callout-warning"]) {
    const icon = page.locator(`.wiki .${cls} svg.callout-icon`);
    const box = await icon.boundingBox();
    expect(box?.width).toBeGreaterThan(8);
    expect(await icon.evaluate((el) => getComputedStyle(el.querySelector("use")!).fill)).not.toBe("none");
  }
});

test("the search palette shows icons that resolve", async ({ page }) => {
  await page.goto(ARTICLE);
  const list = page.getByRole("listbox");
  // the shortcut only exists once the page is hydrated: press it until the palette answers
  await expect(async () => {
    await page.keyboard.press("Control+k");
    await expect(list).toBeVisible({ timeout: 500 });
  }).toPass();
  const icons = list.locator('use[href^="#cx-"]');
  await expect.poll(() => icons.count()).toBeGreaterThan(0);
  await expect.poll(() => unresolved(page), { message: "palette icons without a symbol" }).toEqual([]);
  expect(await duplicates(page)).toEqual([]);
  const box = await list.locator("svg").first().boundingBox();
  expect(box?.width).toBeGreaterThan(0);
});

test("a header icon, drawn from the sprite, has a real size and is visible", async ({ page }) => {
  await page.goto(ARTICLE);
  const icon = page.getByRole("banner").locator("svg:has(use):visible").first();
  await expect(icon).toBeVisible();
  const box = await icon.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);
  // the fill (currentColor) lives on the instance and reaches the symbol through <use>
  const painted = await icon.evaluate((el) => getComputedStyle(el.querySelector("use")!).fill);
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

test("the 404 page builds its sprite on the client and renders its icons", async ({ page, errors }) => {
  const res = await page.goto("/no/such/page/");
  expect(res?.status()).toBe(404);
  await expect(page.locator("#cx-search")).toHaveCount(1);
  const icon = page.getByRole("banner").locator("svg:has(use):visible").first();
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
