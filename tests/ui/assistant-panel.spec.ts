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

// A held NDJSON stream the test writes to: the page's own fetch answers each POST with a fresh body. `emit` writes an event,
// `cut` breaks the connection, and an abort of the request errors the body the way a real fetch does (and is counted).
async function heldStream(page: Page) {
  await page.route("**/api/ask", (route: Route) => route.request().method() === "HEAD" ? route.fulfill({ status: 204 }) : route.abort());
  await page.addInitScript(() => {
    const native = window.fetch.bind(window), enc = new TextEncoder(), w = window as any;
    w.aborts = 0;
    w.bodies = [];
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/ask") && init?.method === "POST") {
        w.bodies.push(JSON.parse(String(init.body)));
        const body = new ReadableStream({
          start: (c) => {
            w.emit = (e: object) => c.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
            w.end = () => c.close();
            w.cut = () => c.error(new TypeError("network error"));
            init.signal?.addEventListener("abort", () => { w.aborts++; c.error(new DOMException("Aborted", "AbortError")); });
          },
        });
        return Promise.resolve(new Response(body, { headers: { "content-type": "application/x-ndjson" } }));
      }
      return native(input, init);
    }) as typeof fetch;
  });
}
const emit = (page: Page, e: object) => page.evaluate((ev) => (window as any).emit(ev), e);
// the final event, then the end of the body: the answer is taken once the stream is over
const finish = (page: Page, e: object) => page.evaluate((ev) => { (window as any).emit(ev); (window as any).end(); }, { t: "done", ...e });
const STOP = /Arrêter la réponse|Stop the answer/, STOPPED = /Réponse interrompue|Answer stopped/;
async function askHeld(page: Page, q = "Why?") {
  await heldStream(page);
  await page.goto("/graph");
  await page.locator("#assistant-toggle").click();
  await page.locator("#assistant-q").fill(q);
  await page.locator("#assistant-q").press("Enter");
  await expect(panel(page).getByRole("button", { name: STOP })).toBeVisible();
}

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
      : route.fulfill({ contentType: "application/x-ndjson; charset=utf-8", body: [{ t: "step", step: { kind: "read", path: "wiki/a.md", title: "A" } }, { t: "delta", text: "Draft" }, { t: "reset" }, { t: "delta", text: "Fin" }, done].map((e) => JSON.stringify(e)).join("\n") + "\n" }));
    await page.goto("/graph");
    await page.locator("#assistant-toggle").click();
    await page.locator("#assistant-q").fill("Why?");
    await page.locator("#assistant-q").press("Enter");
    await expect(panel(page).getByText("Final answer.")).toBeVisible();
    await expect(panel(page).getByText("Draft")).toHaveCount(0);
    const kept = await page.evaluate(() => Object.values(sessionStorage).join(""));
    expect(kept).not.toContain("partial");
  });

  test("while the answer streams, one line says what the agent is doing, changed in place, outside any live region", async ({ page }) => {
    await page.route("**/api/ask", (route: Route) => route.request().method() === "HEAD" ? route.fulfill({ status: 204 }) : route.abort());
    // a held stream: the page's own fetch answers the POST with a body the test writes to
    await page.addInitScript(() => {
      const native = window.fetch.bind(window), enc = new TextEncoder();
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/api/ask") && init?.method === "POST") {
          const body = new ReadableStream({ start: (c) => { (window as any).emit = (e: object) => c.enqueue(enc.encode(`${JSON.stringify(e)}\n`)); } });
          return Promise.resolve(new Response(body, { headers: { "content-type": "application/x-ndjson" } }));
        }
        return native(input, init);
      }) as typeof fetch;
    });
    await page.goto("/graph");
    await page.locator("#assistant-toggle").click();
    await page.locator("#assistant-q").fill("Why?");
    await page.locator("#assistant-q").press("Enter");
    await expect(panel(page).getByText(/Consultation du wiki|Reading the wiki/)).toBeVisible(); // before any step: the generic wording
    await page.evaluate(() => (window as any).emit({ t: "step", step: { kind: "search", query: "alpha" } }));
    await expect(panel(page).getByText(/Recherche de « alpha »|Searching the wiki for “alpha”/)).toBeVisible();
    await page.evaluate(() => (window as any).emit({ t: "step", step: { kind: "read", path: "wiki/a.md", title: "Page A" } }));
    // typed from the left: the whole wording is there once the typing ends, and the previous line has left
    await expect(panel(page).getByText(/Lecture de « Page A »|Reading “Page A”/)).toBeVisible();
    await expect(panel(page).getByText(/Recherche de « alpha »|Searching the wiki for “alpha”/)).toHaveCount(0);
    await expect(panel(page).locator("[data-step-line] > span")).toHaveCount(1); // the outgoing line is gone once the transition ends
    expect(await panel(page).locator("[data-step-line] > span").evaluate((el) => getComputedStyle(el).animationName)).toMatch(/sweep/); // the shimmer, in motion
    expect(await panel(page).getByText(/Page A/).evaluate((el) => !!el.closest("[aria-live], [role=status]"))).toBe(false);
    await page.evaluate(() => (window as any).emit({ t: "delta", text: "Some draft" }));
    await expect(panel(page).getByText("Some draft")).toBeVisible();
    await expect(panel(page).getByText(/Rédaction de la réponse|Writing the answer/)).toBeVisible();
    expect(await page.evaluate(() => Object.values(sessionStorage).join(""))).not.toMatch(/step|partial/);
  });

  test("a draft event is drawn like the answer (blocks and prose), replaces the raw text, and a reset voids it; nothing of it is kept", async ({ page }) => {
    await askHeld(page);
    await emit(page, { t: "delta", text: "raw **text**" });
    await expect(panel(page).getByText("raw **text**")).toBeVisible(); // an older server: the raw Markdown
    await emit(page, { t: "draft", segments: [{ html: "<p>Rendered <strong>draft</strong></p>" }, { block: { type: "callout", tone: "info", html: "<p>A note</p>" } }] });
    const card = panel(page).locator("article .wiki").first();
    await expect(card.locator("strong")).toHaveText("draft");
    await expect(panel(page).getByText("raw **text**")).toHaveCount(0);
    await expect(panel(page).getByText("A note")).toBeVisible();
    // the draft sits in no live region: the screen reader does not hear each update
    expect(await card.evaluate((el) => !!el.closest("[aria-live], [role=status]"))).toBe(false);
    expect(await page.evaluate(() => Object.values(sessionStorage).join(""))).not.toMatch(/draft|Rendered/);
    await emit(page, { t: "reset" });
    await expect(panel(page).getByText("Rendered")).toHaveCount(0);
    await expect(panel(page).getByRole("button", { name: STOP })).toBeVisible(); // still waiting
    await finish(page, { segments: [{ html: "<p>Final <strong>answer</strong></p>" }], md: "Final **answer**", cited: [], retained: [], related: [], model: "m" });
    await expect(panel(page).locator("article .wiki strong")).toHaveText("answer");
    await expect(panel(page).getByRole("button", { name: STOP })).toHaveCount(0);
    await expect(panel(page).getByRole("button", { name: /Envoyer la question|Send the question/ })).toBeVisible();
  });

  test("Stop aborts the request, keeps the draft with a notice and Retry, and the stopped turn is not history", async ({ page }) => {
    await askHeld(page);
    await emit(page, { t: "draft", segments: [{ html: "<p>Half an answer</p>" }] });
    await expect(panel(page).getByText("Half an answer")).toBeVisible();
    const stop = panel(page).getByRole("button", { name: STOP });
    await stop.focus();
    await page.keyboard.press("Enter"); // by keyboard
    await expect.poll(() => page.evaluate(() => (window as any).aborts)).toBe(1);
    const notice = panel(page).locator("article").getByText(STOPPED);
    await expect(notice).toBeVisible();
    await expect(panel(page).getByText("Half an answer")).toBeVisible();
    await expect(panel(page).getByRole("button", { name: STOP })).toHaveCount(0);
    await expect(panel(page).getByRole("button", { name: /Réessayer|Retry/ })).toBeVisible();
    await expect(page.locator("#assistant-q")).toBeFocused();
    // announced politely by the panel's status line, not by the card
    await expect(panel(page).locator("p[role=status]")).toHaveText(STOPPED);
    expect(await notice.evaluate((el) => !!el.closest("[role=status]"))).toBe(false);
    expect(await page.evaluate(() => Object.values(sessionStorage).join(""))).not.toMatch(/Half an answer|partial|draft/);
    // the next question goes at once, and carries no history from the stopped turn
    await page.locator("#assistant-q").fill("Again?");
    await page.locator("#assistant-q").press("Enter");
    await expect(panel(page).getByRole("button", { name: STOP })).toBeVisible();
    expect(await page.evaluate(() => (window as any).bodies.map((b: any) => [b.q, b.history]))).toEqual([["Why?", []], ["Again?", []]]);
  });

  test("a cut stream keeps what arrived with the network error; Retry replaces the turn", async ({ page }) => {
    await askHeld(page);
    await emit(page, { t: "delta", text: "Some words" });
    await page.evaluate(() => (window as any).cut());
    await expect(panel(page).locator("article").getByText(/Le serveur ne répond pas|The server does not answer/)).toBeVisible();
    await expect(panel(page).getByText("Some words")).toBeVisible();
    expect(await page.evaluate(() => (window as any).aborts)).toBe(0);
    expect(await page.evaluate(() => Object.values(sessionStorage).join(""))).not.toMatch(/Some words|partial/);
    await panel(page).getByRole("button", { name: /Réessayer|Retry/ }).click();
    await expect(panel(page).getByRole("button", { name: STOP })).toBeVisible();
    await finish(page, { segments: [{ html: "<p>Whole answer</p>" }], md: "Whole answer", cited: [], retained: [], related: [] });
    await expect(panel(page).getByText("Whole answer")).toBeVisible();
    await expect(panel(page).getByText("Some words")).toHaveCount(0);
    await expect(panel(page).locator("article")).toHaveCount(1);
  });

  test("a notice appears once the answered exchanges reach the history depth the server announced, and not before", async ({ page }) => {
    const done = { segments: [{ html: "<p>An answer.</p>" }], md: "An answer.", cited: [], retained: [], related: [] };
    await page.route("**/api/ask", (route: Route) => route.request().method() === "HEAD"
      ? route.fulfill({ status: 204, headers: { "x-ask-history-turns": "2" } })
      : route.fulfill({ contentType: "application/json", body: JSON.stringify(done) }));
    await page.goto("/graph");
    await page.locator("#assistant-toggle").click();
    const notice = panel(page).getByText(/Cette conversation a atteint 2 échanges|This conversation has reached 2 exchanges/);
    for (const q of ["One?", "Two?"]) {
      await expect(notice).toHaveCount(0);
      await page.locator("#assistant-q").fill(q);
      await page.locator("#assistant-q").press("Enter");
      await expect(panel(page).getByText("An answer.")).toHaveCount(q === "One?" ? 1 : 2);
    }
    await expect(notice).toHaveCount(1);
    expect(await notice.evaluate((el) => !!el.closest("[role=status]"))).toBe(true); // announced politely, once
    await page.locator("#assistant-q").fill("Three?");
    await page.locator("#assistant-q").press("Enter");
    await expect(panel(page).getByText("An answer.")).toHaveCount(3);
    await expect(notice).toHaveCount(1); // persistent, never repeated
  });

  test("without the header (an older server) no notice appears, however long the conversation", async ({ page }) => {
    const done = { segments: [{ html: "<p>An answer.</p>" }], md: "An answer.", cited: [], retained: [], related: [] };
    await page.route("**/api/ask", (route: Route) => route.request().method() === "HEAD" ? route.fulfill({ status: 204 }) : route.fulfill({ contentType: "application/json", body: JSON.stringify(done) }));
    await page.goto("/graph");
    await page.locator("#assistant-toggle").click();
    for (const q of ["One?", "Two?", "Three?"]) {
      await page.locator("#assistant-q").fill(q);
      await page.locator("#assistant-q").press("Enter");
    }
    await expect(panel(page).getByText("An answer.")).toHaveCount(3);
    await expect(panel(page).getByText(/échanges|exchanges/)).toHaveCount(0);
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("the step line changes at once and its text is plain: no sweep, no slide", async ({ page }) => {
      await page.route("**/api/ask", (route: Route) => route.request().method() === "HEAD" ? route.fulfill({ status: 204 }) : route.abort());
      await page.addInitScript(() => {
        const native = window.fetch.bind(window), enc = new TextEncoder();
        window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input).includes("/api/ask") && init?.method === "POST") {
            const body = new ReadableStream({ start: (c) => { (window as any).emit = (e: object) => c.enqueue(enc.encode(`${JSON.stringify(e)}\n`)); } });
            return Promise.resolve(new Response(body, { headers: { "content-type": "application/x-ndjson" } }));
          }
          return native(input, init);
        }) as typeof fetch;
      });
      await page.goto("/graph");
      await page.locator("#assistant-toggle").click();
      await page.locator("#assistant-q").fill("Why?");
      await page.locator("#assistant-q").press("Enter");
      await expect(panel(page).locator("[data-step-line] > span")).toHaveCount(1);
      await page.evaluate(() => (window as any).emit({ t: "step", step: { kind: "search", query: "alpha" } }));
      const line = panel(page).locator("[data-step-line] > span");
      // at once: the whole wording and a single line, with no typing to wait for
      await expect.poll(() => line.allTextContents(), { timeout: 1000 }).toEqual([expect.stringMatching(/Recherche de « alpha »|Searching the wiki for “alpha”/)]);
      expect(await line.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    });
  });
});
