import { ICON_NAMES } from "../../site/src/lib/icons";
import { expect, test } from "./helpers";

// The style guide at /design-system/ is the owner's validation gate: it shows the real tokens and components. These tests
// check that it renders without error and that what it shows obeys the square contract, on the rendered page.
const URL = "/design-system/";
// The fixture export has no `language`, so the site defaults to English; the checks that read French labels and French
// number formats pin the visitor's choice (what the preferences menu stores) before the page loads, then wait for the
// remount the language switch causes (the layout re-renders its content under the new language) so no locator holds a
// node of the English render.
const inFrench = async (page: import("@playwright/test").Page) => {
  await page.addInitScript(() => localStorage.setItem("cortex:lang", "fr"));
  await page.goto(URL);
  await expect(page.locator("section#couleurs > h2")).toHaveText("Couleurs");
};

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

test("fonts: Inter for the interface, Hauora Sans for editorial headings, Source Serif 4 for prose, Cascadia Code for code, all loaded", async ({ page }) => {
  await page.goto(URL);
  const code = page.locator("main code").first();
  await expect(code).toHaveCSS("font-family", /^"Cascadia Code"/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("font-family", /^Inter,/);
  await expect(page.locator("main .wiki h2").first()).toHaveCSS("font-family", /^"Hauora Sans"/);
  await expect(page.locator("main .wiki p").first()).toHaveCSS("font-family", /^"Source Serif 4"/);
  await page.evaluate(() => document.fonts.ready);
  for (const font of ['14px "Cascadia Code"', '16px Inter', '600 16px "Hauora Sans"', '16px "Source Serif 4"']) {
    expect(await page.evaluate((f) => document.fonts.check(f, "x != y"), font), font).toBe(true);
  }
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
  await inFrench(page);
  const light = page.locator('[data-panel="light"]'), dark = page.locator('[data-panel="dark"]');
  expect(await light.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
  expect(await dark.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(23, 28, 27)");
  // the figures documented in docs/UI-REDESIGN.md
  await expect(light.locator('[data-token="--foreground"]')).toContainText("16,34:1");
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
// are 0 and the only shadows are the floating layers' --shadow-overlay (popover, menu, dialog, and the static sample marked
// data-floating) and the light relief --shadow-surface of the in-page surfaces. Computed, not read from the source, so a
// portal or a stylesheet cannot slip through.
const FLOATING = '[popover], dialog, [role="menu"], [role="dialog"], [data-floating]';
test("no element of the page has a radius or a shadow", async ({ page }) => {
  await page.goto(URL);
  const bad = await page.evaluate(([pending, floating]) => {
    const probe = document.createElement("i");
    probe.style.boxShadow = "var(--shadow-surface)";
    document.body.append(probe);
    const surface = getComputedStyle(probe).boxShadow;
    probe.remove();
    const out: { sel: string; radius: string; shadow: string; pending: boolean }[] = [];
    const corners = ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"] as const;
    for (const el of document.querySelectorAll("main *")) {
      if (el.closest("svg")) continue;
      const s = getComputedStyle(el);
      const radius = corners.map((c) => s[c]).filter((v) => v !== "0px").join(" ");
      const shadow = s.boxShadow !== "none" && !s.boxShadow.endsWith(surface) && !el.matches(floating) ? s.boxShadow : "";
      if (!radius && !shadow) continue;
      out.push({ sel: `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ").join(".") : ""}`, radius, shadow, pending: pending.some((p) => el.matches(p)) });
    }
    return { sampled: document.querySelectorAll("main *").length, out };
  }, [PENDING_SQUARE, FLOATING] as const);
  expect(bad.sampled).toBeGreaterThan(500);
  expect(bad.out.filter((o) => !o.pending), "elements with a radius or a shadow").toEqual([]);
  expect(bad.out.filter((o) => o.shadow), "shadows").toEqual([]);
  // the known gap: remove the entry (and this assertion) when the chip is square
  expect(bad.out.filter((o) => o.pending).length, "PENDING_SQUARE entries are still round: drop the fixed ones").toBeGreaterThan(0);
});

const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
test("the floating layer sample and the menu carry the overlay shadow, the cards a lighter relief", async ({ page }) => {
  await page.goto(URL);
  const shadow = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).boxShadow);
  const token = (name: string) => page.evaluate((n) => { const i = document.createElement("i"); i.style.boxShadow = `var(${n})`; document.body.append(i); const v = getComputedStyle(i).boxShadow; i.remove(); return v; }, name);
  const overlay = await token("--shadow-overlay"), surface = await token("--shadow-surface");
  expect(overlay).not.toBe("none");
  expect(surface).not.toBe("none");
  expect(surface).not.toBe(overlay);
  // a Tailwind shadow utility lists its (transparent) ring layers first, then the token's own
  expect(await shadow("[data-floating]")).toMatch(new RegExp(`${esc(overlay)}$`));
  expect(await shadow('[data-slot="dropdown-menu-content"]')).toMatch(new RegExp(`${esc(overlay)}$`));
  const card = await shadow('[data-slot="card"]');
  expect(card.endsWith(surface) && !card.endsWith(overlay)).toBe(true);
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
  await inFrench(page);
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

// The page follows the interface language, switched from the preferences menu without a reload: the h1 keeps its name,
// the section headings, a sentence with inline code and the computed ratios change, and no dictionary key shows raw.
test("the page follows the interface language, in English and back in French", async ({ page }) => {
  await page.goto(URL);
  await hydrated(page);
  const lang = (name: string) => page.getByRole("menuitemradio", { name, exact: true });
  const preferences = page.getByRole("banner").getByRole("button", { name: /^(Préférences|Preferences)$/ });
  await preferences.click();
  await lang("English").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Design system");
  await expect(page).toHaveTitle("Design system · Cortex");
  await expect(page.locator("section#couleurs > h2")).toHaveText("Colors");
  await expect(page.locator("section#marque > h2")).toHaveText("Brand and avatar");
  await expect(page.getByRole("navigation", { name: "Page sections" })).toBeVisible();
  await expect(page.locator("section#couleurs > p").first()).toContainText("The ratio is computed against the background of its pair");
  // numbers follow the locale too: a decimal point, English grades
  await expect(page.locator('[data-panel="light"] [data-token="--foreground"]')).toContainText("16.34:1");
  await expect(page.locator('#couleurs [data-token]:has-text("below 4.5:1")')).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "Segmented tabs" })).toBeVisible();
  // inline code stays code inside a translated sentence, and no `ds.` key (or backtick) leaks into the text
  await expect(page.locator("#formes p code", { hasText: "--shadow-overlay" }).first()).toBeVisible();
  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/\bds\.[a-z]+\.[\w.]+/);
  expect(body).not.toContain("`");
  expect(body).not.toMatch(/\{\w+\}/);
  expect(body).not.toContain("Couleurs");
  // and back to French, still without a reload
  await preferences.click();
  await lang("Français").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.locator("section#couleurs > h2")).toHaveText("Couleurs");
  await expect(page.locator('[data-panel="light"] [data-token="--foreground"]')).toContainText("16,34:1");
});

test("the dialog is a native modal: square, floating-layer shadow and edge, Escape closes it and the focus returns", async ({ page }) => {
  await page.goto(URL);
  const open = page.locator("#dialog-demo");
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Dialog title" });
  await expect(dialog).toBeVisible();
  const look = await dialog.evaluate((el) => {
    const color = (token: string) => { const d = document.createElement("div"); d.style.color = `var(${token})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; };
    const s = getComputedStyle(el);
    return { radius: s.borderTopLeftRadius, shadow: s.boxShadow, border: s.borderTopColor, input: color("--input") };
  });
  expect(look.radius).toBe("0px");
  expect(look.shadow).not.toBe("none");
  expect(look.border).toBe(look.input);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
});
