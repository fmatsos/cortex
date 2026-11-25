import type { Page } from "@playwright/test";
import { expect, test } from "./helpers";

// Accounts on the front end: the header menu (sign-in methods, identity, sign-out), the `?auth=` announcement, the account
// page (conversations, journeys, deletion) and the synchronisation of theme, language and favorites. There is no real
// identity provider and no `cortex serve` here: every `/api/*` answer is a mock (`page.route`) that keeps its own state.
// Service workers are blocked so that a reload never lets one answer in place of the mock.
test.use({ serviceWorkers: "block", launchOptions: { args: ["--enable-unsafe-swiftshader"] } });

type Conversation = { id: string; title: string; exchanges: number; created_at: string; updated_at: string };
type Journey = { id: string; title: string; route: string[]; created_at: string; updated_at: string };
type Mock = {
  /** `null`: the route does not exist (static site). */
  providers: { id: string; label: string }[] | null;
  me: { id: string; name: string; email: string; provider: string } | null;
  state: Record<string, unknown>;
  conversations: Conversation[];
  journeys: Journey[];
  calls: string[];
  puts: Record<string, unknown>[];
  bodies: Record<string, unknown>[];
};

const ADA = { id: "u1", name: "Ada Lovelace", email: "ada@example.org", provider: "oidc" };
const PROVIDERS = [{ id: "oidc", label: "Authelia" }, { id: "github", label: "GitHub" }];
const conv = (id: string, title: string, exchanges: number, updated: string): Conversation => ({ id, title, exchanges, created_at: "2026-11-01T10:00:00.000Z", updated_at: updated });
const journey = (id: string, title: string, route: string[], updated: string): Journey => ({ id, title, route, created_at: "2026-11-01T10:00:00.000Z", updated_at: updated });

const newMock = (over: Partial<Mock> = {}): Mock => ({
  providers: PROVIDERS,
  me: null,
  state: {},
  conversations: [conv("c1", "Alpha question", 3, "2026-11-03T10:00:00.000Z"), conv("c2", "Beta deep dive", 1, "2026-11-02T10:00:00.000Z")],
  journeys: [journey("j1", "Alpha to Beta", ["concepts/alpha", "concepts/beta"], "2026-11-03T10:00:00.000Z"), journey("j2", "Solo stop", ["entities/gamma"], "2026-11-02T10:00:00.000Z")],
  calls: [], puts: [], bodies: [],
  ...over,
});

async function mockApi(page: Page, m: Mock) {
  await page.route("**/api/**", async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    m.calls.push(`${method} ${path}${url.search}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const body = () => (req.postData() ? JSON.parse(req.postData()!) : {});

    if (path === "/api/auth/methods") return m.providers ? json({ providers: m.providers }) : route.fulfill({ status: 404 });
    if (path.startsWith("/api/auth/login/")) return route.fulfill({ status: 200, contentType: "text/html", body: "<title>provider</title>login" });
    if (path === "/api/auth/logout") { m.me = null; return json({ ok: true }); }
    if (path === "/api/me") {
      if (!m.me) return json({ error: "not signed in" }, 401);
      if (method === "DELETE") { m.me = null; return json({ ok: true }); }
      return json(m.me);
    }
    if (!m.me) return json({ error: "not signed in" }, 401);
    if (path === "/api/me/state") {
      if (method === "PUT") { m.state = body(); m.puts.push(m.state); return json({ ok: true }); }
      return json(m.state);
    }
    if (path === "/api/conversations") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      return json({ conversations: m.conversations.filter((c) => c.title.toLowerCase().includes(q)) });
    }
    const c = path.match(/^\/api\/conversations\/(.+)$/);
    if (c) {
      const found = m.conversations.find((x) => x.id === c[1]);
      if (!found) return json({ error: "no such conversation" }, 404);
      if (method === "DELETE") { m.conversations = m.conversations.filter((x) => x !== found); return json({ ok: true }); }
      if (method === "PUT") { m.bodies.push(body()); found.title = body().title; found.updated_at = "2026-11-10T10:00:00.000Z"; return json({ ...found, turns: [] }); }
      return json({ ...found, turns: [] });
    }
    if (path === "/api/journeys") return json({ journeys: m.journeys });
    const j = path.match(/^\/api\/journeys\/(.+)$/);
    if (j) {
      const found = m.journeys.find((x) => x.id === j[1]);
      if (!found) return json({ error: "no such journey" }, 404);
      if (method === "DELETE") { m.journeys = m.journeys.filter((x) => x !== found); return json({ ok: true }); }
      if (method === "PUT") { m.bodies.push(body()); found.title = body().title; found.updated_at = "2026-11-10T10:00:00.000Z"; return json(found); }
      return json(found);
    }
    return route.fulfill({ status: 404 });
  });
}

const trigger = (page: Page) => page.getByRole("banner").locator("[data-prefs-trigger]");
const menu = (page: Page) => page.getByRole("menu");
const noHScroll = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth);
const settle = (page: Page) => page.waitForLoadState("networkidle");

test.describe("header menu", () => {
  test("a static site (no /api/auth/methods) keeps the preferences menu, with no account element and no further request", async ({ page }) => {
    const m = newMock({ providers: null });
    await mockApi(page, m);
    await page.goto("/search/");
    await settle(page);
    await expect(trigger(page)).toHaveText(/^(Preferences|Préférences)\s*$/);
    await trigger(page).click();
    await expect(menu(page).getByRole("group", { name: /^(Theme|Thème)$/ })).toBeVisible();
    await expect(menu(page).getByText(/Sign in|Se connecter|Account|Compte/)).toHaveCount(0);
    expect(m.calls.filter((c) => c.includes("/api/me"))).toEqual([]);
  });

  test("a server with sign-in configured but nobody signed in: the preferences, then one button per provider", async ({ page }) => {
    const m = newMock();
    await mockApi(page, m);
    await page.goto("/search/?q=alpha");
    await expect(trigger(page)).toHaveText(/^(Account|Compte)\s*$/);
    await trigger(page).click();
    // the preferences are untouched
    await expect(menu(page).getByRole("group", { name: /^(Theme|Thème)$/ }).getByRole("menuitemradio")).toHaveCount(3);
    await expect(menu(page).getByRole("group", { name: /^(Language|Langue)$/ }).getByRole("menuitemradio")).toHaveCount(3);
    await expect(menu(page).getByRole("group", { name: /^(Offline mode|Mode hors ligne)$/ })).toBeVisible();
    const signIn = menu(page).getByRole("group", { name: /^(Sign in|Se connecter)$/ });
    await expect(signIn.getByRole("menuitem")).toHaveText([/Sign in with Authelia/, /Sign in with GitHub/]);
    expect(await signIn.getByRole("menuitem").first().evaluate((el) => getComputedStyle(el).cursor)).toBe("pointer");

    // the provider is asked for the page the visitor is on
    const login = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/auth/login/github");
    await signIn.getByRole("menuitem", { name: /GitHub/ }).click();
    const url = new URL((await login).url());
    expect(url.searchParams.get("return")).toBe("/search/?q=alpha");
  });

  test("signed in: the name labels the button, the identity is information, the page of the account and sign-out close the menu", async ({ page }) => {
    const m = newMock({ me: ADA });
    await mockApi(page, m);
    await page.goto("/search/");
    await expect(trigger(page)).toHaveAccessibleName("Account: Ada Lovelace");
    await trigger(page).focus();
    await page.keyboard.press("Enter");
    await expect(menu(page)).toBeVisible();
    // the first thing the keyboard reaches is a preference, never the identity
    await expect(menu(page).getByRole("menuitemradio").first()).toBeFocused();
    const identity = menu(page).getByRole("group", { name: /^(Signed-in account|Compte connecté)$/ });
    await expect(identity).toContainText("Ada Lovelace");
    await expect(identity).toContainText("ada@example.org");
    await expect(identity).toContainText("via Authelia");
    await expect(identity.getByRole("menuitem")).toHaveCount(0);
    await expect(menu(page).getByRole("group", { name: /^(Theme|Thème)$/ })).toBeVisible();
    const mine = menu(page).getByRole("menuitem", { name: /^(My account|Mon compte)$/ });
    await expect(mine).toHaveAttribute("href", /\/account\/$/);
    await expect(menu(page).getByRole("menuitem", { name: /Sign in/ })).toHaveCount(0);
    for (const item of [mine, menu(page).getByRole("menuitem", { name: /^(Sign out|Se déconnecter)$/ })]) expect(await item.evaluate((el) => getComputedStyle(el).cursor)).toBe("pointer");
    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeHidden();
    await expect(trigger(page)).toBeFocused();

    await trigger(page).click();
    await mine.click();
    await expect(page).toHaveURL(/\/account\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^(My account|Mon compte)$/);
  });

  test("Sign out posts the logout, reloads, and the menu offers the sign-in again", async ({ page }) => {
    const m = newMock({ me: ADA });
    await mockApi(page, m);
    await page.goto("/search/");
    await expect(trigger(page)).toHaveAccessibleName(/Ada Lovelace/);
    await trigger(page).click();
    const logout = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/auth/logout");
    await menu(page).getByRole("menuitem", { name: /^(Sign out|Se déconnecter)$/ }).click();
    await logout;
    await expect(trigger(page)).toHaveText(/^(Account|Compte)\s*$/);
    await trigger(page).click();
    await expect(menu(page).getByRole("menuitem", { name: /Sign in with Authelia/ })).toBeVisible();
  });

  test("the language of the interface carries to the account entries", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("cortex:lang", "fr"));
    await mockApi(page, newMock({ me: ADA }));
    await page.goto("/search/");
    await expect(trigger(page)).toHaveAccessibleName("Compte : Ada Lovelace");
    await trigger(page).click();
    await expect(menu(page).getByRole("menuitem", { name: "Mon compte" })).toBeVisible();
    await expect(menu(page).getByRole("menuitem", { name: "Se déconnecter" })).toBeVisible();
  });

  for (const width of [320, 390, 1440]) {
    test(`signed in at ${width}: no horizontal scroll, the menu stays inside the screen with a long address`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await mockApi(page, newMock({ me: { ...ADA, email: "ada.lovelace.with.a.very.long.address.indeed@a-rather-long-domain-name.example.org" } }));
      await page.goto("/");
      await expect(trigger(page)).toHaveAccessibleName(/Ada Lovelace/);
      expect(await noHScroll(page)).toBe(true);
      const right = (await trigger(page).boundingBox())!;
      expect(right.x + right.width).toBeLessThanOrEqual(width);
      await trigger(page).click();
      const box = (await menu(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await noHScroll(page)).toBe(true);
    });
  }
});

test.describe("sign-in announcement", () => {
  for (const [auth, text] of [["refused", /not allowed|pas autorisé/], ["error", /failed|échoué/]] as const) {
    test(`?auth=${auth} is announced, then cleared from the URL`, async ({ page }) => {
      await mockApi(page, newMock());
      await page.goto(`/search/?q=alpha&auth=${auth}`);
      const alert = page.getByRole("alert").filter({ hasText: text });
      await expect(alert).toBeVisible();
      await expect.poll(() => new URL(page.url()).search).toBe("?q=alpha");
      // the message goes away on request
      await alert.getByRole("button", { name: /^(Close this message|Fermer ce message)$/ }).click();
      await expect(alert).toBeHidden();
    });
  }

  test("an unknown ?auth= value is left alone", async ({ page }) => {
    await mockApi(page, newMock());
    await page.goto("/search/?auth=whatever");
    await settle(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe("account page", () => {
  test("a static site says there are no accounts", async ({ page }) => {
    await mockApi(page, newMock({ providers: null }));
    await page.goto("/account/");
    await expect(page.getByRole("main").getByText(/^(Accounts are not available here|Les comptes ne sont pas disponibles ici)$/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign in|Se connecter/ })).toHaveCount(0);
  });

  test("signed out: a clear message and one button per provider", async ({ page }) => {
    await mockApi(page, newMock());
    await page.goto("/account/");
    await expect(page.getByRole("main").getByText(/^(You are not signed in|Vous n'êtes pas connecté)$/)).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: /Sign in with GitHub/ })).toBeVisible();
    const login = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/auth/login/oidc");
    await page.getByRole("main").getByRole("button", { name: /Sign in with Authelia/ }).click();
    expect(new URL((await login).url()).searchParams.get("return")).toBe("/account/");
  });

  test("lists, counts in a live region, a square surface with a light relief, no horizontal scroll", async ({ page }) => {
    await mockApi(page, newMock({ me: ADA }));
    await page.goto("/account/");
    const conversations = page.getByRole("region", { name: "Conversations" });
    const journeys = page.getByRole("region", { name: /^(Journeys|Voyages)$/ });
    await expect(conversations.getByRole("listitem")).toHaveCount(2);
    await expect(conversations.getByRole("listitem").first()).toContainText("Alpha question");
    await expect(conversations.getByRole("listitem").first()).toContainText("3 exchanges");
    await expect(conversations.getByRole("listitem").first()).toContainText(/Updated/);
    await expect(conversations.locator("[aria-live=polite]")).toHaveText("2 conversations");
    await expect(journeys.getByRole("listitem")).toHaveCount(2);
    await expect(journeys.getByRole("listitem").first()).toContainText("2 steps");
    await expect(journeys.locator("[aria-live=polite]")).toHaveText("2 journeys");
    await expect(page.getByRole("main").getByText("Ada Lovelace").first()).toBeVisible();
    await expect(page.getByRole("main").getByText("ada@example.org")).toBeVisible();

    const look = await conversations.evaluate((el) => { const s = getComputedStyle(el); return { radius: s.borderTopLeftRadius, shadow: s.boxShadow }; });
    expect(look.radius).toBe("0px");
    expect(look.shadow).not.toBe("none");
    expect(await noHScroll(page)).toBe(true);
    // every action stays inside the screen, with a full accessible name and the same text as tooltip
    const vw = page.viewportSize()!.width;
    for (const btn of await page.getByRole("main").locator("li").getByRole("button").all()) {
      const box = (await btn.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(vw);
    }
    const resume = conversations.getByRole("button", { name: "Resume the conversation « Alpha question »" });
    await expect(resume).toHaveAttribute("title", /Resume the conversation « Alpha question »/);
  });

  test("without the assistant (no /api/ask) Resume is inert, Export of a conversation works; Export of a journey waits for phase D", async ({ page }) => {
    await mockApi(page, newMock({ me: ADA }));
    await page.goto("/account/");
    const conversations = page.getByRole("region", { name: "Conversations" });
    const resume = conversations.getByRole("button", { name: /^Resume the conversation « Alpha question »$/ });
    await expect(resume).toHaveAttribute("aria-disabled", "true");
    await expect(resume).toHaveAttribute("title", /Available soon/);
    await resume.click({ force: true }); // aria-disabled: Playwright would wait for it to be enabled
    await expect(conversations.getByRole("button", { name: /^Export the conversation « Alpha question » as Markdown$/ })).not.toHaveAttribute("aria-disabled", "true");
    const exportJourney = page.getByRole("region", { name: /^(Journeys|Voyages)$/ }).getByRole("button", { name: /^Export the journey « Alpha to Beta »$/ });
    await expect(exportJourney).toHaveAttribute("aria-disabled", "true");
    await exportJourney.click({ force: true });
  });

  test("the search field filters after 250 ms and a late answer never replaces a newer one", async ({ page }) => {
    const m = newMock({ me: ADA });
    await mockApi(page, m);
    await page.goto("/account/");
    const conversations = page.getByRole("region", { name: "Conversations" });
    await expect(conversations.getByRole("listitem")).toHaveCount(2);
    const field = conversations.getByRole("searchbox", { name: "Search conversations" });
    await field.pressSequentially("be");
    await expect(conversations.getByRole("listitem")).toHaveCount(1);
    await expect(conversations.getByRole("listitem")).toContainText("Beta deep dive");
    // one request for the whole word typed in one go, not one per letter
    expect(m.calls.filter((c) => c.startsWith("GET /api/conversations?q="))).toEqual(["GET /api/conversations?q=be"]);
    await field.fill("zzz");
    await expect(conversations.getByText(/No conversation matches « zzz »/)).toBeVisible();
    await expect(conversations.getByRole("listitem")).toHaveCount(0);
    await field.fill("");
    await expect(conversations.getByRole("listitem")).toHaveCount(2);
  });

  test("rename a conversation: the dialog, Enter saves the title alone, the list follows; Escape cancels", async ({ page }) => {
    const m = newMock({ me: ADA });
    await mockApi(page, m);
    await page.goto("/account/");
    const conversations = page.getByRole("region", { name: "Conversations" });
    const open = conversations.getByRole("button", { name: "Rename the conversation « Alpha question »" });
    await open.click();
    const dialog = page.getByRole("dialog", { name: "Rename the conversation" });
    await expect(dialog).toBeVisible();
    const field = dialog.getByRole("textbox", { name: "Title" });
    await expect(field).toHaveValue("Alpha question");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
    expect(m.bodies).toEqual([]);

    await open.click();
    await field.fill("  Renamed   thread ");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    expect(m.bodies).toEqual([{ title: "Renamed thread" }]);
    await expect(conversations.getByRole("listitem").first()).toContainText("Renamed thread");
    await expect(conversations.getByRole("button", { name: "Rename the conversation « Renamed thread »" })).toBeVisible();
  });

  test("delete a conversation asks first: Cancel keeps it, Delete removes it and moves the focus to the section", async ({ page }) => {
    const m = newMock({ me: ADA });
    await mockApi(page, m);
    await page.goto("/account/");
    const conversations = page.getByRole("region", { name: "Conversations" });
    const remove = conversations.getByRole("button", { name: "Delete the conversation « Beta deep dive »" });
    await remove.click();
    const dialog = page.getByRole("dialog", { name: "Delete this conversation?" });
    await expect(dialog).toContainText("« Beta deep dive » will be deleted");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(conversations.getByRole("listitem")).toHaveCount(2);
    expect(m.calls.some((c) => c.startsWith("DELETE"))).toBe(false);

    await remove.click();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(conversations.getByRole("listitem")).toHaveCount(1);
    expect(m.calls).toContain("DELETE /api/conversations/c2");
    await expect(conversations.locator("[aria-live=polite]")).toHaveText("1 conversation");
    await expect(conversations.getByRole("heading", { name: "Conversations" })).toBeFocused();
  });

  test("a failed deletion keeps the dialog open and says so", async ({ page }) => {
    await mockApi(page, newMock({ me: ADA }));
    await page.route("**/api/conversations/c1", (route) => (route.request().method() === "DELETE" ? route.fulfill({ status: 500, body: "{}" }) : route.fallback()));
    await page.goto("/account/");
    const conversations = page.getByRole("region", { name: "Conversations" });
    await conversations.getByRole("button", { name: "Delete the conversation « Alpha question »" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(/deletion failed/);
    await expect(dialog).toBeVisible();
    await expect(conversations.getByRole("listitem")).toHaveCount(2);
  });

  test("a failed list shows an error with Retry, and Retry loads it", async ({ page }) => {
    const m = newMock({ me: ADA });
    await mockApi(page, m);
    let fail = true;
    await page.route("**/api/conversations*", (route) => (fail ? route.fulfill({ status: 500, body: "{}" }) : route.fallback()));
    await page.goto("/account/");
    const conversations = page.getByRole("region", { name: "Conversations" });
    await expect(conversations.getByText("The list could not be loaded.")).toBeVisible();
    fail = false;
    await conversations.getByRole("button", { name: "Retry" }).click();
    await expect(conversations.getByRole("listitem")).toHaveCount(2);
  });

  test("empty lists say what will appear there", async ({ page }) => {
    await mockApi(page, newMock({ me: ADA, conversations: [], journeys: [] }));
    await page.goto("/account/");
    await expect(page.getByText("No saved conversation")).toBeVisible();
    await expect(page.getByText("No saved journey")).toBeVisible();
    await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(0);
  });

  test("a journey opens on the map at its own route", async ({ page }) => {
    await mockApi(page, newMock({ me: ADA }));
    await page.goto("/account/");
    const journeys = page.getByRole("region", { name: /^(Journeys|Voyages)$/ });
    const open = journeys.getByRole("link", { name: "Open the journey « Alpha to Beta » on the map" });
    expect(new URL((await open.getAttribute("href"))!, page.url()).searchParams.get("route")).toBe("concepts/alpha,concepts/beta");
    expect(new URL((await open.getAttribute("href"))!, page.url()).searchParams.get("view")).toBe("journey");
    await open.click();
    await expect(page).toHaveURL(/\/graph\/\?view=journey&route=/);
    await expect(page.getByRole("complementary", { name: /^(Voyage|Journey)$/ }).locator("ol > li")).toHaveCount(2);
  });

  test("rename and delete a journey", async ({ page }) => {
    const m = newMock({ me: ADA });
    await mockApi(page, m);
    await page.goto("/account/");
    const journeys = page.getByRole("region", { name: /^(Journeys|Voyages)$/ });
    await journeys.getByRole("button", { name: "Rename the journey « Solo stop »" }).click();
    const dialog = page.getByRole("dialog", { name: "Rename the journey" });
    await dialog.getByRole("textbox", { name: "Title" }).fill("Lone stop");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    expect(m.bodies).toEqual([{ title: "Lone stop" }]);
    await expect(journeys.getByRole("listitem").first()).toContainText("Lone stop"); // the newest update comes first

    await journeys.getByRole("button", { name: "Delete the journey « Lone stop »" }).click();
    await page.getByRole("dialog", { name: "Delete this journey?" }).getByRole("button", { name: "Delete", exact: true }).click();
    await expect(journeys.getByRole("listitem")).toHaveCount(1);
    expect(m.calls).toContain("DELETE /api/journeys/j2");
    await expect(journeys.locator("[aria-live=polite]")).toHaveText("1 journey");
  });

  test("sign out from the page, then delete the account: a confirmation, the DELETE, and the home page signed out", async ({ page }) => {
    const m = newMock({ me: ADA });
    await mockApi(page, m);
    await page.goto("/account/");
    await page.getByRole("button", { name: /^(Delete my account|Supprimer mon compte)$/ }).click();
    const dialog = page.getByRole("dialog", { name: "Delete your account?" });
    await expect(dialog).toContainText("cannot be undone");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(m.calls).not.toContain("DELETE /api/me");
    await page.getByRole("button", { name: /^(Delete my account|Supprimer mon compte)$/ }).click();
    await dialog.getByRole("button", { name: "Delete my account and its data" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(m.calls).toContain("DELETE /api/me");
    expect(m.me).toBeNull();
    await expect(trigger(page)).toHaveText(/^(Account|Compte)\s*$/);
    await trigger(page).click();
    await expect(menu(page).getByRole("menuitem", { name: /Sign in with Authelia/ })).toBeVisible();
  });
});

test.describe("preferences synchronisation", () => {
  const seed = (page: Page, items: Record<string, string>) => page.addInitScript((kv) => { if (!sessionStorage.getItem("seeded")) { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); sessionStorage.setItem("seeded", "1"); } }, items);
  const favs = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("cortex:favs") ?? "[]"));

  test("the first synchronisation of an account sends the local state, whole", async ({ page }) => {
    await seed(page, { "cortex:theme": "dark", "cortex:lang": "fr", "cortex:favs": JSON.stringify(["concepts/alpha"]) });
    const m = newMock({ me: ADA, state: {} });
    await mockApi(page, m);
    await page.goto("/search/");
    await expect.poll(() => m.puts.length).toBe(1);
    expect(m.puts[0]).toEqual({ theme: "dark", lang: "fr", favs: ["concepts/alpha"] });
  });

  test("a later synchronisation applies the server's state; favorites are the union; the difference is sent back", async ({ page }) => {
    await seed(page, { "cortex:favs": JSON.stringify(["concepts/alpha"]) });
    const m = newMock({ me: ADA, state: { theme: "dark", lang: "fr", favs: ["entities/gamma"], other: { kept: true } } });
    await mockApi(page, m);
    await page.goto("/search/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect.poll(() => favs(page)).toEqual(["entities/gamma", "concepts/alpha"]);
    // the local favorite the server did not have goes up (one PUT, the unknown key kept as the server had it)
    await expect.poll(() => m.puts.length).toBe(1);
    expect(m.puts[0]).toEqual({ theme: "dark", lang: "fr", favs: ["entities/gamma", "concepts/alpha"], other: { kept: true } });
    expect(await page.evaluate(() => localStorage.getItem("cortex:theme"))).toBe("dark");
  });

  test("a server state that already says the same sends nothing; a change goes up once, about 1.5 s after the last", async ({ page }) => {
    await seed(page, { "cortex:favs": JSON.stringify(["concepts/alpha"]) });
    const m = newMock({ me: ADA, state: { theme: "system", lang: "system", favs: ["concepts/alpha"] } });
    await mockApi(page, m);
    await page.goto("/search/");
    await expect(trigger(page)).toHaveAccessibleName(/Ada Lovelace/);
    await page.waitForTimeout(500);
    expect(m.puts).toEqual([]);

    await trigger(page).click();
    await menu(page).getByRole("menuitemradio", { name: /^(Dark|Sombre)$/ }).click();
    await page.waitForTimeout(500);
    expect(m.puts, "debounced: nothing yet").toEqual([]);
    await trigger(page).click();
    await menu(page).getByRole("menuitemradio", { name: /^(Light|Clair)$/ }).click();
    await expect.poll(() => m.puts.length, { timeout: 6000 }).toBe(1);
    expect(m.puts[0]).toEqual({ theme: "light", lang: "system", favs: ["concepts/alpha"] });
    await page.waitForTimeout(1800);
    expect(m.puts.length).toBe(1);
  });

  test("signed out, nothing is ever sent and nothing changes", async ({ page }) => {
    await seed(page, { "cortex:theme": "dark" });
    const m = newMock();
    await mockApi(page, m);
    await page.goto("/search/");
    await expect(trigger(page)).toHaveText(/^(Account|Compte)\s*$/);
    await trigger(page).click();
    await menu(page).getByRole("menuitemradio", { name: /^(Light|Clair)$/ }).click();
    await page.waitForTimeout(2000);
    expect(m.calls.filter((c) => c.includes("/api/me/state"))).toEqual([]);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});
