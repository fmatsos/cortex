import type { Page, Route } from "@playwright/test";
import { expect, test } from "./helpers";
import type { GraphData } from "../../site/src/lib/types";

// Follow-up of the accessibility review: a review reply stays with the page it was launched for, focus indicators are
// opaque outlines, the focus lands somewhere when the graph list is left, the link animation can be stopped, the wiki text
// keeps its own language, the reasons of related pages read as text on touch screens, and the two reading-comfort options.
// There is no `cortex serve` here: `/api/*` is a mock. Service workers are blocked so that a reload never lets one answer.
test.use({ serviceWorkers: "block", launchOptions: { args: ["--enable-unsafe-swiftshader"] } });

const RELATED = /^(Related pages|Pages liées)/;
const prefs = (page: Page) => page.getByRole("banner").getByRole("button", { name: /^(Preferences|Préférences)/ });
const menu = (page: Page) => page.getByRole("menu");

/** Contrast of the focus outline of `el` (or of the element `pick` finds from it) against the first opaque background above it. */
async function outlineLook(page: Page, selector: string, pick: "self" | "parent" = "self") {
  return page.locator(selector).first().evaluate((node, which) => {
    const el = which === "parent" ? node.parentElement! : node;
    const rgba = (css: string) => {
      const c = document.createElement("canvas"); c.width = c.height = 1;
      const x = c.getContext("2d")!; x.clearRect(0, 0, 1, 1); x.fillStyle = css; x.fillRect(0, 0, 1, 1);
      return [...x.getImageData(0, 0, 1, 1).data];
    };
    const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const cs = getComputedStyle(el), color = rgba(cs.outlineColor);
    let bg = [255, 255, 255, 0];
    for (let n: Element | null = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] === 255) { bg = c; break; } }
    const [hi, lo] = [lum(color), lum(bg)].sort((a, b) => b - a);
    return { style: cs.outlineStyle, width: cs.outlineWidth, alpha: color[3], ratio: (hi + 0.05) / (lo + 0.05) };
  }, pick);
}
const expectOpaqueOutline = (look: Awaited<ReturnType<typeof outlineLook>>) => {
  expect(look.style).toBe("solid");
  expect(look.width).toBe("2px");
  expect(look.alpha).toBe(255);
  expect(look.ratio).toBeGreaterThanOrEqual(3);
};

async function mockAsk(page: Page) {
  await page.route("**/api/ask", async (route: Route) => {
    if (route.request().method() === "HEAD") return route.fulfill({ status: 204 });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ segments: [{ html: "<p>An answer in the wiki's language.</p>" }], md: "An answer.", cited: ["concepts/alpha"], retained: [], related: [], model: "test-model" }) });
  });
}

test.describe("review reply", () => {
  // The fixture wiki has no review notion (`features.review` is compiled in): the flag is turned on in the served chunk only.
  test.beforeEach(async ({ page }) => {
    await page.route("**/_app/immutable/chunks/*.js", async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      await route.fulfill({ response, body: body.replace("{review:!1,drafts:!1}", "{review:!0,drafts:!1}") });
    });
  });

  test("a reply that arrives after a navigation never marks or announces the page now shown", async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((ok) => (release = ok));
    const posted: string[] = [];
    await page.route("**/api/verify", async (route) => {
      if (route.request().method() === "HEAD") return route.fulfill({ status: 204 });
      posted.push(JSON.parse(route.request().postData()!).id);
      await held;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ by: "human:test" }) });
    });
    await page.goto("/wiki/concepts/alpha/");
    const mark = page.getByRole("button", { name: "Mark as reviewed" });
    await expect(mark).toBeVisible();
    await mark.click();
    await expect.poll(() => posted).toEqual(["concepts/alpha"]);
    // to Beta (client-side navigation) before the reply
    await page.getByRole("link", { name: "Beta concept" }).first().click();
    await expect(page).toHaveURL(/concepts\/beta\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Beta concept");
    release();
    await page.waitForTimeout(300);
    // Beta is still to be reviewed: its button is there and enabled, no confirmation, no "reviewed" state
    await expect(page.getByRole("button", { name: "Mark as reviewed" })).toBeEnabled();
    await expect(page.locator("p[role=status]").filter({ hasText: /marked as reviewed/ })).toHaveCount(0);
    await expect(page.getByText("never reviewed")).not.toHaveCount(0);
    // back on Alpha, the reply it was launched for is there
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alpha concept");
    await expect(page.getByText(/reviewed on .*Reviewed by human:test/i).first()).toBeAttached();
    await expect(page.getByRole("button", { name: "Mark as reviewed" })).toHaveCount(0);
  });
});

test.describe("focus indicators", () => {
  const schemes = ["light", "dark"] as const;

  test("related page links and the assistant's question frame have an opaque 2 px outline, 3:1 at least, in both themes", async ({ page }) => {
    await mockAsk(page);
    await page.goto("/wiki/syntheses/overview/");
    await page.keyboard.press("Tab"); // keyboard modality: a focus() from here is a focus-visible
    const link = page.getByRole("complementary").getByRole("region", { name: RELATED }).getByRole("link").first();
    await link.focus();
    expect(await link.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      expectOpaqueOutline(await outlineLook(page, 'aside a[class*="group"]:focus-visible'));
    }
    // the assistant: the frame around the field carries it, the field itself has none
    await page.locator("#assistant-toggle").click();
    await page.keyboard.press("Tab");
    await page.locator("#assistant-q").focus();
    await expect(page.locator("#assistant-q")).toBeFocused();
    expect(await page.locator("#assistant-q").evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      expectOpaqueOutline(await outlineLook(page, "#assistant-q", "parent"));
    }
  });

  test("controls that also draw a translucent ring keep the global opaque outline (graph filter and neighbour buttons)", async ({ page }) => {
    const hub = ((await (await page.request.get("/graph.json")).json()) as GraphData).nodes.sort((a, b) => b.degree - a.degree)[0];
    await page.goto(`/graph/?focus=${encodeURIComponent(hub.id)}`);
    await expect(page.locator("aside h2")).toHaveText(hub.title);
    await page.keyboard.press("Tab");
    await page.locator("main button[aria-pressed]").first().focus();
    await page.locator("aside ul button").first().focus();
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.locator("main button[aria-pressed]").first().focus();
      expectOpaqueOutline(await outlineLook(page, "main button[aria-pressed]:focus-visible"));
      await page.locator("aside ul button").first().focus();
      expectOpaqueOutline(await outlineLook(page, "aside ul button:focus-visible"));
    }
  });
});

test.describe("graph", () => {
  const ready = async (page: Page) => { await expect(page.locator('[data-rendered="true"] canvas.sigma-stage')).toBeVisible(); };
  const top = async (page: Page) => ((await (await page.request.get("/graph.json")).json()) as GraphData).nodes.sort((a, b) => b.degree - a.degree)[0];

  test("from the list, 'Select in the graph' puts the focus on the panel title and announces it", async ({ page }) => {
    await page.goto("/graph/"); await ready(page);
    await page.getByRole("button", { name: /Vue liste|List view/ }).click();
    const row = page.locator("section[aria-label] > ul > li").first();
    const title = await row.getByRole("heading").innerText();
    const select = row.getByRole("button", { name: /Sélectionner dans le graphe|Select in the graph/ });
    await select.focus();
    await page.keyboard.press("Enter");
    const heading = page.locator("aside h2");
    await expect(heading).toHaveText(title);
    await expect(heading).toBeFocused();
    await expect(page.locator("[data-graph-announce]")).toContainText(title);
    await expect(page.locator("[data-graph-announce]")).toContainText(/\d+ (neighbour|voisin)/);
  });

  test("choosing a neighbour in the panel keeps the focus in the panel, on the new title", async ({ page }) => {
    const hub = await top(page);
    await page.goto(`/graph/?focus=${encodeURIComponent(hub.id)}`); await ready(page);
    await expect(page.locator("aside h2")).toHaveText(hub.title);
    const neighbour = page.locator("aside ul button").first();
    const name = (await neighbour.innerText()).trim();
    await neighbour.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("aside h2")).toHaveText(name);
    await expect(page.locator("aside h2")).toBeFocused();
  });

  test("the link animation stops on request, the selection and its links stay, and the choice is remembered", async ({ page }) => {
    const hub = await top(page);
    await page.goto(`/graph/?focus=${encodeURIComponent(hub.id)}`); await ready(page);
    const flow = page.locator("canvas[data-flow]");
    await expect.poll(async () => Number(await flow.getAttribute("data-flow"))).toBeGreaterThan(0);
    const toggle = page.locator("[data-flow-toggle]");
    await expect(toggle).toHaveText(/Arrêter l'animation des liens|Stop link animation/);
    await toggle.click();
    await expect.poll(async () => Number(await flow.getAttribute("data-flow"))).toBe(0);
    await expect(toggle).toHaveText(/Reprendre l'animation des liens|Resume link animation/);
    await expect(page.locator("aside h2")).toHaveText(hub.title); // still selected, panel and relations unchanged
    await page.reload(); await ready(page);
    await expect(page.locator("[data-flow-toggle]")).toHaveText(/Reprendre|Resume/);
    await page.waitForTimeout(400);
    expect(Number(await page.locator("canvas[data-flow]").getAttribute("data-flow"))).toBe(0);
    await page.locator("[data-flow-toggle]").click();
    await expect.poll(async () => Number(await page.locator("canvas[data-flow]").getAttribute("data-flow"))).toBeGreaterThan(0);
  });

  test("under reduced motion there is nothing to stop: no control", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/graph/"); await ready(page);
    await expect(page.locator("[data-flow-toggle]")).toHaveCount(0);
  });
});

test.describe("content language", () => {
  test.skip(({ isMobile }) => isMobile, "menu flow: desktop project only");
  test("the article text keeps the wiki's language when the interface language changes", async ({ page }) => {
    await page.goto("/wiki/concepts/alpha/");
    const html = page.locator("html"), body = page.locator("article > .wiki"), title = page.getByRole("heading", { level: 1 });
    const content = await html.getAttribute("lang"); // the fixture has no `language`: content and interface share the default
    await expect(body).toHaveAttribute("lang", content!);
    await prefs(page).click();
    await menu(page).getByRole("menuitemradio", { name: "Français", exact: true }).click();
    await expect(html).toHaveAttribute("lang", "fr");
    await expect(body).toHaveAttribute("lang", content!);
    await expect(title).toHaveAttribute("lang", content!);
    await expect(page.locator("main p[lang]").first()).toHaveAttribute("lang", content!);
    // the related pages' titles too
    await expect(page.locator('aside a[class*="group"] > span > span[lang]').first()).toHaveAttribute("lang", content!);
  });
});

test.describe("content language: the other zones", () => {
  // interface in French (remembered choice), wiki text in the default language of the export: `lang` of a zone is the wiki's
  test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem("cortex:lang", "fr")); });

  test("breadcrumb page title, table of contents headings (not its Notes and Sources, which are interface text)", async ({ page, isMobile }) => {
    await page.goto("/wiki/concepts/alpha/");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    const wiki = await page.locator("article > .wiki").getAttribute("lang");
    await expect(page.getByRole("navigation", { name: "Fil d'Ariane" }).locator('[aria-current="page"]')).toHaveAttribute("lang", wiki!);
    const toc = page.locator(isMobile ? "#toc-sheet" : 'nav[aria-labelledby="h-toc"]'); // the sheet of narrow screens, in the DOM even closed
    await expect(toc.locator("a", { hasText: "First part" })).toHaveAttribute("lang", wiki!);
    for (const id of ["h-notes", "h-sources"]) for (const a of await toc.locator(`a[href="#${id}"]`).all()) expect(await a.getAttribute("lang"), id).toBeNull();
  });

  test("result rows (title, description), lists and the journal", async ({ page }) => {
    await page.goto("/search/?q=alpha");
    const wiki = await page.goto("/wiki/concepts/alpha/").then(() => page.locator("article > .wiki").getAttribute("lang"));
    await page.goto("/search/?q=alpha");
    const row = page.locator("[data-row-action=open]").first();
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("lang", wiki!);
    await expect(page.locator("[data-row-description]").first()).toHaveAttribute("lang", wiki!);
    await page.goto("/log/");
    await expect(page.locator("li.entry .wiki").first()).toHaveAttribute("lang", wiki!);
    await expect(page.locator("li.entry ul a").first()).toHaveAttribute("lang", wiki!);
    await page.goto("/");
    await expect(page.locator("ol a[lang]").first()).toHaveAttribute("lang", wiki!); // the news: titles of the pages
  });
});

test.describe("reasons of related pages on touch screens", () => {
  test.skip(({ isMobile }) => !isMobile, "touch project only");
  test("the reasons are visible text under the title (and read once by screen readers)", async ({ page }) => {
    await page.goto("/wiki/syntheses/overview/");
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const reasons = page.locator("aside [data-reasons]");
    await expect(reasons.first()).toBeVisible();
    await expect(reasons.first()).toHaveAttribute("aria-hidden", "true");
    const all = await reasons.allInnerTexts();
    expect(all.join(" ")).toMatch(/shared theme|thème commun/);
    expect(all.join(" ")).toMatch(/shared source|source commune/);
  });
});

test.describe("reading comfort", () => {
  test.skip(({ isMobile }) => isMobile, "menu flow: desktop project only");
  test.use({ viewport: { width: 1440, height: 900 } });
  const size = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => { const cs = getComputedStyle(el); return { font: cs.fontSize, width: el.getBoundingClientRect().width, ch: parseFloat(cs.fontSize) * 0.5 }; });
  const toggle = (page: Page, name: RegExp) => menu(page).getByRole("menuitemcheckbox", { name });

  test("'Reading' is off by default, enlarges and narrows the article, is remembered and applies before first paint", async ({ page }) => {
    await page.goto("/wiki/concepts/alpha/");
    const before = await size(page, "article > .wiki");
    await prefs(page).click();
    const option = toggle(page, /Articles: larger text|Articles : texte agrandi/);
    await expect(option).toHaveAttribute("aria-checked", "false");
    await option.click();
    await expect(option).toHaveAttribute("aria-checked", "true");
    await expect(menu(page)).toBeVisible(); // the menu stays open, the effect can be seen
    await expect(page.locator("html")).toHaveAttribute("data-reading", "");
    const after = await size(page, "article > .wiki");
    expect(after.font).toBe("20px");
    expect(parseFloat(before.font)).toBeLessThan(20);
    expect(after.width).toBeLessThan(before.width);
    // remembered, and set by the inline script of the document before the app starts
    await page.reload({ waitUntil: "commit" });
    await page.waitForFunction(() => document.documentElement.hasAttribute("data-reading"));
    expect(await page.evaluate(() => localStorage.getItem("cortex:reading"))).toBe("1");
    await prefs(page).click();
    await toggle(page, /Articles: larger text|Articles : texte agrandi/).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-reading", "");
    expect(await page.evaluate(() => localStorage.getItem("cortex:reading"))).toBeNull();
  });

  test("'Comfortable text' enlarges the assistant's answers only, and is remembered", async ({ page }) => {
    await mockAsk(page);
    await page.goto("/wiki/concepts/alpha/");
    await page.locator("#assistant-toggle").click();
    await page.locator("#assistant-q").fill("What is alpha?");
    await page.locator("#assistant-q").press("Enter");
    const answer = page.locator("#assistant-panel .wiki");
    await expect(answer).toContainText("An answer in the wiki's language.");
    expect(await answer.evaluate((el) => el.closest("[lang]")?.getAttribute("lang"))).toMatch(/^[a-z]{2}/);
    expect((await size(page, "#assistant-panel .wiki")).font).toBe("14px");
    await page.locator("#assistant-panel").getByRole("button", { name: /Close|Fermer/ }).first().click();
    await prefs(page).click();
    await toggle(page, /Comfortable text|Texte confortable/).click();
    await expect(page.locator("html")).toHaveAttribute("data-assistant-comfort", "");
    await page.keyboard.press("Escape");
    await page.locator("#assistant-toggle").click();
    expect((await size(page, "#assistant-panel .wiki")).font).toBe("17px");
    expect((await size(page, "article > .wiki")).font).not.toBe("17px"); // the article is not touched
    expect(await page.evaluate(() => localStorage.getItem("cortex:assistant-comfort"))).toBe("1");
  });
});
