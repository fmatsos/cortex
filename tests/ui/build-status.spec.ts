import type { Page } from "@playwright/test";
import { expect, test } from "./helpers";

// The small "site being rebuilt" indicator (`cortex serve` only). A static host has no /api/status: the page there probes once,
// gets a 404 and shows nothing. Elsewhere the endpoint is faked (`page.route`) and the clock too (`page.clock`), so the 3 s and
// 30 s probe intervals run in no time. Real timers only matter for the network, which is mocked.
test.use({ serviceWorkers: "block" });

const UPDATING = /Mise à jour du site…|Updating the site…/;
const UPDATED = /Site mis à jour|Site updated/;
const RELOAD = /Recharger|Reload/;

/** Moves the fake clock on in small steps, leaving the real time for a probe's answer to come back: the next probe is only planned then. */
const advance = async (page: Page, ms: number, step = 1000) => {
  for (let t = 0; t < ms; t += step) { await page.clock.runFor(Math.min(step, ms - t)); await page.waitForTimeout(20); }
};

/** Stops the clock where it is (it otherwise keeps running with real time): the cadence of the probes can then be measured exactly. */
const freeze = async (page: Page) => page.clock.pauseAt((await page.evaluate(() => Date.now())) + 500);

type Last = { at: string; ok: boolean; ms: number };
/** The fake server: `state` is what the next probe gets, `probes` counts them. */
async function mockStatus(page: Page, state: { building: boolean; last?: Last } = { building: false }) {
  const s = { ...state, probes: 0 };
  await page.route("**/api/status", (route) => {
    s.probes++;
    return route.fulfill({ contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify({ building: s.building, ...(s.building && { since: new Date().toISOString() }), ...(s.last && { last: s.last }) }) });
  });
  return s;
}
const OK: Last = { at: new Date().toISOString(), ok: true, ms: 4200 };
/** What the live region said, one entry per change to a non-empty text (a screen reader reads each of them). */
const recordAnnouncements = (page: Page) => page.addInitScript(() => {
  const said: string[] = [];
  (window as unknown as { __said: string[] }).__said = said;
  addEventListener("DOMContentLoaded", () => {
    const live = document.querySelector("header [role=status]") ?? document.querySelector("[role=status]");
    if (live) new MutationObserver(() => { const t = live.textContent?.trim(); if (t) said.push(t); }).observe(live, { childList: true, characterData: true, subtree: true });
  });
});
const said = (page: Page) => page.evaluate(() => (window as unknown as { __said: string[] }).__said);
const building = (page: Page) => page.locator("[data-build-status=building]");
const updated = (page: Page) => page.locator("[data-build-status=updated]");

test("a static site: one probe, a 404, no indicator and no more probes", async ({ page }) => {
  await page.clock.install();
  const probes: string[] = [];
  page.on("request", (r) => { if (new URL(r.url()).pathname === "/api/status") probes.push(r.method()); });
  await page.goto("/");
  await expect(page.getByRole("banner")).toBeVisible();
  await expect.poll(() => probes.length).toBe(1);
  await advance(page, 180_000, 10_000);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await advance(page, 60_000);
  expect(probes).toEqual(["GET"]);
  await expect(building(page)).toHaveCount(0);
  await expect(updated(page)).toHaveCount(0);
  await expect(page.locator("[role=status]").first()).toHaveText("");
});

test("a server answering a network failure on the first probe is a site without the function: no more probes", async ({ page }) => {
  await page.clock.install();
  let probes = 0;
  await page.route("**/api/status", (route) => { probes++; return route.abort("failed"); });
  await page.goto("/");
  await expect.poll(() => probes).toBe(1);
  await advance(page, 120_000);
  expect(probes).toBe(1);
  await expect(building(page)).toHaveCount(0);
});

test("an idle server: probes every 30 s, nothing shown", async ({ page }) => {
  await page.clock.install();
  const s = await mockStatus(page, { building: false, last: OK });
  await page.goto("/");
  await expect.poll(() => s.probes).toBe(1);
  await freeze(page);
  await advance(page, 29_000);
  expect(s.probes).toBe(1);
  await advance(page, 2_000);
  await expect.poll(() => s.probes).toBe(2);
  await advance(page, 60_000);
  await expect.poll(() => s.probes).toBe(4);
  await expect(building(page)).toHaveCount(0);
  await expect(updated(page)).toHaveCount(0);
});

test("a build running: the dot appears with its tooltip and one announcement, probes every 3 s, then the notice with Reload", async ({ page }) => {
  await page.clock.install();
  await recordAnnouncements(page);
  const s = await mockStatus(page, { building: true });
  await page.goto("/");
  const dot = building(page).getByRole("button", { name: UPDATING });
  await expect(dot).toBeVisible();
  // the tooltip: hidden at rest, shown on hover and on focus, and closed by Escape
  const tip = building(page).locator("[role=tooltip]");
  await expect(tip).toBeHidden();
  await dot.hover();
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(UPDATING);
  await page.mouse.move(0, 400);
  await expect(tip).toBeHidden();
  await dot.focus();
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await expect(dot).toBeFocused(); // Escape closes the tooltip, it does not move the focus
  // 3 s cadence, and only one announcement however many probes
  const before = s.probes;
  await advance(page, 3_100);
  await expect.poll(() => s.probes).toBe(before + 1);
  await advance(page, 9_000);
  await expect.poll(() => s.probes).toBeGreaterThanOrEqual(before + 4);
  expect(await said(page)).toEqual([expect.stringMatching(UPDATING)]);
  // the colour is a token, the animation is the slow pulse
  const style = await dot.locator(".dot").evaluate((e) => { const c = getComputedStyle(e); return { bg: c.backgroundColor, name: c.animationName, token: getComputedStyle(document.documentElement).getPropertyValue("--signal").trim() }; });
  expect(style.name).toMatch(/build-pulse$/);
  expect(style.token).not.toBe("");
  // the build ends: the page is not reloaded, the notice offers it
  await page.evaluate(() => { (window as unknown as { __keep: number }).__keep = 42; });
  s.building = false; s.last = OK;
  await advance(page, 3_100);
  await expect(updated(page)).toBeVisible();
  await expect(updated(page)).toContainText(UPDATED);
  await expect(updated(page).getByRole("button", { name: RELOAD })).toBeVisible();
  await expect(building(page)).toHaveCount(0);
  expect(await said(page)).toEqual([expect.stringMatching(UPDATING), expect.stringMatching(UPDATED)]);
  expect(await page.evaluate(() => (window as unknown as { __keep: number }).__keep)).toBe(42);
  // and the idle cadence is back
  const idle = s.probes;
  await advance(page, 5_000);
  expect(s.probes).toBe(idle);
});

test("Reload reloads the page, and only on request", async ({ page }) => {
  await page.clock.install();
  const s = await mockStatus(page, { building: true });
  await page.goto("/");
  await expect(building(page)).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __keep: number }).__keep = 1; });
  s.building = false; s.last = OK;
  await advance(page, 3_100);
  const reload = updated(page).getByRole("button", { name: RELOAD });
  await expect(reload).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { __keep?: number }).__keep)).toBe(1); // still the same page
  await Promise.all([page.waitForEvent("load"), reload.click()]);
  expect(await page.evaluate(() => (window as unknown as { __keep?: number }).__keep)).toBeUndefined();
});

test("the notice goes by itself after a few seconds (later while the pointer is on it) and on a click", async ({ page }) => {
  await page.clock.install();
  const s = await mockStatus(page, { building: true });
  await page.goto("/");
  await expect(building(page)).toBeVisible();
  s.building = false; s.last = OK;
  await advance(page, 3_100);
  await expect(updated(page)).toBeVisible();
  await advance(page, 5_000);
  await expect(updated(page)).toBeVisible();
  await advance(page, 6_000);
  await expect(updated(page)).toHaveCount(0);
  // pointer on it: it stays
  s.building = true; await advance(page, 30_100); await expect(building(page)).toBeVisible();
  s.building = false; await advance(page, 3_100);
  await expect(updated(page)).toBeVisible();
  await updated(page).hover();
  await advance(page, 12_000);
  await expect(updated(page)).toBeVisible();
  // the close button
  await updated(page).getByRole("button", { name: /Fermer|Close/ }).click();
  await expect(updated(page)).toHaveCount(0);
});

test("a build that failed tells the visitor nothing more: the dot goes, no notice, no announcement of an update", async ({ page }) => {
  await page.clock.install();
  await recordAnnouncements(page);
  const s = await mockStatus(page, { building: true });
  await page.goto("/");
  await expect(building(page)).toBeVisible();
  s.building = false; s.last = { at: new Date().toISOString(), ok: false, ms: 900 };
  await advance(page, 3_100);
  await expect(building(page)).toHaveCount(0);
  await page.waitForTimeout(200);
  await expect(updated(page)).toHaveCount(0);
  expect(await said(page)).toEqual([expect.stringMatching(UPDATING)]);
});

test("a build seen only at its end (idle at load) shows nothing; one that starts later is shown", async ({ page }) => {
  await page.clock.install();
  const s = await mockStatus(page, { building: false, last: OK });
  await page.goto("/");
  await expect.poll(() => s.probes).toBe(1);
  s.building = true;
  await advance(page, 30_100);
  await expect(building(page)).toBeVisible();
});

test("no probe in a hidden tab, none offline; one at once when the tab is back", async ({ page, context }) => {
  await page.clock.install();
  const s = await mockStatus(page, { building: false, last: OK });
  await page.goto("/");
  await expect.poll(() => s.probes).toBe(1);
  const visibility = (hidden: boolean) => page.evaluate((h) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
  await visibility(true);
  await advance(page, 300_000, 10_000);
  expect(s.probes).toBe(1);
  await visibility(false);
  await expect.poll(() => s.probes).toBe(2);
  // while a build runs too: a hidden tab does not poll every 3 s
  s.building = true;
  await advance(page, 30_100);
  await expect(building(page)).toBeVisible();
  await visibility(true);
  const n = s.probes;
  await advance(page, 60_000);
  expect(s.probes).toBe(n);
  await visibility(false);
  await expect.poll(() => s.probes).toBe(n + 1);
  // offline: nothing, and a probe when the connection is back
  await context.setOffline(true);
  const m = s.probes;
  await advance(page, 60_000);
  expect(s.probes).toBe(m);
  await context.setOffline(false);
  await expect.poll(() => s.probes).toBeGreaterThan(m);
});

test.describe("reduced motion", () => {
  for (const [media, expected] of [["reduce", /^none$/], ["no-preference", /build-pulse$/]] as const) {
    test(`prefers-reduced-motion: ${media}: animation ${expected}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: media });
      await mockStatus(page, { building: true });
      await page.goto("/");
      const dot = building(page).locator(".dot");
      await expect(dot).toBeVisible();
      await expect(dot).toHaveCSS("animation-name", expected);
    });
  }
});

test("the dot and the notice stay inside the viewport and do not shift the header", async ({ page }) => {
  await page.clock.install();
  const s = await mockStatus(page, { building: false, last: OK });
  await page.goto("/");
  await expect.poll(() => s.probes).toBe(1);
  const header = page.getByRole("banner");
  const h0 = (await header.boundingBox())!.height;
  s.building = true;
  await advance(page, 30_100);
  const dot = building(page).getByRole("button");
  await expect(dot).toBeVisible();
  expect((await header.boundingBox())!.height).toBe(h0);
  await dot.focus();
  const vw = page.viewportSize()!.width;
  const tipBox = (await building(page).locator("[role=tooltip]").boundingBox())!;
  expect(tipBox.x).toBeGreaterThanOrEqual(0);
  expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(vw);
  s.building = false; s.last = OK;
  await advance(page, 3_100);
  const box = (await updated(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw);
  expect((await header.boundingBox())!.height).toBe(h0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a build that succeeded and a queued one that failed: the site was swapped, the notice is shown", async ({ page }) => {
  await page.clock.install();
  const s = await mockStatus(page, { building: true });
  await page.goto("/");
  await expect(building(page)).toBeVisible();
  s.last = { at: "2026-11-25T10:00:00.000Z", ok: true, ms: 3000 }; // the first build ended, the waiting one runs: still building
  await advance(page, 3_100);
  s.building = false; s.last = { at: "2026-11-25T10:00:09.000Z", ok: false, ms: 500 };
  await advance(page, 3_100);
  await expect(updated(page)).toBeVisible();
});

test("the notice is under the whole header (never over its second row) and the dot never covers the navigation", async ({ page }) => {
  await page.clock.install();
  const s = await mockStatus(page, { building: true });
  await page.goto("/wiki/concepts/beta/"); // a page without a large search field: the header carries its own
  const dot = building(page).getByRole("button");
  await expect(dot).toBeVisible();
  // the first control of the navigation (a link, or the Menu button on a narrow header) is what is at its left edge, not the dot
  const hit = await page.evaluate(() => {
    const first = [...document.querySelectorAll("header nav a, header nav button")].find((n) => n.getBoundingClientRect().width > 0)!;
    const box = first.getBoundingClientRect();
    const el = document.elementFromPoint(box.left + 2, box.top + box.height / 2);
    return el?.closest("a, button")?.getAttribute("href") ?? el?.closest("button")?.textContent?.trim() ?? el?.tagName;
  });
  expect(hit).toMatch(/search|Menu/);
  // the tooltip is above the header's second row (the field of a phone), not under it
  await dot.focus();
  await expect(building(page).locator("[role=tooltip]")).toBeVisible();
  const top = await page.evaluate(() => {
    const r = document.querySelector("[role=tooltip]")!.getBoundingClientRect();
    return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest("[role=tooltip]");
  });
  expect(top).toBe(true);
  await page.keyboard.press("Escape");
  s.building = false; s.last = OK;
  await advance(page, 3_100);
  await expect(updated(page)).toBeVisible();
  const header = (await page.getByRole("banner").boundingBox())!, box = (await updated(page).boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
  const field = page.getByRole("banner").locator("input[role=combobox]");
  if (await field.count()) expect((await field.boundingBox())!.y + (await field.boundingBox())!.height).toBeLessThanOrEqual(box.y);
});
