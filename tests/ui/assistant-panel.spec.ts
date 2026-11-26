import type { Page, Route } from "@playwright/test";
import { expect, test } from "./helpers";

// The docked assistant panel (from 1280 px): a width the reader sets at the handle on its left edge, an edge shadow, and the
// thin integrated scrollbar. A static host has no /api/ask: HEAD is faked so that the assistant is offered.
async function mockAsk(page: Page) {
  await page.route("**/api/ask", (route: Route) => route.fulfill({ status: 204 }));
}
const panel = (page: Page) => page.locator("#assistant-panel");
const handle = (page: Page) => panel(page).getByRole("separator");
const widthOf = (page: Page) => panel(page).evaluate((el) => el.getBoundingClientRect().width);
const varOf = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--assistant-width").trim());
const mainWidth = (page: Page) => page.locator("main").first().evaluate((el) => el.getBoundingClientRect().width);

async function open(page: Page) {
  await mockAsk(page);
  await page.goto("/graph");
  await page.locator("#assistant-toggle").click();
  await expect(panel(page)).toBeVisible();
}

test.describe("desktop 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.skip(({ isMobile }) => isMobile, "docked panel: desktop project only");

  test("the handle is a vertical separator with its value, and the default width is 28 rem", async ({ page }) => {
    await open(page);
    const h = handle(page);
    await expect(h).toHaveAttribute("aria-orientation", "vertical");
    await expect(h).toHaveAttribute("aria-label", /Resize the assistant|Redimensionner l'assistant/);
    await expect(h).toHaveAttribute("aria-valuemin", "320");
    await expect(h).toHaveAttribute("aria-valuemax", "720");
    await expect(h).toHaveAttribute("aria-valuenow", "448");
    await expect(h).toHaveAttribute("tabindex", "0");
    expect(await h.evaluate((el) => getComputedStyle(el).cursor)).toBe("col-resize");
    expect(await widthOf(page)).toBe(448);
    expect(await varOf(page)).toBe("448px");
  });

  test("dragging the handle to the left widens the panel and the page follows, within the bounds", async ({ page }) => {
    await open(page);
    const before = { panel: await widthOf(page), main: await mainWidth(page) };
    const box = (await handle(page).boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 3, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 3 - 100, y, { steps: 5 });
    // during the drag: no text selection, and the page already follows
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).userSelect)).toBe("none");
    await page.mouse.up();
    expect(await widthOf(page)).toBeCloseTo(before.panel + 100, -1);
    expect(await varOf(page)).toBe(`${Math.round(await widthOf(page))}px`);
    expect(await mainWidth(page)).toBeLessThan(before.main - 90);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).userSelect)).not.toBe("none");
    // too far to the left: stops at min(50vw, 720 px); too far to the right: stops at 320 px
    await page.mouse.move((await handle(page).boundingBox())!.x + 3, y);
    await page.mouse.down();
    await page.mouse.move(0, y, { steps: 5 });
    await page.mouse.up();
    expect(await widthOf(page)).toBe(720);
    const edge = (await handle(page).boundingBox())!.x + 3;
    await page.mouse.move(edge, y);
    await page.mouse.down();
    await page.mouse.move(1439, y, { steps: 5 });
    await page.mouse.up();
    expect(await widthOf(page)).toBe(320);
  });

  test("the keyboard: ArrowRight narrows by 16 px, Shift by 64, Home and End are the bounds, Enter and a double click reset", async ({ page }) => {
    await open(page);
    const h = handle(page);
    await h.focus();
    await h.press("ArrowRight");
    expect(await widthOf(page)).toBe(432);
    await expect(h).toHaveAttribute("aria-valuenow", "432");
    await h.press("ArrowLeft");
    expect(await widthOf(page)).toBe(448);
    await h.press("Shift+ArrowLeft");
    expect(await widthOf(page)).toBe(512);
    await h.press("End");
    expect(await widthOf(page)).toBe(720);
    await h.press("ArrowLeft");
    expect(await widthOf(page)).toBe(720);
    await h.press("Home");
    expect(await widthOf(page)).toBe(320);
    await h.press("ArrowRight");
    expect(await widthOf(page)).toBe(320);
    await h.press("Enter");
    expect(await widthOf(page)).toBe(448);
    await h.press("Shift+ArrowLeft");
    await h.dblclick();
    expect(await widthOf(page)).toBe(448);
  });

  test("the width is kept across a reload, and the window bounds it again when it shrinks", async ({ page }) => {
    await open(page);
    await handle(page).focus();
    await handle(page).press("Shift+ArrowLeft");
    expect(await widthOf(page)).toBe(512);
    await page.reload();
    // the open state is kept too: only open it if the reload closed it
    const toggle = page.locator("#assistant-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", /true|false/);
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(panel(page)).toBeVisible();
    expect(await widthOf(page)).toBe(512);
    expect(await varOf(page)).toBe("512px");
    // 1280 px: the panel may take half the window, 640 px at most
    await handle(page).focus();
    await handle(page).press("End");
    expect(await widthOf(page)).toBe(720);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect.poll(() => widthOf(page)).toBe(640);
    await expect(handle(page)).toHaveAttribute("aria-valuemax", "640");
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(() => widthOf(page)).toBe(720);
  });

  test("the docked panel is split from the page by an edge shadow and a stronger border; its scroll area is a thin scrollbar", async ({ page }) => {
    await open(page);
    const look = await panel(page).evaluate((el) => {
      const s = getComputedStyle(el);
      const probe = document.createElement("i");
      probe.style.color = "var(--input)";
      document.body.append(probe);
      const input = getComputedStyle(probe).color;
      probe.remove();
      return { shadow: s.boxShadow, border: s.borderLeftColor, input, modal: el.matches(":modal") };
    });
    expect(look.modal).toBe(false);
    expect(look.shadow).not.toBe("none");
    expect(look.border).toBe(look.input);
    const scroll = panel(page).locator("[aria-busy]");
    const bar = await scroll.evaluate((el) => ({ width: getComputedStyle(el).scrollbarWidth, color: getComputedStyle(el).scrollbarColor }));
    expect(bar.width).toBe("thin");
    expect(bar.color).not.toBe("auto");
  });

  test("a streamed answer (NDJSON): the final event replaces the provisional text, and no partial text is kept", async ({ page }) => {
    const done = { t: "done", segments: [{ html: "<p>Final answer.</p>" }], md: "Final answer.", cited: [], retained: [], related: [], model: "test-model" };
    await page.route("**/api/ask", (route: Route) => route.request().method() === "HEAD"
      ? route.fulfill({ status: 204 })
      : route.fulfill({ contentType: "application/x-ndjson; charset=utf-8", body: [{ t: "delta", text: "Draft" }, { t: "reset" }, { t: "delta", text: "Fin" }, done].map((e) => JSON.stringify(e)).join("\n") + "\n" }));
    await page.goto("/graph");
    await page.locator("#assistant-toggle").click();
    await page.locator("#assistant-q").fill("Why?");
    await page.locator("#assistant-q").press("Enter");
    await expect(panel(page).getByText("Final answer.")).toBeVisible();
    await expect(panel(page).getByText("Draft")).toHaveCount(0);
    const kept = await page.evaluate(() => Object.values(sessionStorage).join(""));
    expect(kept).not.toContain("partial");
  });
});
