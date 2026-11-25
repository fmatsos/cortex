import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./helpers";

// The brand mark is the static graph-brain: drawn in SVG, no raster image, nothing moving. The assistant's avatar is the same
// drawing with four states; a static host has no /api/ask, so those are exercised through a mocked endpoint.
const running = (page: Page) =>
  page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && (a.effect as KeyframeEffect | null)?.target?.closest?.("svg.folio")).length);

test("the header mark is the graph-brain, an inline drawing with no image", async ({ page }) => {
  await page.goto("/");
  const mark = page.getByRole("banner").locator("svg.folio").first();
  await expect(mark).toBeVisible();
  const box = await mark.boundingBox();
  expect(box?.width).toBe(32);
  expect(box?.height).toBe(32);
  await expect(mark).toHaveAttribute("data-optic", "mark");
  await expect(mark).toHaveAttribute("viewBox", "0 0 32 32");
  await expect(mark).toHaveAttribute("aria-hidden", "true");
  await expect(mark).toHaveAttribute("data-state", "idle");
  expect(await page.locator("svg.folio image, svg.folio foreignObject").count(), "no raster inside the mark").toBe(0);
  // butt ends and mitered joins, as the rest of the square system
  const style = await mark.locator(".links").first().evaluate((el) => ({ cap: getComputedStyle(el).strokeLinecap, join: getComputedStyle(el).strokeLinejoin }));
  expect(style).toEqual({ cap: "butt", join: "miter" });
});

test("the home mark is larger and nothing references the old mascot", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (r) => requested.push(r.url()));
  await page.goto("/");
  const hero = page.locator("main svg.folio").first();
  await expect(hero).toBeVisible();
  expect((await hero.boundingBox())?.width).toBe(72);
  expect(await page.locator("img[src*='mascot'], image[href*='mascot']").count()).toBe(0);
  expect(await page.content()).not.toContain("mascot");
  expect(requested.filter((u) => u.includes("mascot"))).toEqual([]);
  // the word is plain text, not an SVG drawing
  await expect(page.getByRole("banner").getByText("Cortex", { exact: true })).toBeVisible();
  expect(await page.getByRole("banner").locator("text").count()).toBe(0);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`the brand marks do not move (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/");
    await expect(page.locator("svg.folio").first()).toBeVisible();
    expect(await page.locator("svg.folio").count()).toBeGreaterThan(1);
    expect(await running(page)).toBe(0);
  });
}

// Fake server for the assistant: HEAD says it is there, POST answers when the test says so.
async function mockAsk(page: Page, outcome: "answer" | "error") {
  let release!: () => void;
  const gate = new Promise<void>((ok) => (release = ok));
  await page.route("**/api/ask", async (route: Route) => {
    if (route.request().method() === "HEAD") return route.fulfill({ status: 204 });
    await gate;
    if (outcome === "error") return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ segments: [{ html: "<p>An answer.</p>" }], md: "An answer.", cited: [], retained: [], related: [] }) });
  });
  return release;
}

async function ask(page: Page) {
  await page.goto("/");
  await page.locator("#assistant-toggle").click();
  const panel = page.locator("#assistant-panel");
  await expect(panel).toBeVisible();
  await panel.locator("#assistant-q").fill("What is in the wiki?");
  await panel.locator("#assistant-q").press("Enter");
  return panel;
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  const still = reducedMotion === "reduce";
  test(`the assistant avatar follows idle, pending, answer (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    const release = await mockAsk(page, "answer");
    await page.goto("/");
    await page.locator("#assistant-toggle").click();
    const head = page.locator("#assistant-panel header svg.folio");
    await expect(head).toHaveAttribute("data-state", "idle");

    await page.locator("#assistant-q").fill("What is in the wiki?");
    await page.locator("#assistant-q").press("Enter");
    await expect(head).toHaveAttribute("data-state", "pending");
    const waiting = page.locator("#assistant-panel article svg.folio");
    await expect(waiting).toHaveAttribute("data-state", "pending");
    await expect(waiting).toHaveAttribute("aria-hidden", "true");
    // pending moves only when motion is welcome: the signal of the panel head and the one of the waiting turn, the same
    // drawing at two sizes; the header button carries the assistant icon, not the avatar
    await expect.poll(() => running(page)).toBe(still ? 0 : 2);
    await expect(head).toHaveAttribute("data-optic", "mark");
    await expect(head.locator(".signal")).toHaveCount(1);
    if (!still) expect(await head.locator(".signal").evaluate((el) => getComputedStyle(el).animationTimingFunction)).toMatch(/^steps\(1/);
    await expect(waiting.locator(".signal")).toHaveCount(1);
    if (!still) expect(await waiting.locator(".signal").evaluate((el) => getComputedStyle(el).animationTimingFunction)).toMatch(/^steps\(1/);
    // the state text stays in the panel
    await expect(page.locator("#assistant-panel [role=status]")).toHaveText(/./);

    release();
    await expect(head).toHaveAttribute("data-state", "answer");
    await expect(head.locator(".signal")).toHaveCount(0);
    // the front nodes grow once and stay larger than at rest
    await expect(head.locator(".nf").first()).toHaveCSS("transform", /^matrix\(1\.[1-9]/);
    await expect.poll(() => running(page), "the front nodes grow once, then everything is still").toBe(0);
  });
}

test("one drawing from 24 px up: eight round nodes, three of them in the accent colour", async ({ page }) => {
  await page.goto("/design-system/");
  const optics = await page.locator("svg.folio").evaluateAll((els) => [...new Set(els.map((e) => `${e.getAttribute("width")}:${e.getAttribute("data-optic")}:${e.getAttribute("viewBox")}`))]);
  expect(optics).toEqual(expect.arrayContaining(["24:mark:0 0 32 32", "48:mark:0 0 32 32", "96:mark:0 0 32 32"]));
  // no other variant from 24 px up: the dense graph and the contour glyph are gone
  expect(optics.filter((o) => Number(o.split(":")[0]) >= 24).every((o) => o.includes(":mark:"))).toBe(true);
  for (const width of [24, 48, 96]) {
    const mark = page.locator(`svg.folio[width="${width}"][data-state="idle"]`).first();
    await expect(mark.locator(".nodes.ink circle")).toHaveCount(5);
    await expect(mark.locator(".nodes.front circle")).toHaveCount(3);
    await expect(mark.locator("rect")).toHaveCount(0);
    await expect(mark.locator(".links path")).toHaveCount(10);
  }
  // nodes are 3 units across (front ones 3.5), links straight in butt ends
  const mark = page.locator('svg.folio[width="48"][data-state="idle"]').first();
  expect(await mark.locator(".nodes.ink circle").evaluateAll((els) => els.map((e) => e.getAttribute("r")))).toEqual(Array(5).fill("1.5"));
  expect(await mark.locator(".nodes.front circle").evaluateAll((els) => els.map((e) => e.getAttribute("r")))).toEqual(Array(3).fill("1.75"));
});

test("the 16-unit master of the mark (favicon, under 24 px) keeps the silhouette and the cluster with fewer nodes", () => {
  const read = (f: string) => readFileSync(new URL(`../../design/brand/${f}`, import.meta.url), "utf8");
  const big = read("cortex-mark.svg"), small = read("cortex-mark-16.svg");
  const count = (svg: string, fill: string) => (svg.split(`<g fill="${fill}">`)[1]?.split("</g>")[0].match(/<circle/g) ?? []).length;
  expect([count(big, "currentColor"), count(big, "var(--primary)")]).toEqual([5, 3]);
  expect([count(small, "currentColor"), count(small, "var(--primary)")]).toEqual([3, 3]);
  expect(big).toContain('viewBox="0 0 32 32"');
  expect(small).toContain('viewBox="0 0 16 16"');
});

test("a failed question puts the avatar in its error composition, still", async ({ page }) => {
  const release = await mockAsk(page, "error");
  const panel = await ask(page);
  release();
  const head = panel.locator("header svg.folio");
  await expect(head).toHaveAttribute("data-state", "error");
  await expect(head.locator(".break")).toHaveCount(1);
  await expect(head.locator(".signal")).toHaveCount(0);
  expect(await running(page)).toBe(0);
  await expect(panel.locator("[role=status]")).toHaveText(/./);
});
