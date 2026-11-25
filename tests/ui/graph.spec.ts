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
  await expect(page.locator('[data-rendered="true"] canvas.sigma-stage')).toBeVisible();
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
  // the selected page's links carry moving dots for their direction, on a canvas that never takes the pointer
  const flow = page.locator("canvas[data-flow]");
  await expect.poll(async () => Number(await flow.getAttribute("data-flow"))).toBeGreaterThan(0);
  await expect(flow).toHaveCSS("pointer-events", "none");
  await expect(flow).toHaveAttribute("aria-hidden", "true");
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
    await expect(page.locator('[data-rendered="true"] canvas.sigma-stage')).toBeVisible();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true })); });
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('[data-rendered="true"] canvas.sigma-stage')).toBeVisible();
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
  await page.waitForTimeout(300);
  expect(await page.locator("canvas[data-flow]").getAttribute("data-flow"), "no moving dots under reduced motion").not.toMatch(/^[1-9]/);
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

test("map mode: islands of land under the pages, kept in the URL, back to the graph", async ({ page }) => {
  await page.goto("/graph/"); await ready(page);
  const surface = page.locator("[data-graph-surface] > div").first();
  const land = page.locator("canvas.sigma-land");
  const inked = () => land.evaluate((c: HTMLCanvasElement) => { const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  await expect.poll(inked, "no land in graph mode").toBe(0);
  await page.getByRole("button", { name: /^(Carte|Map)$/ }).click();
  await expect(page).toHaveURL(/[?&]view=map/);
  await expect(surface).toHaveAttribute("data-mode", "map");
  await expect.poll(inked, "the islands are drawn").toBeGreaterThan(1000);
  await expect(land).toHaveCSS("pointer-events", "none");
  await page.reload(); await ready(page);
  await expect(surface).toHaveAttribute("data-mode", "map");
  await expect(page.getByRole("button", { name: /^(Carte|Map)$/ })).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: /^(Graphe|Graph)$/ }).click();
  await expect(page).not.toHaveURL(/view=map/);
  await expect.poll(inked).toBe(0);
});

// Journey: the map played as a trip. The fixture graph: alpha is linked (both ways) to beta, gamma and overview, source-one cites alpha, overview cites beta.
const journeyButton = (page: import("@playwright/test").Page) => page.getByRole("button", { name: /^(Voyage|Journey)$/ });
const journeyPanel = (page: import("@playwright/test").Page) => page.getByRole("complementary", { name: /^(Voyage|Journey)$/ });
const routeOf = (page: import("@playwright/test").Page) => new URL(page.url()).searchParams.get("route");
const opacity = (page: import("@playwright/test").Page, id: string) => page.evaluate((i) => (window as unknown as ProbeWindow).__graphProbe.getNodeDisplayData(i)?.opacity, id);
async function startAt(page: import("@playwright/test").Page, title: string) {
  await page.locator("#graph-search").fill(title);
  await page.locator("#graph-search").press("Enter");
}

test("journey: a departure, a destination, the log, the shared URL, back", async ({ page }) => {
  await page.goto("/graph/"); await ready(page);
  await journeyButton(page).click();
  await expect(page).toHaveURL(/[?&]view=journey/);
  await expect(page.locator("[data-graph-surface] > div").first()).toHaveAttribute("data-mode", "journey");
  const panel = journeyPanel(page), steps = panel.locator("ol > li");
  await expect(panel).toContainText(/Choisissez une page de départ|Choose a departure page/);
  await expect(steps).toHaveCount(0);
  const trail = page.locator("canvas.sigma-journey");
  const inked = () => trail.evaluate((c: HTMLCanvasElement) => { const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  await expect(trail).toHaveCSS("pointer-events", "none");
  expect(await inked(), "no trail before the first step").toBe(0);

  await startAt(page, "Alpha");
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Alpha concept");
  await expect(steps).toHaveCount(1);
  expect(routeOf(page)).toBe("concepts/alpha");
  // the destinations: the pages it cites, then the ones that cite it (the mutual links count once)
  await expect(panel.getByRole("button", { name: /Beta concept/ })).toBeVisible();
  await expect(panel.getByRole("button", { name: /Source one/ })).toBeVisible();

  await panel.getByRole("button", { name: /Beta concept/ }).click();
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Beta concept");
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(1).getByRole("button")).toHaveAttribute("aria-current", "step");
  expect(routeOf(page)).toBe("concepts/alpha,concepts/beta");
  await expect.poll(inked, "the route stays drawn").toBeGreaterThan(50);
  // the camera frames the current page; its destinations and the stops made stay in view, the other pages are dimmed
  await expect.poll(() => page.evaluate(() => { const r = (window as unknown as ProbeWindow).__graphProbe, d = r.getDimensions(), n = r.getGraph().getNodeAttributes("concepts/beta"), p = r.graphToViewport({ x: n.x, y: n.y }); return !r.getCamera().isAnimating() && p.x >= 0 && p.x <= d.width && p.y >= 0 && p.y <= d.height; })).toBe(true);
  await expect.poll(() => opacity(page, "syntheses/overview")).toBe(1);
  await expect.poll(() => opacity(page, "concepts/alpha")).toBe(1);
  await expect.poll(() => opacity(page, "entities/gamma")).toBeLessThan(0.5);

  // another page than a destination is refused, nothing changes
  await startAt(page, "Gamma");
  await expect(page.getByRole("status").filter({ hasText: /pas reliée|not linked/ })).toBeVisible();
  await expect(steps).toHaveCount(2);

  // the URL restores the route: both steps and the camera on the last one
  await page.reload(); await ready(page);
  await expect(journeyButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(steps).toHaveCount(2);
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Beta concept");
  await expect.poll(inked).toBeGreaterThan(50);
  await expect.poll(() => opacity(page, "entities/gamma")).toBeLessThan(0.5);

  // back to the previous step, then out of the journey: the URL drops the route
  await panel.getByRole("button", { name: /Étape précédente|Previous step/ }).click();
  await expect(steps).toHaveCount(1);
  expect(routeOf(page)).toBe("concepts/alpha");
  await page.getByRole("button", { name: /^(Carte|Map)$/ }).click();
  await expect(page).toHaveURL(/view=map/); expect(routeOf(page)).toBeNull();
  await expect.poll(inked, "the trail is a journey feature").toBe(0);
});

test("journey: a settlement on the map is the next step, unknown or unlinked ids in the URL are ignored", async ({ page }) => {
  await page.goto("/graph/?view=journey&route=concepts/alpha,nope,concepts/beta,entities/gamma,sources/source-one"); await ready(page);
  const panel = journeyPanel(page), steps = panel.locator("ol > li");
  // gamma and source-one are not linked to beta: ignored, as is the unknown id
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(1)).toContainText("Beta concept");
  await expect.poll(() => routeOf(page)).toBe("concepts/alpha,concepts/beta");
  await page.goto("/graph/?view=journey&route=nope"); await ready(page);
  await expect(panel).toContainText(/Choisissez une page de départ|Choose a departure page/);
  await expect(journeyPanel(page).locator("ol > li")).toHaveCount(0);
  // a click on a settlement of the map starts the route, then goes on to a linked one
  const idle = () => page.waitForFunction((edges) => { const r = (window as unknown as ProbeWindow).__graphProbe; return r.getGraph().size === edges && r.getSetting("renderLabels") && !r.getCamera().isAnimating(); }, 5);
  const click = async (id: string) => {
    await idle();
    const at = await page.evaluate((i) => { const r = (window as unknown as ProbeWindow).__graphProbe, n = r.getGraph().getNodeAttributes(i), box = r.getContainer().getBoundingClientRect(), p = r.graphToViewport({ x: n.x, y: n.y }); return { x: box.left + p.x, y: box.top + p.y }; }, id);
    await page.mouse.click(at.x, at.y);
  };
  await click("concepts/alpha");
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Alpha concept");
  await click("entities/gamma");
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Gamma entity");
  await expect(panel.locator("ol > li")).toHaveCount(2);
});

test("journey: everything from the panel with the keyboard, the log, replay, clear, copy link", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/graph/?view=journey"); await ready(page);
  const panel = journeyPanel(page), steps = panel.locator("ol > li"), heading = panel.getByRole("heading", { level: 2 });
  await startAt(page, "Alpha");
  await expect(heading).toHaveText("Alpha concept");
  // a destination chosen with Enter: the focus lands on the new current page, the step is announced
  const toBeta = panel.getByRole("button", { name: /Beta concept/ });
  await toBeta.focus(); await page.keyboard.press("Enter");
  await expect(heading).toHaveText("Beta concept"); await expect(heading).toBeFocused();
  await expect(panel.locator("[aria-live]")).toHaveText(/(Étape|Step) 2 (sur|of) 2/);
  await panel.getByRole("button", { name: /Overview synthesis/ }).focus(); await page.keyboard.press("Space");
  await expect(heading).toHaveText("Overview synthesis"); await expect(steps).toHaveCount(3);
  await expect(panel.getByRole("link", { name: /Lire la page|Read the page/ })).toHaveAttribute("href", /syntheses\/overview/);
  await expect(steps.first().getByRole("link")).toHaveAttribute("href", /concepts\/alpha/);
  // replay: the camera goes through every step again; Escape stops it
  const replay = panel.getByRole("button", { name: /^(Rejouer|Replay)$/ });
  await replay.click();
  await expect(panel.getByRole("button", { name: /^(Arrêter|Stop)$/ })).toBeVisible();
  await expect(panel.locator("[aria-live]")).toHaveText(/(Étape|Step) 1 (sur|of) 3/);
  await page.keyboard.press("Escape");
  await expect(replay).toBeVisible();
  await expect(panel.locator("[aria-live]")).toHaveText(/(Étape|Step) 3 (sur|of) 3/);
  await replay.click();
  await expect(replay).toBeVisible({ timeout: 10_000 }); // it ends by itself
  await expect(steps).toHaveCount(3);
  // the second step of the log: back to it, the route stops right after it
  await steps.nth(1).getByRole("button").focus(); await page.keyboard.press("Enter");
  await expect(steps).toHaveCount(2); await expect(heading).toHaveText("Beta concept");
  expect(routeOf(page)).toBe("concepts/alpha,concepts/beta");
  // the link of the route goes to the clipboard
  await panel.getByRole("button", { name: /Copier le lien|Copy link/ }).click();
  await expect(page.getByRole("status").filter({ hasText: /copié|copied/ })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
  // clear: nothing left, the invitation comes back
  await panel.getByRole("button", { name: /^(Effacer|Clear)$/ }).click();
  await expect(steps).toHaveCount(0); expect(routeOf(page)).toBeNull();
  await expect(panel).toContainText(/Choisissez une page de départ|Choose a departure page/);
});

test("journey: the panel sits below the map on a narrow screen, without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/graph/?view=journey&route=concepts/alpha,concepts/beta"); await ready(page);
  const panel = journeyPanel(page);
  await expect(panel.locator("ol > li")).toHaveCount(2);
  const [surface, aside] = await Promise.all([page.locator("[data-graph-surface]").boundingBox(), panel.boundingBox()]);
  expect(aside!.y).toBeGreaterThanOrEqual(surface!.y + surface!.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
