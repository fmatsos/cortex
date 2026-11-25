import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./helpers";
import { mockIndex } from "./search-fixtures";

// The site's search with `cortex serve` behind it: the hybrid results (by meaning) in the palette, and on a validated search the hybrid
// results then the judge's ranking, grouped. Every `/api/search` answer is a mock (`page.route`): there is no server here. Service
// workers are blocked so that a reload never lets one answer in place of the mock.
test.use({ serviceWorkers: "block" });

type Reply = { status?: number; body?: unknown };
type Hit = { id: string; path: string; title: string; type: string; extract: string; match: "lexical" | "semantic" | "both" | "filter"; score: number; relevance?: number; group?: string };
const h = (id: string, title: string, match: Hit["match"], extra: Partial<Hit> = {}): Hit => ({ id, path: `wiki/${id}.md`, title, type: id.split("/")[0] === "entities" ? "Entity" : id.startsWith("syntheses") ? "Synthesis" : "Concept", extract: "", match, score: 0.5, ...extra });
const BETA = h("concepts/beta", "Beta concept", "lexical", { extract: "Searchable keyword: zebracorn." });
const GAMMA = h("entities/gamma", "Gamma entity", "semantic", { extract: "An isolated animal-like entity of the wiki." });
const OVERVIEW = h("syntheses/overview", "Overview synthesis", "semantic", { extract: "A synthesis across the concepts." });

type Gate = { wait: Promise<void>; open: () => void };
const gate = (): Gate => { let open!: () => void; const wait = new Promise<void>((ok) => (open = ok)); return { wait, open }; };

type Mock = { head?: number; get: (u: URL, n: number) => Reply | Promise<Reply>; calls: string[]; gets: URL[] };
async function mockSearch(page: Page, get: Mock["get"], head = 204): Promise<Mock> {
  const m: Mock = { head, get, calls: [], gets: [] };
  await page.route(/\/api\/search(\?|$)/, async (route) => {
    const req = route.request(), u = new URL(req.url());
    m.calls.push(`${req.method()}${u.search}`);
    if (req.method() === "HEAD") return route.fulfill({ status: m.head });
    m.gets.push(u);
    const r = await m.get(u, m.gets.filter((x) => x.searchParams.get("q") === u.searchParams.get("q") && x.searchParams.has("judge") === u.searchParams.has("judge")).length);
    try { await route.fulfill({ status: r.status ?? 200, contentType: "application/json", body: JSON.stringify(r.body ?? {}) }); } catch { /* the page cancelled the request */ }
  });
  return m;
}
const isJudge = (u: URL) => u.searchParams.get("judge") === "1";
const plain = (hits: Hit[], extra: Record<string, unknown> = {}) => ({ hits, judged: false, ...extra });
const links = (page: Page) => page.locator("main li a.link-content");
/** The polite region of the ranking: its text and `data-ranking` say where it stands (busy, done, or nothing). */
const rank = (page: Page) => page.locator("p[aria-live=polite]");
const field = (page: Page) => page.getByRole("main").getByRole("combobox");
/** Validates a search from the field of /search/: Enter. */
const validate = async (page: Page, q: string) => { await field(page).fill(q); await field(page).press("Enter"); };

test("a static site (no /api/search): the local results, nothing else, no request beyond the probe", async ({ page }) => {
  const m = await mockSearch(page, () => ({ status: 404 }), 404);
  await page.goto("/search/?q=zebracorn");
  await expect(links(page)).toHaveText(["Beta concept"]);
  await expect(page.locator("[data-match]")).toHaveCount(0);
  await expect(rank(page)).toHaveText("");
  await expect.poll(() => m.calls.length).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  expect(m.calls, "only the HEAD probe").toEqual(["HEAD"]);

  // the palette, too
  await page.goto("/");
  await field(page).fill("zebracorn");
  await expect(page.getByRole("option", { name: /Beta concept/ })).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.getByRole("option", { name: /by meaning/ })).toHaveCount(0);
  expect(m.gets).toHaveLength(0);
});

test("palette: the pages found by meaning are added at the end of the pages, the active option stays where it is, no judge", async ({ page }) => {
  const g = gate();
  const m = await mockSearch(page, async () => { await g.wait; return { body: plain([BETA, { ...GAMMA }, OVERVIEW]) }; });
  await page.goto("/");
  await field(page).fill("zebracorn");
  const beta = page.getByRole("option", { name: /Beta concept/ });
  await expect(beta).toBeVisible();
  const active = () => page.evaluate(() => { const i = document.querySelector("main input[role=combobox]")!; const id = i.getAttribute("aria-activedescendant"); return id ? document.getElementById(id)?.textContent ?? "" : ""; });
  for (let i = 0; i < 12 && !(await active()).includes("Beta concept"); i++) await field(page).press("ArrowDown");
  expect(await active()).toContain("Beta concept");
  await expect.poll(() => m.calls.some((c) => c.startsWith("GET")) || m.gets.length).toBeTruthy(); // the debounced request is out
  g.open();

  const gamma = page.getByRole("option", { name: /Gamma entity/ });
  await expect(gamma).toBeVisible();
  await expect(gamma).toContainText("by meaning");
  await expect(page.getByRole("option", { name: /Overview synthesis/ })).toContainText("by meaning");
  await expect(beta).not.toContainText("by meaning"); // found by words too
  const names = await page.getByRole("option").allInnerTexts();
  const at = (s: string) => names.findIndex((x) => x.includes(s));
  expect(at("Beta concept")).toBeLessThan(at("Gamma entity"));
  expect(at("Gamma entity")).toBeLessThan(at("Overview synthesis"));
  expect(await active(), "the active option did not move").toContain("Beta concept");
  expect(m.gets.every((u) => !u.searchParams.has("judge"))).toBe(true);

  // Enter on the semantic option opens it
  await gamma.click();
  await expect(page).toHaveURL(/\/wiki\/entities\/gamma\//);
});

test("palette: an error or an unreachable API is silent", async ({ page }) => {
  await mockSearch(page, () => ({ status: 500, body: { error: "boom" } }));
  await page.goto("/");
  await field(page).fill("zebracorn");
  await expect(page.getByRole("option", { name: /Beta concept/ })).toBeVisible();
  await page.waitForTimeout(700);
  await expect(page.getByRole("option", { name: /by meaning/ })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: /error|unavailable/i })).toHaveCount(0);
});

test("/search/: local results at once, then the hybrid ones, then the judge's groups with the rest folded", async ({ page }) => {
  const gh = gate(), gj = gate();
  const m = await mockSearch(page, async (u) => {
    if (isJudge(u)) {
      await gj.wait;
      return { body: { hits: [{ ...GAMMA, group: "retained", relevance: 0.9 }, { ...OVERVIEW, group: "related", relevance: 0.4 }, { ...BETA, group: "other", relevance: 0.1 }], judged: true, model: "jev-test", unjudged: 0 } };
    }
    await gh.wait;
    return { body: plain([OVERVIEW, GAMMA, BETA]) };
  });
  await page.goto("/search/?q=zebracorn");
  await expect(links(page)).toHaveText(["Beta concept"]); // local, before any answer
  const filters = page.locator("aside details"); // folded on a phone
  if (!(await filters.evaluate((d: HTMLDetailsElement) => d.open))) await filters.locator("summary").click();
  await expect(page.getByRole("button", { name: /Entities/ })).toBeDisabled();
  await expect.poll(() => m.gets.length).toBe(2); // hybrid and judge asked together

  gh.open();
  await expect(links(page)).toHaveText(["Overview synthesis", "Gamma entity", "Beta concept"]); // the server's order replaces the local one
  await expect(page.locator("[data-match]")).toHaveText(["by meaning", "by meaning"]);
  await expect(page.getByText("zebracorn", { exact: true }).first()).toBeVisible(); // the highlighted word of Beta's excerpt
  await expect(page.getByRole("button", { name: /Entities/ })).toBeEnabled(); // the counters follow what is displayed
  const ranking = rank(page);
  await expect(ranking).toHaveAttribute("data-ranking", "busy");
  await expect(ranking).toContainText("Ranking in progress");
  await expect(ranking).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("main [aria-busy=true]")).toHaveCount(1);
  expect(m.gets.map((u) => u.searchParams.get("limit"))).toEqual(["50", "50"]);

  gj.open();
  await expect(page.getByRole("heading", { name: /^Relevant/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Related/ })).toBeVisible();
  await expect(ranking).toHaveAttribute("data-ranking", "done");
  await expect(ranking).toContainText("Ranked by jev-test");
  await expect(page.locator("main [aria-busy=true]")).toHaveCount(0);
  const rel = page.getByRole("region", { name: /^Relevant/ }), other = page.locator("details[data-group=other]");
  await expect(rel.locator("a.link-content")).toHaveText(["Gamma entity"]);
  await expect(page.getByRole("region", { name: /^Related/ }).locator("a.link-content")).toHaveText(["Overview synthesis"]);
  await expect(other.locator("summary")).toHaveText("Other results (1)");
  await expect(other).toHaveJSProperty("open", false);
  await expect(page.getByRole("link", { name: "Beta concept" })).toBeHidden(); // folded, not removed
  await other.locator("summary").click();
  await expect(page.getByRole("link", { name: "Beta concept" })).toBeVisible();
  await expect(page.getByText(/relevance|0\.9/i)).toHaveCount(0); // no raw score
});

test("/search/: nothing relevant, the rest opens by itself; a judge that did not judge shows the plain hybrid list", async ({ page }) => {
  await mockSearch(page, (u) => (isJudge(u)
    ? { body: { hits: [{ ...GAMMA, group: "other", relevance: 0.1 }, { ...BETA, group: "unjudged" }], judged: true, model: "jev-test", unjudged: 1 } }
    : { body: plain([GAMMA, BETA]) }));
  await page.goto("/search/?q=zebracorn");
  const other = page.locator("details[data-group=other]");
  await expect(other.locator("summary")).toHaveText("Other results (2)");
  await expect(other).toHaveJSProperty("open", true);
  await expect(page.getByText("No page was judged relevant or related")).toBeVisible();
  await expect(other.locator("a.link-content")).toHaveText(["Gamma entity", "Beta concept"]);
});

for (const [reason, message] of [["no-text", false], ["not-configured", false], ["no-hits", false], ["unavailable", true]] as const) {
  test(`/search/: judged: false (${reason}) keeps the hybrid list${message ? " and says so once, discreetly" : " without any message"}`, async ({ page }) => {
    await mockSearch(page, (u) => ({ body: isJudge(u) ? { hits: [GAMMA, BETA], judged: false, reason } : plain([GAMMA, BETA]) }));
    await page.goto("/search/?q=zebracorn");
    await expect(links(page)).toHaveText(["Gamma entity", "Beta concept"]);
    await expect(rank(page)).not.toHaveAttribute("data-ranking", "busy");
    await expect(page.locator("details[data-group=other]")).toHaveCount(0);
    const note = page.getByText("Ranking is not available right now.");
    if (message) await expect(note).toBeVisible(); else { await page.waitForTimeout(300); await expect(note).toHaveCount(0); }
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

test("/search/: a filter-only query never reaches the server", async ({ page }) => {
  const m = await mockSearch(page, () => ({ body: plain([GAMMA]) }));
  await page.goto("/search/?q=%23alpha");
  await expect(links(page).first()).toBeVisible();
  await page.waitForTimeout(500);
  expect(m.gets).toHaveLength(0);
});

test("/search/: a busy judge (429) gets one new attempt after a moment", async ({ page }) => {
  const m = await mockSearch(page, (u, n) => (isJudge(u)
    ? (n === 1 ? { status: 429, body: { error: "busy" } } : { body: { hits: [{ ...GAMMA, group: "retained", relevance: 0.8 }], judged: true, model: "jev-test", unjudged: 0 } })
    : { body: plain([GAMMA, BETA]) }));
  await page.goto("/search/?q=zebracorn");
  await expect(links(page)).toHaveText(["Gamma entity", "Beta concept"]);
  await expect(rank(page)).toHaveAttribute("data-ranking", "busy");
  await expect(page.getByRole("heading", { name: /^Relevant/ })).toBeVisible({ timeout: 8000 });
  expect(m.gets.filter(isJudge)).toHaveLength(2);
});

test("/search/: a judge busy twice gives up: the plain hybrid list, no message", async ({ page }) => {
  const m = await mockSearch(page, (u) => (isJudge(u) ? { status: 429, body: { error: "busy" } } : { body: plain([GAMMA, BETA]) }));
  await page.goto("/search/?q=zebracorn");
  await expect(rank(page)).toHaveAttribute("data-ranking", "busy");
  await expect(rank(page)).not.toHaveAttribute("data-ranking", "busy", { timeout: 8000 });
  expect(m.gets.filter(isJudge)).toHaveLength(2);
  await expect(links(page)).toHaveText(["Gamma entity", "Beta concept"]);
  await expect(rank(page)).toHaveText("");
});

test("/search/: a new query cancels the judging one (its answer is never shown), and a query seen again is not asked twice", async ({ page }) => {
  const stale = gate();
  const judged = (id: Hit, group: string) => ({ hits: [{ ...id, group, relevance: 0.9 }], judged: true, model: "jev-test", unjudged: 0 });
  const m = await mockSearch(page, async (u, n) => {
    const q = u.searchParams.get("q");
    if (!isJudge(u)) return { body: plain(q === "zebracorn" ? [BETA] : [h("concepts/alpha", "Alpha concept", "lexical")]) };
    if (q === "zebracorn" && n === 1) { await stale.wait; return { body: judged(GAMMA, "retained") }; }
    return { body: q === "zebracorn" ? judged(BETA, "retained") : judged(h("concepts/alpha", "Alpha concept", "both"), "retained") };
  });
  const aborted: string[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes("judge=1")) aborted.push(decodeURIComponent(r.url())); });

  await page.goto("/search/?q=zebracorn");
  await expect(rank(page)).toHaveAttribute("data-ranking", "busy");
  await validate(page, "alpha");
  await expect(page.getByRole("region", { name: /^Relevant/ }).locator("a.link-content")).toHaveText(["Alpha concept"]);
  stale.open(); // the answer of the first query comes, too late
  await page.waitForTimeout(400);
  await expect(page.getByRole("link", { name: "Gamma entity" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: /^Relevant/ }).locator("a.link-content")).toHaveText(["Alpha concept"]);
  expect(aborted.some((u) => u.includes("q=zebracorn"))).toBe(true);

  // back to the first query, which was never judged: asked again; then to the second, which was: not asked again
  await validate(page, "zebracorn");
  await expect(page.getByRole("region", { name: /^Relevant/ }).locator("a.link-content")).toHaveText(["Beta concept"]);
  const asked = () => m.gets.filter((u) => u.searchParams.get("q") === "alpha" && isJudge(u)).length;
  expect(asked()).toBe(1);
  await validate(page, "alpha");
  await expect(page.getByRole("region", { name: /^Relevant/ }).locator("a.link-content")).toHaveText(["Alpha concept"]);
  expect(asked(), "the second query came from the session cache").toBe(1);
  expect(m.gets.filter((u) => u.searchParams.get("q") === "alpha")).toHaveLength(2); // one hybrid, one judged
});

test("/search/: a facet counts what clicking it shows (a page found by meaning only included), and asks the server with the operator", async ({ page }) => {
  const m = await mockSearch(page, (u) => {
    const q = u.searchParams.get("q");
    const hits = q === "zebracorn" ? [BETA, GAMMA, OVERVIEW] : [GAMMA];
    return { body: isJudge(u) ? { hits, judged: false, reason: "not-configured" } : plain(hits) };
  });
  await page.goto("/search/?q=zebracorn");
  await expect(links(page)).toHaveText(["Beta concept", "Gamma entity", "Overview synthesis"]);
  const filters = page.locator("aside details");
  if (!(await filters.evaluate((d: HTMLDetailsElement) => d.open))) await filters.locator("summary").click();
  const entities = page.getByRole("button", { name: /Entities/ });
  await expect(entities).toBeEnabled();
  await entities.click();
  await expect(field(page)).toHaveValue("zebracorn type:entity");
  await expect(links(page)).toHaveText(["Gamma entity"]); // not "no page matches": the server answered the new query
  await expect(page.locator("[data-match]")).toHaveText(["by meaning"]);
  expect(m.gets.some((u) => u.searchParams.get("q") === "zebracorn type:entity" && isJudge(u))).toBe(true);
  // a chip removes its operator the same way
  await page.getByRole("button", { name: /Remove/ }).click();
  await expect(links(page)).toHaveText(["Beta concept", "Gamma entity", "Overview synthesis"]);
});

test("/search/: back from a result shows the groups again without asking the server again", async ({ page }) => {
  const m = await mockSearch(page, (u) => (isJudge(u)
    ? { body: { hits: [{ ...GAMMA, group: "retained", relevance: 0.9 }, { ...BETA, group: "other", relevance: 0.1 }], judged: true, model: "jev-test", unjudged: 0 } }
    : { body: plain([GAMMA, BETA]) }));
  await page.goto("/search/?q=zebracorn");
  await expect(page.getByRole("heading", { name: /^Relevant/ })).toBeVisible();
  const asked = m.gets.length;
  expect(asked).toBe(2);
  await page.getByRole("link", { name: "Gamma entity" }).click();
  await expect(page).toHaveURL(/\/wiki\/entities\/gamma\//);
  await page.goBack();
  await expect(page.getByRole("heading", { name: /^Relevant/ })).toBeVisible();
  await expect(page.getByRole("region", { name: /^Relevant/ }).locator("a.link-content")).toHaveText(["Gamma entity"]);
  await expect(rank(page)).toContainText("Ranked by jev-test");
  expect(m.gets, "nothing asked again").toHaveLength(asked);
});

test("/search/: typing without Enter never judges, and the local results follow the keystrokes", async ({ page }) => {
  const m = await mockSearch(page, () => ({ body: plain([GAMMA]) }));
  await page.goto("/search/?q=zebracorn");
  await expect.poll(() => m.gets.length).toBe(2);
  await field(page).fill("alpha");
  await expect(links(page).first()).toBeVisible();
  await page.waitForTimeout(500);
  expect(m.gets, "no new request until Enter").toHaveLength(2);
  await expect(page.locator("[data-match]")).toHaveCount(0);
});

test("/search/: is:fav is applied in the browser (the server ignores it)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cortex:favs", JSON.stringify(["entities/gamma"])));
  await mockSearch(page, (u) => ({ body: isJudge(u) ? { hits: [BETA, GAMMA, OVERVIEW], judged: false, reason: "not-configured", ignored: ["is:fav"] } : plain([BETA, GAMMA, OVERVIEW], { ignored: ["is:fav"] }) }));
  await page.goto("/search/?q=zebracorn%20is%3Afav");
  await expect(links(page)).toHaveText(["Gamma entity"]);
  await expect(page.getByText("1 result", { exact: true })).toBeVisible();
});

// The server ranks at most 50 pages and gives no total: the local matches beyond them stay reachable, counted, and the page says what
// the ranking covers. 120 pages match "gizmo" in a mock index; the server ranks 50 of them.
const MANY = Array.from({ length: 120 }, (_, i) => ({ id: `concepts/p${String(i).padStart(3, "0")}`, title: `Page ${String(i).padStart(3, "0")}`, text: "gizmo" }));
const manyHit = (i: number, extra: Partial<Hit> = {}) => h(MANY[i].id, MANY[i].title, "lexical", extra);
const RANKED = Array.from({ length: 50 }, (_, i) => manyHit(110 - i)); // pages 110 down to 061, the server's order

test("/search/: more than 50 matches, the server's 50 come first and every other local match stays reachable", async ({ page }, info) => {
  const shot = async (name: string) => { const d = process.env.CORTEX_UI_SHOTS; if (d) { mkdirSync(d, { recursive: true }); await page.screenshot({ path: `${d}/many-${info.project.name}-${name}.png` }); } };
  await mockIndex(page, MANY);
  const gh = gate(), gj = gate();
  await mockSearch(page, async (u) => {
    if (isJudge(u)) { await gj.wait; return { body: { hits: RANKED.map((x, i) => ({ ...x, group: i === 0 ? "retained" : "other", relevance: 0.5 })), judged: true, model: "jev-test", unjudged: 0 } }; }
    await gh.wait;
    return { body: plain(RANKED) };
  });
  await page.goto("/search/?q=gizmo");
  await expect(page.getByText("50 of 120 results", { exact: true })).toBeVisible(); // local, before any answer
  await expect(page.locator("[data-rank-scope]")).toHaveCount(0);

  gh.open();
  await expect(page.getByText("120 results", { exact: true })).toBeVisible(); // the total includes what the server did not rank
  await expect(page.locator("[data-rank-scope]")).toHaveText(/ranking covers the 50 best results.*other matches follow/i);
  await shot("hybrid");
  const more = page.locator("details[data-group=more]");
  await expect(more.locator("summary")).toHaveText("Other matches (70)");
  await expect(more).toHaveJSProperty("open", true); // a plain hybrid list: the rest continues it
  const ranked = page.locator("main > div, main").locator("ul:not(details ul) > li a.link-content");
  await expect(ranked.first()).toHaveText("Page 110");
  await expect(ranked).toHaveCount(50);
  await expect(more.locator("li a.link-content")).toHaveCount(50); // one slice
  await expect(more.locator("li a.link-content").first()).toHaveText("Page 000"); // the site's own order, minus what the server already shows
  const shown = (await page.locator("main li a.link-content").allInnerTexts());
  expect(new Set(shown).size, "no page twice").toBe(shown.length);
  await more.getByRole("button", { name: /Show more \(50 of 70\)/ }).click();
  await expect(more.locator("li a.link-content")).toHaveCount(70);
  await expect(page.locator("main li a.link-content")).toHaveCount(120);
  await expect(more.getByRole("button", { name: /Show more/ })).toHaveCount(0);
  // the counters follow the whole list
  const filters = page.locator("aside details");
  if (!(await filters.evaluate((d: HTMLDetailsElement) => d.open))) await filters.locator("summary").click();
  await expect(page.getByRole("button", { name: /Concepts/ })).toContainText("120");

  gj.open();
  await expect(page.getByRole("heading", { name: /^Relevant/ })).toBeVisible();
  await expect(page.locator("details[data-group=other] summary")).toHaveText("Other results (49)");
  await expect(more.locator("summary")).toHaveText("Other matches (70)");
  await expect(more).toHaveJSProperty("open", false); // ranked: the rest is folded, like the other results
  await shot("ranked");
  await expect(page.locator("[data-rank-scope]")).toBeVisible();
  await expect(page.getByText("120 results", { exact: true })).toBeVisible();
});

test("/search/: once ranked, the rest is a folded group with its count, and opens like any group", async ({ page }) => {
  await mockIndex(page, MANY);
  await mockSearch(page, (u) => ({ body: isJudge(u)
    ? { hits: RANKED.map((x, i) => ({ ...x, group: i < 3 ? "retained" : "other", relevance: 0.5 })), judged: true, model: "jev-test", unjudged: 0 }
    : plain(RANKED) }));
  await page.goto("/search/?q=gizmo");
  await expect(page.getByRole("heading", { name: /^Relevant/ })).toBeVisible();
  const more = page.locator("details[data-group=more]");
  await expect(more.locator("summary")).toHaveText("Other matches (70)");
  await expect(more).toHaveJSProperty("open", false);
  await more.locator("summary").click();
  await expect(more.locator("li a.link-content")).toHaveCount(50);
  await expect(page.getByText("120 results", { exact: true })).toBeVisible();
});

test("/search/: fewer than 50 server hits and nothing local beyond them: no empty group, no scope sentence", async ({ page }) => {
  await mockSearch(page, (u) => ({ body: isJudge(u) ? { hits: [GAMMA, BETA], judged: false, reason: "not-configured" } : plain([GAMMA, BETA]) }));
  await page.goto("/search/?q=zebracorn");
  await expect(links(page)).toHaveText(["Gamma entity", "Beta concept"]);
  await expect(page.locator("details[data-group=more]")).toHaveCount(0);
  await expect(page.locator("[data-rank-scope]")).toHaveCount(0);
});

// Focus follows the page and the action when the ranking replaces the list.
const focused = (page: Page) => page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return { page: a?.closest("li")?.dataset.page ?? null, action: a?.closest<HTMLElement>("[data-row-action]")?.dataset.rowAction ?? null }; });

for (const action of ["open", "fav"] as const) {
  test(`/search/: focus on a result's ${action === "open" ? "link" : "star"} stays on it when the hybrid list, then the groups, replace the list`, async ({ page }) => {
    const gh = gate(), gj = gate();
    await mockSearch(page, async (u) => {
      if (isJudge(u)) { await gj.wait; return { body: { hits: [{ ...GAMMA, group: "retained", relevance: 0.9 }, { ...OVERVIEW, group: "related", relevance: 0.4 }, { ...BETA, group: "other", relevance: 0.1 }], judged: true, model: "jev-test", unjudged: 0 } }; }
      await gh.wait;
      return { body: plain([OVERVIEW, GAMMA, BETA]) };
    });
    await page.goto("/search/?q=zebracorn");
    const row = page.locator("main li[data-page='concepts/beta']");
    const target = row.locator(`[data-row-action=${action}]`);
    await expect(target).toBeVisible();
    await target.focus();
    expect(await focused(page)).toEqual({ page: "concepts/beta", action });

    gh.open(); // the server's order replaces the local list: the focused element is destroyed
    await expect(links(page)).toHaveText(["Overview synthesis", "Gamma entity", "Beta concept"]);
    await expect.poll(() => focused(page)).toEqual({ page: "concepts/beta", action });

    gj.open(); // Beta is now in the folded "Other results"
    await expect(page.getByRole("heading", { name: /^Relevant/ })).toBeVisible();
    await expect.poll(() => focused(page)).toEqual({ page: "concepts/beta", action });
    await expect(page.locator("details[data-group=other]")).toHaveJSProperty("open", true); // opened for the focus, not left hidden
    await expect(target).toBeFocused();
  });
}

test("/search/: focus that is elsewhere (the field) is not taken by the ranking", async ({ page }) => {
  const gh = gate();
  await mockSearch(page, async (u) => { await gh.wait; return { body: isJudge(u) ? { hits: [GAMMA, BETA], judged: false, reason: "not-configured" } : plain([GAMMA, BETA]) }; });
  await page.goto("/search/?q=zebracorn");
  await expect(links(page)).toHaveText(["Beta concept"]);
  await field(page).focus();
  gh.open();
  await expect(links(page)).toHaveText(["Gamma entity", "Beta concept"]);
  await expect(field(page)).toBeFocused();
});

test("/search/: a page the visitor tabbed out of is not pulled back into focus", async ({ page }) => {
  const gh = gate();
  await mockSearch(page, async (u) => { await gh.wait; return { body: isJudge(u) ? { hits: [GAMMA, BETA], judged: false, reason: "not-configured" } : plain([GAMMA, BETA]) }; });
  await page.goto("/search/?q=zebracorn");
  await links(page).first().focus();
  await field(page).focus(); // focus left the results
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  gh.open();
  await expect(links(page)).toHaveText(["Gamma entity", "Beta concept"]);
  expect((await focused(page)).page).toBeNull();
});

// Screens for the review of the design: CORTEX_UI_SHOTS=<folder> bun run test:ui tests/ui/search-server.spec.ts
test("screens of /search/ while ranking and after", async ({ page }, info) => {
  const dir = process.env.CORTEX_UI_SHOTS;
  test.skip(!dir, "only with CORTEX_UI_SHOTS");
  mkdirSync(dir!, { recursive: true });
  let gj = gate();
  await mockSearch(page, async (u) => {
    if (isJudge(u)) { await gj.wait; return { body: { hits: [{ ...GAMMA, group: "retained", relevance: 0.9 }, { ...OVERVIEW, group: "related", relevance: 0.4 }, { ...BETA, group: "other", relevance: 0.1 }], judged: true, model: "jev-test", unjudged: 0 } }; }
    return { body: plain([OVERVIEW, GAMMA, BETA]) };
  });
  for (const scheme of ["light", "dark"] as const) {
    gj = gate();
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/search/?q=zebracorn");
    await expect(rank(page)).toHaveAttribute("data-ranking", "busy");
    await expect(page.locator("[data-match]").first()).toBeVisible();
    await page.screenshot({ path: `${dir}/search-${info.project.name}-${scheme}-ranking.png`, fullPage: true });
    gj.open();
    await expect(page.getByRole("heading", { name: /^Relevant/ })).toBeVisible();
    await page.screenshot({ path: `${dir}/search-${info.project.name}-${scheme}-ranked.png`, fullPage: true });
    await page.locator("details[data-group=other] summary").click();
    await page.screenshot({ path: `${dir}/search-${info.project.name}-${scheme}-ranked-open.png`, fullPage: true });
  }
});
