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
  await expect(mark).toHaveAttribute("data-optic", "compact");
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
    // pending moves only when motion is welcome: the panel head (small glyph, its three accent nodes light up in turn) and the
    // waiting turn (full graph, one signal); the header button carries the assistant icon, not the avatar
    await expect.poll(() => running(page)).toBe(still ? 0 : 4);
    await expect(head).toHaveAttribute("data-optic", "compact");
    if (!still) expect(await head.locator(".nf").first().evaluate((el) => getComputedStyle(el).animationTimingFunction)).toMatch(/^steps\(1/);
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

test("the optical variants follow the size: the small glyph below 40 px, the full graph from 40 px", async ({ page }) => {
  await page.goto("/design-system/");
  const optics = await page.locator("svg.folio").evaluateAll((els) => [...new Set(els.map((e) => `${e.getAttribute("width")}:${e.getAttribute("data-optic")}`))]);
  expect(optics).toEqual(expect.arrayContaining(["24:compact", "48:full", "96:full"]));
  expect(optics.filter((o) => Number(o.split(":")[0]) >= 40).every((o) => o.endsWith(":full"))).toBe(true);
  expect(optics.filter((o) => Number(o.split(":")[0]) < 40).every((o) => /:(compact|tiny)$/.test(o))).toBe(true);
  // the small glyph: one closed contour, exactly three accent nodes, no ink node, no inner mesh
  const small = page.locator('svg.folio[width="24"][data-state="idle"]').first();
  await expect(small).toHaveAttribute("viewBox", "0 0 32 32");
  await expect(small.locator(".nodes.front circle")).toHaveCount(3);
  await expect(small.locator(".nodes.ink")).toHaveCount(0);
  await expect(small.locator("rect")).toHaveCount(0);
  const contour = await small.locator(".links.ink path").getAttribute("d");
  expect(contour).toMatch(/^M[^M]*Z$/);
  // the full graph keeps its ink nodes, and its nodes are round too
  const full = page.locator('svg.folio[width="48"][data-state="idle"]').first();
  expect(await full.locator(".nodes.ink circle").count()).toBeGreaterThan(0);
  await expect(full.locator("rect")).toHaveCount(0);
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
