import { ICON_NAMES } from "../../site/src/lib/icons";
import { expect, test } from "./helpers";

// The style guide at /design-system/ is the owner's validation gate: it shows the real tokens and components. These tests
// check that it renders without error and that what it shows obeys the square contract, on the rendered page.
const URL = "/design-system/";

// Components that still carry the old language and that a later task restyles (C17 rewrites chip-button). They are shown
// as they are today; the square-contract test lists them explicitly so a new offender cannot hide behind them, and the
// test below fails the day one of them is fixed, so the entry gets removed.
const PENDING_SQUARE = [".chip"];

test("the page loads with one h1, its landmarks and no error", async ({ page }) => {
  const res = await page.goto(URL);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Design system");
  await expect(page.getByRole("main")).toBeVisible();
  for (const id of ["couleurs", "typographie", "formes", "icones", "composants", "marque"]) await expect(page.locator(`section#${id} > h2`)).toBeVisible();
});

test("every icon of the pack is shown and every use resolves to its symbol", async ({ page }) => {
  await page.goto(URL);
  for (const name of ICON_NAMES) await expect(page.locator(`[data-icon="${name}"]`)).toHaveCount(1);
  const unresolved = await page.evaluate(() =>
    [...document.querySelectorAll('use[href^="#cx-"]')].map((u) => u.getAttribute("href")!).filter((h) => !document.querySelector(h)),
  );
  expect(unresolved, "use references without a symbol").toEqual([]);
  expect(await page.locator("#cx-sprite").count()).toBe(1);
  // the callouts of the prose sample draw their icon from the sprite, like an exported article
  for (const cls of ["personal-note", "callout-warning"]) await expect(page.locator(`.wiki .${cls} svg.callout-icon`)).toBeVisible();
});

test("both palettes are shown, with contrast ratios computed from the tokens", async ({ page }) => {
  await page.goto(URL);
  const light = page.locator('[data-panel="light"]'), dark = page.locator('[data-panel="dark"]');
  expect(await light.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(245, 242, 235)");
  expect(await dark.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(23, 28, 27)");
  // the figures documented in docs/UI-REDESIGN.md
  await expect(light.locator('[data-token="--foreground"]')).toContainText("12,89:1");
  await expect(dark.locator('[data-token="--foreground"]')).toContainText("13,92:1");
  await expect(light.locator('[data-token="--primary-foreground"]')).toContainText("8,18:1");
  await expect(dark.locator('[data-token="--primary-foreground"]')).toContainText("8,50:1");
  // a token swatch of each palette carries its own colour, whatever the site theme
  const bg = (panel: typeof light) => panel.locator('[data-token="--primary"] span').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await bg(light)).toBe("rgb(36, 88, 73)");
  expect(await bg(dark)).toBe("rgb(163, 203, 185)");
  // text tokens of both palettes reach AA: no row reports a ratio under 4,5:1
  await expect(page.locator('#couleurs [data-token]:has-text("sous 4,5:1")')).toHaveCount(0);
});

// Every rendered element of the page's main (the closed menu included), SVG internals excepted: the four computed radii
// are 0 and nothing casts a shadow. Computed, not read from the source, so a portal or a stylesheet cannot slip through.
test("no element of the page has a radius or a shadow", async ({ page }) => {
  await page.goto(URL);
  const bad = await page.evaluate((pending) => {
    const out: { sel: string; radius: string; shadow: string; pending: boolean }[] = [];
    const corners = ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"] as const;
    for (const el of document.querySelectorAll("main *")) {
      if (el.closest("svg")) continue;
      const s = getComputedStyle(el);
      const radius = corners.map((c) => s[c]).filter((v) => v !== "0px").join(" ");
      const shadow = s.boxShadow !== "none" ? s.boxShadow : "";
      if (!radius && !shadow) continue;
      out.push({ sel: `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ").join(".") : ""}`, radius, shadow, pending: pending.some((p) => el.matches(p)) });
    }
    return { sampled: document.querySelectorAll("main *").length, out };
  }, PENDING_SQUARE);
  expect(bad.sampled).toBeGreaterThan(500);
  expect(bad.out.filter((o) => !o.pending), "elements with a radius or a shadow").toEqual([]);
  expect(bad.out.filter((o) => o.shadow), "shadows").toEqual([]);
  // the known gap: remove the entry (and this assertion) when the chip is square
  expect(bad.out.filter((o) => o.pending).length, "PENDING_SQUARE entries are still round: drop the fixed ones").toBeGreaterThan(0);
});

test("the focus ring is a 2 px rectangle offset by 2 px", async ({ page }) => {
  await page.goto(URL);
  const demo = page.locator("#focus-demo");
  // tab from the top of the page until the demo button holds the focus (a plain loop: each Tab moves on by one stop)
  let at = "";
  for (let i = 0; i < 200 && at !== "focus-demo"; i++) {
    await page.keyboard.press("Tab");
    at = await page.evaluate(() => document.activeElement?.id ?? "");
  }
  expect(at).toBe("focus-demo");
  const ring = await demo.evaluate((el) => { const s = getComputedStyle(el); return { w: s.outlineWidth, o: s.outlineOffset, style: s.outlineStyle, color: s.outlineColor, bg: getComputedStyle(document.documentElement).getPropertyValue("--ring") }; });
  expect({ w: ring.w, o: ring.o, style: ring.style }).toEqual({ w: "2px", o: "2px", style: "solid" });
  expect(ring.color).not.toBe("rgba(0, 0, 0, 0)");
});

// The page is hydrated once its root says so: the keyboard handlers only exist after that.
const hydrated = (page: import("@playwright/test").Page) => expect(page.locator("[data-ready=true]")).toHaveCount(1);

test("the dropdown menu opens on click and closes with Escape, and works from the keyboard", async ({ page }) => {
  await page.goto(URL);
  await hydrated(page);
  const trigger = page.locator("#menu-demo"), menu = page.getByRole("menu");
  await expect(menu).toBeHidden();

  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const items = menu.locator('[role^="menuitem"]');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(items.last()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  // from the trigger: ArrowDown opens on the first item, Enter on a choice selects it and closes
  await page.keyboard.press("ArrowDown");
  await expect(menu).toBeVisible();
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator("#c-menu + div code").first()).toHaveText("light");

  // ArrowUp opens on the last item
  await page.keyboard.press("ArrowUp");
  await expect(menu).toBeVisible();
  await expect(items.last()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});

test("tabs switch with the arrow keys, both variants", async ({ page }) => {
  await page.goto(URL);
  await hydrated(page);
  for (const [label, names] of [["Onglets segmentés", ["Lire", "Sources", "Liens"]], ["Onglets soulignés", ["Résumé", "Détail"]]] as const) {
    const list = page.getByRole("tablist", { name: label });
    const tab = (n: string) => list.getByRole("tab", { name: n });
    await tab(names[0]).click();
    await expect(tab(names[0])).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(tab(names[1])).toBeFocused();
    await expect(tab(names[1])).toHaveAttribute("aria-selected", "true");
    await expect(tab(names[0])).toHaveAttribute("aria-selected", "false");
    // the panel follows the selected tab
    await expect(page.getByRole("tabpanel", { name: names[1] })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: names[0], includeHidden: true })).toBeHidden();
    await page.keyboard.press("ArrowLeft");
    await expect(tab(names[0])).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(tab(names.at(-1)!)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight"); // wraps around, the disabled tab is skipped
    await expect(tab(names[0])).toBeFocused();
  }
});
