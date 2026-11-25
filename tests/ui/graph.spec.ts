import { test, expect } from "./helpers";
import type Sigma from "sigma";
import type { GraphData } from "../../site/src/lib/types";
import { buildView, focusNodes } from "../../site/src/lib/graph-model";

// Chrome's software WebGL implementation is explicit in headless CI; production uses the device's GPU.
test.use({ serviceWorkers: "block", launchOptions: { args: ["--enable-unsafe-swiftshader"] } });

type ProbeWindow = Window & { __graphProbe: Sigma };
test.beforeEach(async ({ page }) => {
  // Observe the renderer in the test response only, without shipping a global/debug API.
  await page.route("**/_app/immutable/chunks/*.js", async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    if (body.includes("{primitives:")) body = body.replace(/new (\w+)\((\w+),(\w+),\{primitives:/,
      (_, constructor, graph, element) => `new(new Proxy(${constructor},{construct(t,a){const r=Reflect.construct(t,a);globalThis.__graphProbe=r;return r;}}))(${graph},${element},{primitives:`);
    await route.fulfill({ response, body });
  });
});

async function graphData(request: import("@playwright/test").APIRequestContext): Promise<GraphData> {
  return (await request.get("/graph.json")).json();
}

async function ready(page: import("@playwright/test").Page) {
  await expect(page.locator('[data-rendered="true"] canvas')).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as ProbeWindow).__graphProbe);
}

test("WebGL loads, filters and the keyboard list describe the same scope", async ({ page, request }) => {
  const data = await graphData(request);
  await page.goto("/graph/"); await ready(page);
  expect(await page.evaluate(() => !!(window as unknown as ProbeWindow).__graphProbe.getWebGLContext())).toBe(true);
  const surface = page.locator('[data-rendered="true"]');
  const box = (await surface.boundingBox())!;
  await page.mouse.move(box.x + 12, box.y + 12);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__graphProbe.getGraph().size)).toBe(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__graphProbe.getGraph().size)).toBe(data.links.length);
  const sources = page.locator('main button[aria-pressed]').filter({ hasText: /Sources/ });
  await sources.click();
  const expected = data.nodes.filter((n) => n.type !== "Source").length;
  await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__graphProbe.getGraph().order)).toBe(expected);
  await page.getByRole("button", { name: /Vue liste|List view/ }).click();
  const rows = page.locator('section[aria-label] > ul > li');
  await expect(rows).toHaveCount(expected);
  const select = rows.first().getByRole("button", { name: /Sélectionner dans le graphe|Select in the graph/ });
  const title = await rows.first().getByRole("heading").innerText();
  await select.focus(); await page.keyboard.press("Enter");
  await expect(page.locator("aside h2")).toHaveText(title);
  await sources.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__graphProbe.getGraph().order)).toBe(data.nodes.length);
});

test("article focus, source focus, search and sticky selection", async ({ page, request }) => {
  const data = await graphData(request), target = [...data.nodes].sort((a, b) => b.degree - a.degree)[0];
  await page.goto(`/wiki/${target.id}/`);
  if (!await page.locator('a[href*="focus="]:visible').count()) await page.getByRole("button", { name: "Actions", exact: true }).click();
  const graphLink = page.locator('a[href*="focus="]:visible').first();
  await expect(graphLink).toBeVisible(); await graphLink.click(); await ready(page);
  await expect(page.locator("aside h2")).toHaveText(target.title);
  await expect.poll(() => page.evaluate((id) => {
    const r = (window as unknown as ProbeWindow).__graphProbe;
    const n = r.getGraph().getNodeAttributes(id), p = r.graphToViewport({ x: n.x, y: n.y }), d = r.getDimensions();
    return p.x >= 0 && p.x <= d.width && p.y >= 0 && p.y <= d.height;
  }, target.id)).toBe(true);
  const framed = focusNodes(target.id, buildView(data, { off: new Set(), tag: "" })).map((n) => n.id);
  await expect.poll(() => page.evaluate((ids) => {
    const r = (window as unknown as ProbeWindow).__graphProbe, d = r.getDimensions();
    return ids.every((id) => { const n = r.getGraph().getNodeAttributes(id), p = r.graphToViewport({ x: n.x, y: n.y }); return p.x >= 20 && p.x <= d.width - 20 && p.y >= 20 && p.y <= d.height - 20; });
  }, framed)).toBe(true);
  const source = data.nodes.find((n) => n.type === "Source")!;
  await page.locator('main button[aria-pressed]').filter({ hasText: /Sources/ }).click();
  await page.locator("#graph-search").fill(source.title);
  await page.locator("#graph-search").press("Enter");
  await expect(page.locator("aside h2")).toHaveText(source.title);
  expect(await page.evaluate((id) => (window as unknown as ProbeWindow).__graphProbe.getGraph().hasNode(id), source.id)).toBe(true);
  // A hover cannot replace the selected context in either reducer or panel.
  const peer = data.nodes.find((n) => n.id !== source.id)!;
  await page.evaluate((id) => (window as unknown as ProbeWindow).__graphProbe.emit("enterNode", { node: id, event: {} } as never), peer.id);
  await expect(page.locator("aside h2")).toHaveText(source.title);
  const p = await page.evaluate((id) => (window as unknown as ProbeWindow).__graphProbe.getNodeDisplayData(id), source.id);
  expect(p?.backdropVisibility).toBe("visible");
  await page.getByRole("link", { name: /Ouvrir la page|Open (the )?page/, exact: true }).focus();
  await page.keyboard.press("Enter"); await expect(page).toHaveURL(new RegExp(`/wiki/${source.id}/$`));
});

test.describe("offline", () => {
  test.use({ serviceWorkers: "allow" });
  test("the precached renderer and graph work without a network", async ({ page, request, context }) => {
    const data = await graphData(request);
    await page.goto("/graph/");
    await expect(page.locator('[data-rendered="true"] canvas')).toBeVisible();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true })); });
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('[data-rendered="true"] canvas')).toBeVisible();
    await page.getByRole("button", { name: /Vue liste|List view/ }).click();
    await expect(page.locator('section[aria-label] > ul > li')).toHaveCount(data.nodes.length);
    await context.setOffline(false);
  });
});

test("reduced motion, source URL, tag scope and narrow screens", async ({ page, request }) => {
  const data = await graphData(request), source = data.nodes.find((n) => n.type === "Source")!;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/graph/?focus=${encodeURIComponent(source.id)}`); await ready(page);
  await expect(page.locator("aside h2")).toHaveText(source.title);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__graphProbe.getSetting("zoomDuration"))).toBe(0);
  const tag = data.nodes.find((n) => n.tags.length)?.tags[0];
  if (tag) {
    await page.locator("main select").selectOption(tag);
    await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__graphProbe.getGraph().order)).toBe(data.nodes.filter((n) => n.tags.includes(tag)).length);
    await page.getByRole("button", { name: /Vue liste|List view/ }).click();
    await expect(page.locator('section[aria-label] > ul > li')).toHaveCount(data.nodes.filter((n) => n.tags.includes(tag)).length);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("HTML list remains usable when WebGL is unavailable", async ({ page, request }) => {
  const data = await graphData(request);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type === "webgl2") return null;
      return original.call(this, type as "2d", ...args as []) as never;
    } as typeof original;
  });
  await page.goto("/graph/");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: /Vue liste|List view/ }).click();
  await expect(page.locator('section[aria-label] > ul > li')).toHaveCount(data.nodes.length);
});

test("dragging stays local, survives filters and resets on reload", async ({ page, request }) => {
  const data = await graphData(request), target = [...data.nodes].filter((n) => n.type !== "Source").sort((a, b) => b.degree - a.degree)[0];
  await page.goto("/graph/"); await ready(page);
  const idle = () => page.waitForFunction((edges) => {
    const r = (window as unknown as ProbeWindow).__graphProbe;
    return r.getGraph().size === edges && r.getSetting("renderLabels") && !r.getCamera().isAnimating();
  }, data.links.length);
  await idle();
  const before = await page.evaluate((id) => {
    const r = (window as unknown as ProbeWindow).__graphProbe, n = r.getGraph().getNodeAttributes(id), box = r.getContainer().getBoundingClientRect();
    const p = r.graphToViewport({ x: n.x, y: n.y });
    return { x: n.x, y: n.y, clientX: box.left + p.x, clientY: box.top + p.y };
  }, target.id);
  await page.mouse.move(before.clientX, before.clientY); await page.mouse.down();
  await page.mouse.move(before.clientX + 35, before.clientY + 25, { steps: 8 }); await page.mouse.up(); await idle();
  const position = () => page.evaluate((id) => {
    const n = (window as unknown as ProbeWindow).__graphProbe.getGraph().getNodeAttributes(id); return { x: n.x, y: n.y };
  }, target.id);
  const moved = await position();
  expect(Math.hypot(moved.x - before.x, moved.y - before.y)).toBeGreaterThan(1);
  const sources = page.locator('main button[aria-pressed]').filter({ hasText: /Sources/ });
  await sources.click(); await sources.click(); await idle();
  expect(await position()).toEqual(moved);
  await page.reload(); await ready(page); await idle();
  expect(await position()).toEqual({ x: before.x, y: before.y });
});
