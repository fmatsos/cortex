import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./helpers";

// Save and export of the graph journeys: the buttons of the journey panel, the state beside them, the dialogs, the link to the
// saved copy (`journey=<id>` in the address), and the account page's Open and Export. There is no `cortex serve` here: `/api/*`
// is a mock that keeps its own state. Both projects run it (the panel sits beside the map on desktop, under it on mobile).
// Service workers are blocked so that a reload never lets one answer in place of the mock.
test.use({ serviceWorkers: "block", launchOptions: { args: ["--enable-unsafe-swiftshader"] } });

type Journey = { id: string; title: string; route: string[]; created_at: string; updated_at: string };
type Mock = {
  providers: { id: string; label: string }[] | null;
  me: { id: string; name: string; email: string; provider: string } | null;
  journeys: Journey[];
  posts: Record<string, unknown>[];
  puts: { id: string; body: Record<string, unknown> }[];
  gets: string[];
  failSave: boolean;
};

const ADA = { id: "u1", name: "Ada Lovelace", email: "ada@example.org", provider: "oidc" };
const PROVIDERS = [{ id: "oidc", label: "Authelia" }];
const ALPHA = "concepts/alpha", BETA = "concepts/beta", OVERVIEW = "syntheses/overview", GAMMA = "entities/gamma";
const journey = (id: string, title: string, route: string[]): Journey => ({ id, title, route, created_at: "2026-11-01T10:00:00.000Z", updated_at: "2026-11-02T10:00:00.000Z" });
const newMock = (over: Partial<Mock> = {}): Mock => ({ providers: PROVIDERS, me: ADA, journeys: [], posts: [], puts: [], gets: [], failSave: false, ...over });

async function mockApi(page: Page, m: Mock) {
  await page.route("**/api/**", async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const body = () => (req.postData() ? JSON.parse(req.postData()!) : {});
    if (path === "/api/auth/methods") return m.providers ? json({ providers: m.providers }) : route.fulfill({ status: 404 });
    if (path.startsWith("/api/auth/login/")) return route.fulfill({ status: 200, contentType: "text/html", body: "<title>provider</title>login" });
    if (path === "/api/me") return m.me ? json(m.me) : json({ error: "not signed in" }, 401);
    if (!m.me) return json({ error: "not signed in" }, 401);
    if (path === "/api/me/state") return json({});
    if (path === "/api/journeys") {
      if (method === "POST") {
        if (m.failSave) return json({ error: "boom" }, 500);
        const b = body();
        m.posts.push(b);
        const j = journey(`n${m.journeys.length + 1}`, b.title ?? "untitled", b.route);
        m.journeys.push(j);
        return json(j, 201);
      }
      return json({ journeys: m.journeys });
    }
    const j = path.match(/^\/api\/journeys\/(.+)$/);
    if (j) {
      const found = m.journeys.find((x) => x.id === j[1]);
      if (!found) return json({ error: "no such journey" }, 404);
      if (method === "PUT") {
        if (m.failSave) return json({ error: "boom" }, 500);
        m.puts.push({ id: found.id, body: body() });
        found.route = body().route ?? found.route;
        return json(found);
      }
      m.gets.push(found.id);
      return json(found);
    }
    return route.fulfill({ status: 404 });
  });
}

const panel = (page: Page) => page.getByRole("complementary", { name: /^(Journey|Voyage)$/ });
const SAVE = "Save the journey", SIGN_IN_TO_SAVE = "Sign in to save the journey", EXPORT = "Export the journey as Markdown";
const button = (page: Page, name: string) => panel(page).getByRole("button", { name, exact: true });
const state = (page: Page) => panel(page).locator("[data-journey-state]");
const message = (page: Page) => panel(page).locator("[data-journey-message]");
const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });
const read = async (download: { path: () => Promise<string> }) => readFileSync(await download.path(), "utf8");
const query = (route: string[], extra = "") => `/graph/?view=journey&route=${encodeURIComponent(route.join(","))}${extra}`;
const steps = (page: Page) => panel(page).locator("ol > li");

async function open(page: Page, m: Mock, route: string[], extra = "") {
  await mockApi(page, m);
  await page.goto(query(route, extra));
  await expect(steps(page)).toHaveCount(route.length);
}
/** Walks on to a page linked to the current one, from the panel's destinations. */
const walkTo = async (page: Page, title: string) => { await panel(page).getByRole("button", { name: new RegExp(`^${title}`) }).first().click(); };
const urlParam = (page: Page, name: string) => new URL(page.url()).searchParams.get(name);
const site = (page: Page) => new URL(page.url()).origin + "/";

test.describe("export", () => {
  test("without an account: the file has the front matter, the route, the relations and the whole content of every page", async ({ page }) => {
    await open(page, newMock({ me: null, providers: null }), [ALPHA, BETA, OVERVIEW]);
    await expect(panel(page).getByRole("button", { name: /^Save/ })).toHaveCount(0); // no account here: nothing to save to
    await expect(state(page)).toBeEmpty();
    const [dl] = await Promise.all([page.waitForEvent("download"), button(page, EXPORT).click()]);
    expect(dl.suggestedFilename()).toBe("journey-alpha-concept-overview-synthesis.md");
    const md = await read(dl), base = site(page);
    expect(md).toMatch(new RegExp(`^---\\ntitle: "Journey: Alpha concept → Overview synthesis"\\ndate: \\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z\\nsource: Cortex\\nwiki: ${base.replace(/[.]/g, "\\.")}\\nkind: journey\\nsteps: 3\\nroute: \\[concepts/alpha, concepts/beta, syntheses/overview\\]\\n---\\n\\n# Journey: Alpha concept → Overview synthesis\\n\\nReading route through the Cortex wiki, in the order walked\\. Each step is linked to the previous one by a wiki link\\.\\n\\n## Route\\n\\n`));
    expect(md).toContain(`1. [Alpha concept](${base}wiki/concepts/alpha/) (Concept)\n2. [Beta concept](${base}wiki/concepts/beta/) (Concept): cites and is cited by step 1\n3. [Overview synthesis](${base}wiki/syntheses/overview/) (Synthesis): cites step 2\n`);
    // step 1: the page id, the type, the address, the summary, then the whole page
    expect(md).toContain(`## Step 1: Alpha concept\n\n- Page: \`concepts/alpha\` · Concept · ${base}wiki/concepts/alpha/\n- Summary: The first concept of the fixture wiki.\n\n`);
    expect(md).toContain(`Alpha links to [Beta concept](${base}wiki/concepts/beta/)`.replace("Beta concept", "Beta"));
    expect(md).toContain("#### First part"); // ## of the page: under the step's ##
    expect(md).toContain("##### Detail"); // ### of the page
    expect(md).toContain("A nested section.");
    expect(md).toContain("[^s1-s1]: a useful precision"); // footnotes numbered per step
    expect(md).not.toContain("type: Concept"); // no front matter of the page itself
    // step 2: the whole page, a code block included
    expect(md).toContain("## Step 2: Beta concept");
    expect(md).toContain("zebracorn");
    expect(md).toContain("```sh\ncortex export --out ./site\n```");
    expect(md).toContain(`Synthesis of [Alpha](${base}wiki/concepts/alpha/) and [Beta](${base}wiki/concepts/beta/).[^s3-s1]`);
    expect(md).toContain("## Conclusion".replace("##", "####"));
    expect(md).not.toMatch(/\]\([^)]*\.md[)#]/); // every wiki link is an address of the site
    await expect(message(page)).toContainText("Journey exported.");
  });

  test("the path draft: the route as a reading path file (goal to write, one step per page), not the journey", async ({ page }) => {
    await open(page, newMock({ me: null, providers: null }), [ALPHA, BETA, ALPHA]);
    const [dl] = await Promise.all([page.waitForEvent("download"), button(page, "Export as a reading path draft").click()]);
    expect(dl.suggestedFilename()).toBe("journey-alpha-concept-alpha-concept.md");
    const md = await read(dl);
    expect(md).toMatch(/^---\ntitle: "Journey: Alpha concept → Alpha concept"\ngoal: ""\n---\n\n1\. \[Alpha concept\]\(\/wiki\/concepts\/alpha\.md\): /);
    expect(md).toContain("2. [Beta concept](/wiki/concepts/beta.md): cites and is cited by step 1");
    expect(md).not.toContain("kind: journey"); // not the journey export
    expect(md.match(/^\d+\. \[/gm)).toHaveLength(2); // a page walked twice is one step
    await expect(message(page)).toContainText("Path draft exported.");
  });

  test("the path draft button follows the language", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("cortex:lang", "fr"));
    await open(page, newMock({ me: null, providers: null }), [ALPHA, BETA]);
    const [dl] = await Promise.all([page.waitForEvent("download"), button(page, "Exporter comme brouillon de parcours").click()]);
    expect(dl.suggestedFilename()).toBe("voyage-alpha-concept-beta-concept.md");
    await expect(message(page)).toContainText("Brouillon de parcours exporté.");
  });

  test("a page walked twice is given in full once", async ({ page }) => {
    await open(page, newMock({ me: null, providers: null }), [ALPHA, BETA, ALPHA]);
    const [dl] = await Promise.all([page.waitForEvent("download"), button(page, EXPORT).click()]);
    const md = await read(dl);
    expect(md.match(/A nested section\./g)).toHaveLength(1);
    expect(md).toContain("## Step 3: Alpha concept\n\n- Page: `concepts/alpha`");
    expect(md).toContain("Page already given in full at step 1.");
    expect(md).toContain("steps: 3");
  });

  test("the labels follow the language of the interface", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("cortex:lang", "fr"));
    await open(page, newMock({ me: null, providers: null }), [ALPHA, BETA]);
    const [dl] = await Promise.all([page.waitForEvent("download"), panel(page).getByRole("button", { name: "Exporter le voyage en Markdown" }).click()]);
    expect(dl.suggestedFilename()).toBe("voyage-alpha-concept-beta-concept.md");
    const md = await read(dl);
    expect(md).toContain('title: "Voyage : Alpha concept → Beta concept"');
    expect(md).toContain("Itinéraire de lecture à travers le wiki Cortex, dans l'ordre parcouru.");
    expect(md).toContain("## Itinéraire\n");
    expect(md).toContain("(Concept) : cite et est citée par l'étape 1");
    expect(md).toContain("## Étape 2 : Beta concept");
    expect(md).toContain("- Résumé : The second concept.");
    await expect(message(page)).toContainText("Voyage exporté.");
  });

  test("the journey is exported whatever the filters on screen hide", async ({ page }) => {
    await open(page, newMock({ me: null, providers: null }), [ALPHA, BETA]);
    await page.getByRole("button", { name: /^Concepts/ }).first().click(); // hides the concepts
    const [dl] = await Promise.all([page.waitForEvent("download"), button(page, EXPORT).click()]);
    expect(await read(dl)).toContain("2. [Beta concept]");
  });
});

test.describe("save", () => {
  test("first save asks for a name (the first and last pages, selected), then each save goes straight into the same copy", async ({ page }) => {
    const m = newMock();
    await open(page, m, [ALPHA, BETA]);
    await expect(state(page)).toHaveText("Not saved");
    expect(urlParam(page, "journey")).toBeNull();
    await expect(button(page, SAVE)).toHaveText("Save");
    await button(page, SAVE).click();
    const d = dialog(page, SAVE);
    await expect(d).toBeVisible();
    const name = d.getByRole("textbox", { name: "Journey name" });
    await expect(name).toBeFocused();
    await expect(name).toHaveValue("Journey: Alpha concept → Beta concept");
    expect(await name.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, "Journey: Alpha concept → Beta concept".length]);
    await name.fill("Alpha then Beta");
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await expect(d).toBeHidden();
    expect(m.posts).toEqual([{ title: "Alpha then Beta", route: [ALPHA, BETA] }]);
    await expect(message(page)).toContainText("Journey saved.");
    await expect(state(page)).toHaveText("Saved");
    expect(urlParam(page, "journey")).toBe("n1"); // the address names the saved copy: it survives a reload
    await expect(button(page, SAVE)).toBeFocused();

    // the route grows: not saved any more, and the next save updates the same copy (its name is kept)
    await walkTo(page, "Overview synthesis");
    await expect(steps(page)).toHaveCount(3);
    await expect(state(page)).toHaveText("Not saved");
    await button(page, SAVE).click();
    await expect(message(page)).toContainText("Journey updated.");
    expect(m.puts).toEqual([{ id: "n1", body: { route: [ALPHA, BETA, OVERVIEW] } }]);
    expect(m.posts).toHaveLength(1); // no second copy
    await expect(state(page)).toHaveText("Saved");
    expect(urlParam(page, "journey")).toBe("n1");

    // going back to the saved route is 'Not saved' as well (the copy holds three steps), then the log truncates: still a change
    await steps(page).nth(0).getByRole("button").click();
    await expect(steps(page)).toHaveCount(1);
    await expect(state(page)).toHaveText("Not saved");

    // nothing new: no request
    await walkTo(page, "Beta concept");
    await walkTo(page, "Overview synthesis");
    await expect(state(page)).toHaveText("Saved");
    await button(page, SAVE).click();
    await expect(message(page)).toContainText("Already up to date.");
    expect(m.puts).toHaveLength(1);
  });

  test("a reload keeps the link: the address names the copy and Save updates it", async ({ page }) => {
    const m = newMock();
    await open(page, m, [ALPHA, BETA]);
    await button(page, SAVE).click();
    await dialog(page, SAVE).getByRole("button", { name: "Save", exact: true }).click();
    await expect(state(page)).toHaveText("Saved");
    await page.reload();
    await expect(steps(page)).toHaveCount(2);
    await expect(state(page)).toHaveText("Saved");
    await walkTo(page, "Overview synthesis");
    await expect(state(page)).toHaveText("Not saved");
    await button(page, SAVE).click();
    await expect.poll(() => m.puts.length).toBe(1);
    expect(m.puts[0].id).toBe("n1");
    expect(m.posts).toHaveLength(1);
  });

  test("a failure keeps the dialog open and says so; Escape closes it and gives the focus back", async ({ page }) => {
    const m = newMock({ failSave: true });
    await open(page, m, [ALPHA, BETA]);
    await button(page, SAVE).click();
    const d = dialog(page, SAVE);
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await expect(d.getByRole("alert")).toHaveText("The journey could not be saved. Try again.");
    await expect(d).toBeVisible();
    await expect(state(page)).toHaveText("Not saved");
    expect(urlParam(page, "journey")).toBeNull();
    m.failSave = false;
    await page.keyboard.press("Escape");
    await expect(d).toBeHidden();
    await expect(button(page, SAVE)).toBeFocused();
    await expect(panel(page)).toBeVisible(); // Escape closed the dialog and nothing else
    await expect(steps(page)).toHaveCount(2);
    await button(page, SAVE).click();
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await expect(state(page)).toHaveText("Saved");
  });

  test("a failed update says so in the panel and the state stays 'Not saved'", async ({ page }) => {
    const m = newMock();
    await open(page, m, [ALPHA, BETA]);
    await button(page, SAVE).click();
    await dialog(page, SAVE).getByRole("button", { name: "Save", exact: true }).click();
    await expect(state(page)).toHaveText("Saved");
    await walkTo(page, "Overview synthesis");
    m.failSave = true;
    await button(page, SAVE).click();
    await expect(message(page)).toContainText("The journey could not be saved. Try again.");
    await expect(state(page)).toHaveText("Not saved");
  });

  test("a copy deleted elsewhere is saved again under its name", async ({ page }) => {
    const m = newMock();
    await open(page, m, [ALPHA, BETA]);
    await button(page, SAVE).click();
    await dialog(page, SAVE).getByRole("textbox", { name: "Journey name" }).fill("Gone soon");
    await dialog(page, SAVE).getByRole("button", { name: "Save", exact: true }).click();
    await expect(state(page)).toHaveText("Saved");
    m.journeys = [];
    await walkTo(page, "Overview synthesis");
    await button(page, SAVE).click();
    await expect(message(page)).toContainText("Journey saved.");
    expect(m.posts.at(-1)).toEqual({ title: "Gone soon", route: [ALPHA, BETA, OVERVIEW] });
    expect(urlParam(page, "journey")).toBe("n1");
  });

  test("Clear starts over: the next route is a new copy, not an update of the old one", async ({ page }) => {
    const m = newMock({ journeys: [journey("j1", "Alpha to Beta", [ALPHA, BETA])] });
    await open(page, m, [ALPHA, BETA], "&journey=j1");
    await expect(state(page)).toHaveText("Saved");
    await panel(page).getByRole("button", { name: "Clear", exact: true }).click();
    await expect.poll(() => urlParam(page, "journey")).toBeNull();
    await expect(steps(page)).toHaveCount(0);
    await page.locator("#graph-search").fill("Gamma entity"); // a new departure, from the search field
    await page.locator("#graph-search").press("Enter");
    await expect(steps(page)).toHaveCount(1);
    await expect(state(page)).toHaveText("Not saved");
    await button(page, SAVE).click();
    await expect(dialog(page, SAVE)).toBeVisible();
    await dialog(page, SAVE).getByRole("button", { name: "Save", exact: true }).click();
    await expect(state(page)).toHaveText("Saved");
    expect(m.puts).toHaveLength(0);
    expect(m.posts).toEqual([{ title: "Journey: Gamma entity", route: [GAMMA] }]);
  });
});

test.describe("signed out", () => {
  test("with a provider: Save stays visible, says to sign in, and a click offers the providers; the route stays in the address", async ({ page }) => {
    await open(page, newMock({ me: null }), [ALPHA, BETA]);
    await expect(state(page)).toBeEmpty(); // nothing to say about a copy without an account
    const save = button(page, SIGN_IN_TO_SAVE);
    await expect(save).toHaveText("Save");
    await save.click();
    const d = dialog(page, "Sign in to save");
    await expect(d).toBeVisible();
    const login = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/auth/login/oidc");
    await d.getByRole("button", { name: "Sign in with Authelia" }).click();
    const back = new URL(new URL((await login).url()).searchParams.get("return")!, "http://x");
    expect(back.pathname).toBe("/graph/");
    expect(back.searchParams.get("view")).toBe("journey");
    expect(back.searchParams.get("route")).toBe(`${ALPHA},${BETA}`);
  });

  test("Escape closes the invitation and gives the focus back to Save", async ({ page }) => {
    await open(page, newMock({ me: null }), [ALPHA, BETA]);
    await button(page, SIGN_IN_TO_SAVE).click();
    await expect(dialog(page, "Sign in to save")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page, "Sign in to save")).toBeHidden();
    await expect(button(page, SIGN_IN_TO_SAVE)).toBeFocused();
  });

  for (const [label, providers] of [["a static site", null], ["a server with no provider", []]] as const) {
    test(`${label}: no Save, no invitation to sign in, Export works`, async ({ page }) => {
      await open(page, newMock({ me: null, providers: providers as Mock["providers"] }), [ALPHA, BETA]);
      await expect(button(page, EXPORT)).toBeEnabled();
      await expect(panel(page).getByRole("button", { name: /Save|Sign in/ })).toHaveCount(0);
      await expect(state(page)).toBeEmpty();
    });
  }

  test("an address that names a saved copy without a session forgets it", async ({ page }) => {
    await open(page, newMock({ me: null }), [ALPHA, BETA], "&journey=j1");
    await expect.poll(() => urlParam(page, "journey")).toBeNull();
    expect(urlParam(page, "route")).toBe(`${ALPHA},${BETA}`);
  });
});

test.describe("account page", () => {
  const SAVED = journey("j1", "Alpha to Beta", [ALPHA, BETA]);
  const row = (page: Page) => page.getByRole("region", { name: /^(Journeys|Voyages)$/ });

  test("Open leads to the map linked to the saved copy: the state is right and Save updates that very copy", async ({ page }) => {
    const m = newMock({ journeys: [SAVED, journey("j2", "Solo", [GAMMA])] });
    await mockApi(page, m);
    await page.goto("/account/");
    const link = row(page).getByRole("link", { name: "Open the journey « Alpha to Beta » on the map" });
    expect(new URL((await link.getAttribute("href"))!, page.url()).searchParams.get("journey")).toBe("j1");
    await link.click();
    await expect(page).toHaveURL(/\/graph\/\?view=journey&route=[^&]+&journey=j1$/);
    await expect(steps(page)).toHaveCount(2);
    await expect(state(page)).toHaveText("Saved");
    expect(m.gets).toContain("j1");
    expect(urlParam(page, "journey")).toBe("j1");

    await walkTo(page, "Overview synthesis");
    await expect(state(page)).toHaveText("Not saved");
    await button(page, SAVE).click();
    await expect(message(page)).toContainText("Journey updated.");
    expect(m.puts).toEqual([{ id: "j1", body: { route: [ALPHA, BETA, OVERVIEW] } }]);
    expect(m.posts).toHaveLength(0);
    await expect(state(page)).toHaveText("Saved");
    // the copy keeps its name, and is exported under it
    const [dl] = await Promise.all([page.waitForEvent("download"), button(page, EXPORT).click()]);
    expect(dl.suggestedFilename()).toBe("alpha-to-beta.md");
    const md = await read(dl);
    expect(md).toContain('title: "Alpha to Beta"\ndate: 2026-11-01T10:00:00.000Z\n'); // the copy's creation date
    expect(md).toContain("steps: 3");
  });

  test("a copy that no longer exists: the address forgets it and Save makes a new one", async ({ page }) => {
    const m = newMock();
    await open(page, m, [ALPHA, BETA], "&journey=gone");
    await expect.poll(() => urlParam(page, "journey")).toBeNull();
    await expect(state(page)).toHaveText("Not saved");
    await button(page, SAVE).click();
    await dialog(page, SAVE).getByRole("button", { name: "Save", exact: true }).click();
    await expect(state(page)).toHaveText("Saved");
    expect(m.puts).toHaveLength(0);
    expect(m.posts).toHaveLength(1);
  });

  test("Export downloads the saved journey as Markdown, with the whole content of its pages", async ({ page }) => {
    await mockApi(page, newMock({ journeys: [SAVED] }));
    await page.goto("/account/");
    const exportButton = row(page).getByRole("button", { name: "Export the journey « Alpha to Beta »" });
    await expect(exportButton).not.toHaveAttribute("aria-disabled", "true");
    const [dl] = await Promise.all([page.waitForEvent("download"), exportButton.click()]);
    expect(dl.suggestedFilename()).toBe("alpha-to-beta.md");
    const md = await read(dl), base = site(page);
    expect(md).toContain('title: "Alpha to Beta"\ndate: 2026-11-01T10:00:00.000Z\nsource: Cortex\n');
    expect(md).toContain("kind: journey\nsteps: 2\nroute: [concepts/alpha, concepts/beta]\n");
    expect(md).toContain(`2. [Beta concept](${base}wiki/concepts/beta/) (Concept): cites and is cited by step 1`);
    expect(md).toContain("A nested section.");
    expect(md).toContain("zebracorn");
  });

  test("an export that fails says so in the list's status", async ({ page }) => {
    await mockApi(page, newMock({ journeys: [SAVED] }));
    await page.goto("/account/");
    await expect(row(page).getByRole("listitem")).toHaveCount(1);
    await page.route("**/api/journeys/j1", (r) => r.fulfill({ status: 500, contentType: "application/json", body: "{}" })); // the saved journey cannot be read
    await row(page).getByRole("button", { name: "Export the journey « Alpha to Beta »" }).click();
    await expect(row(page).locator("[aria-live=polite]")).toHaveText("The export failed. Try again.");
  });
});
