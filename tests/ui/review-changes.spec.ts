import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./helpers";
import { staticServer } from "./static-server";

// The review queue (/review/) and « what is new since my last visit » (/changes/), on a wiki with `review` turned on. The base
// fixture of the other specs has review off: it serves the « off » checks. This spec exports its own copy of the fixture.
const here = import.meta.dirname;
test.describe.configure({ mode: "serial" });
test.use({ serviceWorkers: "block" });

let base = "", cleanup = async () => {};
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const tmp = mkdtempSync(join(tmpdir(), "cortex-review-ui-")), wiki = join(tmp, "wiki-root"), out = join(tmp, "site");
  cpSync(join(here, "fixture"), wiki, { recursive: true });
  writeFileSync(join(wiki, "cortex.json"), '{"review":true}');
  const edit = (file: string, fn: (s: string) => string) => writeFileSync(join(wiki, file), fn(readFileSync(join(wiki, file), "utf8")));
  // alpha: reviewed, then modified (to review again); beta: reviewed and up to date; the others never reviewed
  edit("wiki/concepts/alpha.md", (s) => s.replace("status: stable\n", "status: stable\nverified: { by: me, at: 2026-10-01T10:00:00+01:00 }\n"));
  edit("wiki/concepts/beta.md", (s) => s.replace("status: stable\n", "status: stable\nverified: { by: me, at: 2026-11-20T10:00:00+01:00 }\n"));
  edit("wiki/entities/gamma.md", (s) => s.replace("2026-11-04T10:00:00+01:00", "2026-11-12T10:00:00+01:00"));
  edit("wiki/syntheses/overview.md", (s) => s.replace("2026-11-04T10:00:00+01:00", "2026-11-06T10:00:00+01:00"));
  edit("wiki/log.jsonl", (s) => `${s.trimEnd()}\n${JSON.stringify({ at: "2026-11-12T09:00:00+01:00", kind: "ingest", text: "compiled: 1 page(s) created, 0 updated.", pages: ["wiki/entities/gamma.md"] })}\n`);
  let r = spawnSync("bun", [join(here, "../../src/cortex.ts"), "export", "--out", out], { env: { ...process.env, CORTEX_ROOT: wiki }, encoding: "utf8" });
  for (let i = 0; i < 20 && r.status !== 0 && /already running/.test(r.stderr + r.stdout); i++) {
    await sleep(5000); // another export holds site/.export.lock
    r = spawnSync("bun", [join(here, "../../src/cortex.ts"), "export", "--out", out], { env: { ...process.env, CORTEX_ROOT: wiki }, encoding: "utf8" });
  }
  if (r.status !== 0) { rmSync(tmp, { recursive: true, force: true }); throw new Error(`cortex export failed (${r.status}):\n${r.stdout}\n${r.stderr}`); }
  const server = staticServer(() => out);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  cleanup = async () => { await new Promise((ok) => server.close(ok)); rmSync(tmp, { recursive: true, force: true }); };
});
test.afterAll(async () => { await cleanup(); });

const mockVerify = async (page: Page, available: boolean, posts: string[] = []) =>
  page.route(/\/api\/verify$/, (route) => {
    const req = route.request();
    if (req.method() === "HEAD") return route.fulfill({ status: available ? 204 : 404 });
    posts.push(req.postData() ?? "");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ by: "me" }) });
  });
/** Screenshots: light on the desktop project, dark on the mobile one. */
const shot = async (page: Page, info: import("@playwright/test").TestInfo, name: string) => {
  await page.emulateMedia({ colorScheme: info.project.name === "mobile" ? "dark" : "light" });
  await page.waitForTimeout(400); // colours transition (120-180 ms) when the scheme changes: a shot taken at once shows them half way (washed out)
  await page.screenshot({ path: info.outputPath(`${name}-${info.project.name}.png`), fullPage: true });
};
const titles = (page: Page) => page.locator("main ol li > div > a").allInnerTexts();

test.describe("header of a wiki with review and a reading path: the longest row (8 entries)", () => {
  test("Review and What's new are in the header, with Paths; the row stays on one line at the widths where it is laid out", async ({ page }, info) => {
    const widths = info.project.name === "mobile" ? [] : [1440, 1280, 1100, 900];
    await page.goto(`${base}/`);
    const nav = page.getByRole("banner").getByRole("navigation");
    if (await nav.getByRole("button", { name: "Menu" }).isVisible()) await nav.getByRole("button", { name: "Menu" }).click();
    await expect(nav.getByRole("link", { name: "Review", exact: true })).toHaveAttribute("href", /\/review\/$/);
    await expect(nav.getByRole("link", { name: "What's new" })).toHaveAttribute("href", /\/changes\/$/);
    await expect(nav.getByRole("link", { name: "Paths" })).toHaveAttribute("href", /\/paths\/$/);
    expect(await nav.getByRole("link").count()).toBe(8);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${base}/graph/`);
      await expect(nav.getByRole("link", { name: "Paths" })).toBeVisible();
      await expect(nav.getByRole("button")).toBeHidden();
      const tops = await Promise.all((await nav.getByRole("link").all()).map(async (l) => Math.round((await l.boundingBox())!.y)));
      expect(new Set(tops).size, `${width} px: link tops ${tops}`).toBe(1);
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth), `${width} px: no horizontal scroll`).toBe(true);
      const field = (await page.getByRole("banner").locator("input[role=combobox]").boundingBox())!;
      expect(field.width, `${width} px: the search field keeps its room`).toBeGreaterThanOrEqual(240);
    }
  });
});

test.describe("review queue", () => {
  test("lists the pages to review with reason, date and type, longest wait first, and validates nothing", async ({ page }) => {
    const posts: string[] = [];
    await mockVerify(page, false, posts);
    await page.goto(`${base}/review/`);
    await expect(page.getByRole("heading", { level: 1, name: "Review queue" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /^4 pages to review/ })).toBeVisible();
    // to review again first, then never reviewed, the oldest first
    expect(await titles(page)).toEqual(["Alpha concept", "Source one", "Overview synthesis", "Gamma entity"]);
    const rows = page.locator("main ol > li");
    await expect(rows.nth(0)).toContainText("Modified since review");
    await expect(rows.nth(0)).toContainText("reviewed on October 1, 2026");
    await expect(rows.nth(0)).toContainText("modified on November 4, 2026");
    await expect(rows.nth(3)).toContainText("Never reviewed");
    await expect(rows.nth(3)).toContainText("written on November 12, 2026");
    await expect(rows.nth(3)).toContainText("Entity");
    // read-only: no button in the list, and the static site says why
    await expect(page.locator("main li button")).toHaveCount(0);
    await expect(page.getByText("read-only")).toBeVisible();
    expect(posts).toEqual([]);
  });

  test("with the API: the hint changes, still nothing is validated from the list", async ({ page }) => {
    const posts: string[] = [];
    await mockVerify(page, true, posts);
    await page.goto(`${base}/review/`);
    await expect(page.getByText("Each page has its")).toBeVisible();
    await expect(page.getByRole("button", { name: /mark as reviewed/i })).toHaveCount(0);
    expect(posts).toEqual([]);
  });

  test("from the queue: position, next page after a deliberate validation, never an automatic move", async ({ page }, info) => {
    const posts: string[] = [];
    await mockVerify(page, true, posts);
    await page.goto(`${base}/review/`);
    await page.getByRole("link", { name: "Start reviewing" }).click();
    await expect(page).toHaveURL(/\/wiki\/concepts\/alpha\/\?queue=review$/);
    const queue = page.getByRole("navigation", { name: "Review queue" });
    await expect(queue).toContainText("Review queue: page 1 of 4");
    const next = queue.getByRole("link", { name: /^Next in the queue/ });
    await expect(next).toHaveAccessibleName(/^Next in the queue\s*: Source one$/);
    await page.getByRole("button", { name: "Mark as reviewed" }).click();
    // one message per fact: the page says it is marked as reviewed, the queue bar only says what comes next
    await expect(page.getByRole("status").filter({ hasText: "Page marked as reviewed" })).toHaveCount(1);
    await expect(queue.getByRole("status")).toHaveText("You can go on to the next page of the queue.");
    await expect(queue).not.toContainText("marked as reviewed");
    await shot(page, info, "article-queue");
    await page.waitForTimeout(400);
    await expect(page).toHaveURL(/\/wiki\/concepts\/alpha\/\?queue=review$/); // the reader moves on, the page does not
    expect(posts).toEqual([JSON.stringify({ id: "concepts/alpha" })]);
    await next.click();
    await expect(page).toHaveURL(/\/wiki\/sources\/source-one\/\?queue=review$/);
    await expect(page.getByRole("navigation", { name: "Review queue" })).toContainText("page 2 of 4");
    // the validated page leaves the list for this tab until the site is rebuilt
    await page.getByRole("link", { name: "See the queue" }).click();
    await expect(page.getByRole("heading", { level: 2, name: /^3 pages to review/ })).toBeVisible();
    expect(await titles(page)).toEqual(["Source one", "Overview synthesis", "Gamma entity"]);
  });

  test("the last page of the queue says so; a page opened outside the queue shows no queue", async ({ page }) => {
    await mockVerify(page, true);
    await page.goto(`${base}/review/`);
    await page.getByRole("link", { name: "Gamma entity" }).click();
    const queue = page.getByRole("navigation", { name: "Review queue" });
    await expect(queue).toContainText("page 4 of 4");
    await expect(queue).toContainText("End of the queue.");
    await expect(queue.getByRole("link", { name: /Next in the queue/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Mark as reviewed" }).click();
    await expect(queue.getByRole("status")).toHaveText("End of the queue."); // after the validation: announced once, not twice
    await expect(queue.getByText("End of the queue.")).toHaveCount(1);
    await page.goto(`${base}/wiki/entities/gamma/`);
    await expect(page.getByRole("heading", { level: 1, name: "Gamma entity" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Review queue" })).toHaveCount(0);
  });

  test("reachable from the search facets (desktop: the facets are in the page), and the screenshots of the queue", async ({ page, isMobile }, info) => {
    await mockVerify(page, false);
    if (!isMobile) {
      await page.goto(`${base}/search/?q=`);
      await expect(page.getByRole("link", { name: "Open the review queue" })).toHaveAttribute("href", /\/review\/$/);
    }
    await page.goto(`${base}/review/`);
    await expect(page.getByRole("heading", { level: 2, name: /pages to review/ })).toBeVisible();
    await shot(page, info, "review");
  });
});

test.describe("changes since the last visit", () => {
  const STORE = "cortex:changes-seen";
  const seen = (page: Page) => page.evaluate((k) => localStorage.getItem(k), STORE);
  const items = (page: Page) => page.locator("main ol ul li");

  test("first visit: the recent window, explained, nothing marked by itself", async ({ page }, info) => {
    await page.goto(`${base}/changes/`);
    await expect(page.getByRole("heading", { level: 1, name: "What is new since my last visit" })).toBeVisible();
    await expect(page.getByText("First visit here")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "5 pages created or modified" })).toBeVisible();
    // newest first, deduplicated (alpha is cited by two log entries and has a date: one line), kind of change in text
    expect(await items(page).count()).toBe(5);
    await expect(items(page).first()).toContainText("Created");
    await expect(items(page).first()).toContainText("Gamma entity");
    await expect(items(page).first()).toContainText("Entity");
    await expect(page.getByRole("heading", { level: 2, name: /November 12, 2026/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Alpha concept" })).toHaveCount(1);
    await shot(page, info, "changes-first");
    // visiting again, or reloading, marks nothing
    await page.reload();
    await expect(page.getByText("First visit here")).toBeVisible();
    expect(await seen(page)).toBeNull();
  });

  test("badges, buttons and links keep 4.5:1 in the dark and light schemes (a capture taken during the colour transition looks washed out; the page is not)", async ({ page }) => {
    for (const colorScheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(`${base}/changes/`);
      await page.waitForTimeout(400);
      const ratios = await page.evaluate(() => {
        const cx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
        const rgb = (c: string) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0]!, d[1]!, d[2]!, d[3]! / 255]; };
        const lum = (c: number[]) => [0.2126, 0.7152, 0.0722].reduce((a, k, i) => { const v = c[i]! / 255; return a + k * (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); }, 0);
        const backdrop = (el: Element) => { let base = [0, 0, 0]; for (const e of [...(function* () { for (let n: Element | null = el; n; n = n.parentElement) yield n; })()].reverse()) { const c = rgb(getComputedStyle(e).backgroundColor); base = base.map((b, i) => Math.round(c[i]! * c[3]! + b * (1 - c[3]!))); } return base; };
        const ratio = (el: Element) => { const bg = backdrop(el), f = rgb(getComputedStyle(el).color), fg = [0, 1, 2].map((i) => Math.round(f[i]! * f[3]! + bg[i]! * (1 - f[3]!))); const a = lum(fg) + 0.05, b = lum(bg) + 0.05; return Math.max(a, b) / Math.min(a, b); };
        const pick = (sel: string) => ratio(document.querySelector(sel)!);
        return { badge: pick("main [data-slot=badge]"), button: pick("main button"), menu: pick("header .site-nav-toggle"), link: pick("main ol ul li a") };
      });
      for (const [what, r] of Object.entries(ratios)) expect(r, `${what} (${colorScheme})`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("« Mark as seen » is explicit, remembered in this browser, and only newer changes come back", async ({ page }, info) => {
    await page.goto(`${base}/changes/`);
    await page.getByRole("button", { name: "Mark as seen" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Changes marked as seen." })).toBeFocused();
    await expect(page.getByRole("button", { name: "Mark as seen" })).toHaveCount(0);
    expect(await seen(page)).toBe(String(Date.parse("2026-11-12T10:00:00+01:00")));
    await shot(page, info, "changes-seen");
    await page.reload();
    await expect(page.getByRole("heading", { level: 2, name: "Nothing new since November 12, 2026." })).toBeVisible();
    await expect(items(page)).toHaveCount(0);
    // the recent window can be looked at again without moving the reference point
    await page.getByRole("button", { name: "Show recent changes again" }).click();
    expect(await items(page).count()).toBe(5);
    await page.getByRole("button", { name: "Back to what is new" }).click();
    await expect(items(page)).toHaveCount(0);
    expect(await seen(page)).toBe(String(Date.parse("2026-11-12T10:00:00+01:00")));
  });

  test("with an older reference point: the pages created or modified after it, a created page stays created", async ({ page }) => {
    await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [STORE, String(Date.parse("2026-11-05T00:00:00Z"))]);
    await page.goto(`${base}/changes/`);
    await expect(page.getByText("since November 5, 2026")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "2 pages created or modified" })).toBeVisible();
    await expect(items(page).nth(0)).toContainText("Gamma entity");
    await expect(items(page).nth(0)).toContainText("Created");
    await expect(items(page).nth(1)).toContainText("Overview synthesis");
    await expect(items(page).nth(1)).toContainText("Modified");
  });

  test("storage that refuses writes or reads: the page still works and says so", async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => { throw new Error("denied"); };
      Storage.prototype.getItem = () => { throw new Error("denied"); };
    });
    await page.goto(`${base}/changes/`);
    await expect(page.getByText("First visit here")).toBeVisible();
    await expect(page.getByText("cannot remember the reference point")).toBeVisible();
    await page.getByRole("button", { name: "Mark as seen" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Changes marked as seen." })).toBeVisible();
  });

  test("linked from the home page and from the log, in both languages' wording of the link", async ({ page }) => {
    await page.goto(`${base}/`);
    await page.getByRole("link", { name: "What is new since my last visit" }).click();
    await expect(page).toHaveURL(/\/changes\/$/);
    await page.goto(`${base}/log/`);
    await expect(page.getByRole("link", { name: "What is new since my last visit" })).toHaveAttribute("href", /\/changes\/$/);
  });
});

// The base fixture has review off: the queue is not offered anywhere and the route carries nothing.
test.describe("review off", () => {
  test("/review/ says it is off and lists nothing; no facet link; no queue bar on an article", async ({ page }) => {
    const off = process.env.CORTEX_UI_BASE!;
    await page.goto(`${off}/review/`);
    await expect(page.getByText("Review is not turned on for this wiki.")).toBeVisible();
    await expect(page.locator("main ol")).toHaveCount(0);
    await page.goto(`${off}/search/?q=`);
    await expect(page.getByRole("link", { name: "Open the review queue" })).toHaveCount(0);
    await page.goto(`${off}/wiki/entities/gamma/?queue=review`);
    await expect(page.getByRole("heading", { level: 1, name: "Gamma entity" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Review queue" })).toHaveCount(0);
  });
});
