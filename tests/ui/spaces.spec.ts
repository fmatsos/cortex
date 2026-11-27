import type { Page, Route } from "@playwright/test";
import { expect, test } from "./helpers";

// The multi-space UI: the switcher, the context bar, the home of a space that holds notes, read-only, "My spaces", the archived spaces,
// the creation form and the settings of a space. There is no `cortex serve` here: the static export (served at the root) is mapped under
// `/s/demo/`, as a multi-space server mounts a space's site, and every `/api/*` and `/s/<name>/api/*` answer is a mock with its own state.
// Service workers are blocked so that a reload never lets one answer in place of the mock.
test.use({ serviceWorkers: "block" });

type Content = "resources" | "notes";
type Row = { name: string; title: string | null; read_only: boolean; content?: Content[] };
type Detail = { name: string; title: string | null; visibility: "open" | "private"; read_only: boolean; content: Content[]; storage: "instance" | "own repo"; members: { id: string; name: string; role: "owner" | "member" }[]; you: "owner" | "member" };
type Mock = {
  signedIn: boolean;
  spaces: Row[];
  canCreate: boolean;
  details: Record<string, Detail>;
  archived: { name: string; title: string | null; content: Content[]; archived_at: string }[];
  /** What `GET /api/search?spaces=…` answers, and the query strings it was asked with. */
  across: { hits: { space: string; id: string; title: string; type: string; extract: string; match: string }[]; spaces: string[] };
  searches: string[];
  restoreError?: number;
  inviteError?: number;
  archiveError?: { status: number; error: string };
  createdTaken: string[];
  calls: string[];
  writes: { method: string; path: string; body: unknown }[];
};

const ADA = { id: "u1", name: "Ada Lovelace", email: "ada@example.org", provider: "oidc" };
const detail = (name: string, over: Partial<Detail> = {}): Detail => ({
  name, title: null, visibility: "private", read_only: false, content: ["resources"], storage: "instance",
  members: [{ id: "u1", name: "Ada Lovelace", role: "owner" }, { id: "u2", name: "Marie Laurent", role: "member" }], you: "owner", ...over,
});
const newMock = (over: Partial<Mock> = {}): Mock => ({
  signedIn: true,
  spaces: [
    { name: "demo", title: "Demo space", read_only: false, content: ["resources"] },
    { name: "carnet", title: "Carnet personnel", read_only: false, content: ["notes"] },
    { name: "ro", title: "Famille", read_only: true, content: ["notes", "resources"] },
    { name: "open", title: null, read_only: false, content: ["resources"] },
  ],
  canCreate: true,
  details: {
    demo: detail("demo", { title: "Demo space" }),
    carnet: detail("carnet", { title: "Carnet personnel", content: ["notes"], members: [{ id: "u1", name: "Ada Lovelace", role: "owner" }] }),
    ro: detail("ro", { title: "Famille", read_only: true, content: ["notes", "resources"], you: "member" }),
  },
  archived: [{ name: "old", title: "Ancienne documentation", content: ["notes", "resources"], archived_at: "2026-10-02T10:00:00.000Z" }],
  across: { hits: [], spaces: [] }, searches: [],
  createdTaken: [],
  calls: [], writes: [],
  ...over,
});

/** Serves the export (at the root of the test server) under `/s/demo/`, and answers the API of the mock. `space` is the name the page lives under. */
async function mount(page: Page, m: Mock, space = "demo") {
  const origin = new URL(test.info().project.use.baseURL ?? process.env.CORTEX_UI_BASE!).origin;
  await page.route("**/*", async (route: Route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) return route.continue();
    const path = url.pathname, method = req.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const body = () => (req.postData() ? JSON.parse(req.postData()!) : {});
    const own = path.match(/^\/s\/([a-z0-9-]+)(\/api\/.*)$/);
    if (path.startsWith("/api/") || own) {
      m.calls.push(`${method} ${path}`);
      const api = own ? own[2]! : path, name = own?.[1];
      if (api === "/api/auth/methods") return json({ providers: [{ id: "oidc", label: "Authelia" }] });
      if (api === "/api/me") return m.signedIn ? json(ADA) : json({ error: "not signed in" }, 401);
      if (api === "/api/me/state") { if (method === "PUT") m.writes.push({ method, path, body: body() }); return json(method === "PUT" ? { ok: true } : {}); }
      if (path === "/api/spaces" && method === "GET") return json({ spaces: m.spaces, canCreate: m.canCreate, default: "demo" });
      if (path === "/api/spaces" && method === "POST") {
        const b = body();
        m.writes.push({ method, path, body: b });
        return m.createdTaken.includes(b.name) ? json({ error: "exists" }, 409) : json({ name: b.name, url: `/s/${b.name}/` }, 201);
      }
      if (path === "/api/spaces/archived") return json({ archived: m.archived });
      const accept = path.match(/^\/api\/invites\/([A-Za-z0-9_-]+)\/accept$/);
      if (accept) {
        m.writes.push({ method, path, body: body() });
        return m.inviteError ? json({ error: "this invitation is not valid" }, m.inviteError) : json({ space: "demo", role: "member", url: "/s/demo/" });
      }
      if (path === "/api/search" && method === "GET") { m.searches.push(url.pathname + url.search); return json(m.across); }
      const restore = path.match(/^\/api\/spaces\/([a-z0-9-]+)\/restore$/);
      if (restore) {
        if (m.restoreError) return json({ error: `a space ${restore[1]} exists now` }, m.restoreError);
        m.archived = m.archived.filter((a) => a.name !== restore[1]);
        return json({ name: restore[1], url: `/s/${restore[1]}/` });
      }
      if (api === "/api/verify") return route.fulfill({ status: m.details[name ?? space]?.read_only ?? m.spaces.find((s) => s.name === name)?.read_only ? 409 : 204 });
      if (name && api === "/api/space") {
        if (method === "GET") return m.details[name] ? json(m.details[name]) : json({ error: "not found" }, 404);
        m.writes.push({ method, path, body: body() });
        Object.assign(m.details[name]!, body());
        const b = body();
        if ("title" in b) m.details[name]!.title = b.title;
        if ("read_only" in b) { m.details[name]!.read_only = b.read_only; m.spaces.find((s) => s.name === name)!.read_only = b.read_only; }
        return json(m.details[name]);
      }
      if (name && api === "/api/space/invites") {
        if (method === "POST") { m.writes.push({ method, path, body: body() }); return json({ id: "i1", role: body().role, expires_at: "2026-12-04T14:30:00.000Z", url: `/s/${name}/account/invite/?token=tok` }, 201); }
        return json({ invites: [] });
      }
      if (name && api === "/api/space/archive") {
        m.writes.push({ method, path, body: body() });
        return m.archiveError ? json({ error: m.archiveError.error }, m.archiveError.status) : json({ ok: true });
      }
      if (api === "/api/conversations" || api === "/api/journeys") return json({ conversations: [], journeys: [] });
      return json({ error: "unmocked" }, 404);
    }
    const stat = path.match(/^\/s\/[a-z0-9-]+(\/.*)$/);
    if (stat) {
      // a page left while its files are fetched: the answer is no longer wanted (the fetch is disposed with the page)
      const response = await route.fetch({ url: origin + stat[1] + url.search }).catch(() => undefined);
      if (!response) return;
      // the fixture wiki has no review notion (`features.review` is compiled in): turned on in the served chunk only, as a11y-followup.spec.ts does
      const chunk = /\/_app\/immutable\/chunks\/[^/]+\.js$/.test(path);
      const body = chunk ? (await response.text().catch(() => "")).replace("{review:!1,drafts:!1}", "{review:!0,drafts:!1}") : undefined;
      return route.fulfill(chunk ? { response, body } : { response }).catch(() => {});
    }
    return route.continue();
  });
}

const banner = (page: Page) => page.getByRole("banner");
const switcher = (page: Page) => banner(page).getByRole("button", { name: /Switch space|Changer d'espace/ });

test.describe("space switcher", () => {
  test("title first, slug second, what each space holds, read-only, current marked; create and manage at the bottom", async ({ page }) => {
    const m = newMock();
    await mount(page, m);
    await page.goto("/s/demo/");
    await expect(switcher(page)).toBeVisible();
    await expect(switcher(page)).toHaveAccessibleName(/Demo space, demo/);
    await switcher(page).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveCount(6); // four spaces, create, manage
    const current = menu.getByRole("menuitem", { name: /Demo space/ });
    await expect(current).toHaveAttribute("aria-current", "true");
    await expect(menu.getByRole("menuitem", { name: /Famille/ })).toContainText(/Read-only|Lecture seule/);
    await expect(menu.getByRole("menuitem", { name: /Carnet personnel/ })).toContainText("carnet");
    await expect(menu.getByRole("menuitem", { name: /Carnet personnel/ })).toContainText(/Notes/);
    // a space the visitor is not a member of has no title: its slug stands in, and it is open for them
    await expect(menu.getByRole("menuitem", { name: /^open/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Create a space|Créer un espace/ })).toHaveAttribute("href", /account\/new\/$/);
    await expect(menu.getByRole("menuitem", { name: /Manage my spaces|Gérer mes espaces/ })).toHaveAttribute("href", /account\/$/);
  });

  test("keyboard: ArrowDown opens it on the first space, Escape closes it and gives the focus back", async ({ page }) => {
    await mount(page, newMock());
    await page.goto("/s/demo/");
    await switcher(page).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(switcher(page)).toBeFocused();
  });

  test("hidden when nobody is signed in, and when there is nothing to choose", async ({ page }) => {
    await mount(page, newMock({ signedIn: false }));
    await page.goto("/s/demo/");
    await expect(banner(page).getByRole("link", { name: /Help|Aide/ })).toBeVisible();
    await expect(switcher(page)).toHaveCount(0);
  });

  test("a static site (no /s/<name>/ prefix, no /api/spaces) shows nothing about spaces", async ({ page }) => {
    await page.route("**/api/**", (r) => r.fulfill({ status: 404 }));
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: /^(Space|Espace)$/ })).toHaveCount(0);
    await expect(switcher(page)).toHaveCount(0);
  });
});

test.describe("home of a space", () => {
  test("a space of resources keeps the home as it was: no notes section", async ({ page }) => {
    await mount(page, newMock());
    await page.goto("/s/demo/");
    await expect(page.getByRole("navigation", { name: /^(Space|Espace)$/ })).toContainText("Demo space");
    await expect(page.locator("#notes-follow-up")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Your working thread|Votre fil de travail/ })).toHaveCount(0);
  });

  test("a space of notes shows its notes section and drops the resources part", async ({ page }) => {
    await mount(page, newMock());
    await page.goto("/s/carnet/");
    await expect(page.locator("#notes-follow-up")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Your working thread|Votre fil de travail/ })).toBeVisible();
    await expect(page.locator("#resources-section")).toHaveCount(0);
    await expect(page.getByRole("list", { name: /Page types|Types de pages/ })).toHaveCount(0);
  });

  test("a mixed space: notes first, then resources, with a link to each", async ({ page }) => {
    await mount(page, newMock());
    await page.goto("/s/ro/");
    const notes = page.locator("#notes-follow-up"), resources = page.locator("#resources-section");
    await expect(notes).toBeVisible();
    await expect(resources).toBeVisible();
    const order = await page.evaluate(() => document.getElementById("notes-follow-up")!.compareDocumentPosition(document.getElementById("resources-section")!));
    expect(order & 4).toBeTruthy(); // DOCUMENT_POSITION_FOLLOWING: the resources come after the notes
    const sections = page.getByRole("navigation", { name: /Sections of the home page|Sections de l'accueil/ });
    await expect(sections.getByRole("link")).toHaveCount(2);
    await sections.getByRole("link").last().click();
    await expect(page).toHaveURL(/#resources-section$/);
  });

  test("a read-only space says why writing is off, keeps its favorites enabled and disables validation", async ({ page }) => {
    const m = newMock();
    await mount(page, m);
    await page.goto("/s/ro/");
    await expect(page.getByRole("note")).toContainText(/Read-only|Lecture seule/);
    await expect(page.getByRole("note")).toContainText(/Favorites|favoris/);
    await page.goto("/s/ro/wiki/concepts/alpha/");
    await expect(page.getByRole("button", { name: /Add to favorites|Mettre en favori/ }).first()).toBeEnabled();
    // the verify probe answers 409: the button stays, disabled, with the reason (a link to the note that says it); an open space has it enabled
    const mark = page.getByRole("button", { name: /Mark as reviewed|Marquer comme relu/ });
    await expect(mark).toHaveAttribute("aria-disabled", "true");
    await expect(mark).toHaveAttribute("aria-describedby", "read-only-reason");
    await page.goto("/s/demo/wiki/concepts/alpha/");
    await expect(mark).toBeEnabled();
    await expect(mark).not.toHaveAttribute("aria-disabled", "true");
    await page.goto("/s/demo/");
    await expect(page.getByRole("note")).toHaveCount(0);
  });

  test("the notes of a space of notes are the pages that come from notes, labelled as such", async ({ page }) => {
    await mount(page, newMock());
    await page.goto("/s/carnet/");
    const recent = page.getByRole("region", { name: /Recent notes|Notes récentes/ });
    // the fixture's raw source "Source one" is a note, and three pages cite it (and nothing else): they come from notes
    for (const title of [/Source one/, /Alpha concept/, /Overview/]) await expect(recent.getByRole("link", { name: title })).toBeVisible();
    await expect(recent.getByText(/^(Note)$/)).toHaveCount(3);
    await expect(recent.getByRole("link", { name: /Beta concept|Gamma entity/ })).toHaveCount(0); // they cite no source at all: pages, not notes
  });

  test("the search says where it looks: the control is for someone signed in, the plain line for the others", async ({ page }) => {
    await mount(page, newMock());
    await page.goto("/s/demo/search/");
    await expect(page.getByRole("radio", { name: /This space.*Demo space|Cet espace.*Demo space/ })).toBeChecked();
    await expect(page.getByText(/In this space|Dans cet espace/)).toHaveCount(0);
    const out = await page.context().newPage();
    await mount(out, newMock({ signedIn: false }));
    await out.goto("/s/demo/search/");
    await expect(out.getByText(/In this space|Dans cet espace/)).toContainText("Demo space");
    await expect(out.getByRole("radio")).toHaveCount(0);
  });
});

test.describe("search across spaces", () => {
  const across = {
    spaces: ["demo", "carnet"],
    hits: [
      { space: "demo", id: "concepts/alpha", title: "Alpha concept", type: "Concept", extract: "The first alpha concept", match: "both" },
      { space: "carnet", id: "journal/2026-11-27", title: "Journal alpha", type: "Source", extract: "A note about alpha", match: "lexical" },
    ],
  };
  const scope = (page: Page) => page.getByRole("group", { name: /Search in|Rechercher dans/ });

  test("this space by default, nothing asked of the server; all my spaces: results grouped by space, a hit opens in its own space", async ({ page }) => {
    const m = newMock({ across });
    await mount(page, m);
    await page.goto("/s/demo/search/?q=alpha");
    await expect(scope(page).getByRole("radio", { name: /This space|Cet espace/ })).toBeChecked();
    await expect(scope(page).getByRole("radio")).toHaveCount(3);
    expect(m.searches).toEqual([]);
    await scope(page).getByRole("radio", { name: /All my spaces|Tous mes espaces/ }).check();
    const demo = page.getByRole("region", { name: /Results of Demo space|Résultats de Demo space/ }), carnet = page.getByRole("region", { name: /Results of Carnet personnel|Résultats de Carnet personnel/ });
    await expect(demo).toContainText("Alpha concept");
    await expect(carnet).toContainText("Journal alpha");
    await expect(carnet).toContainText(/Notes/); // what the space holds, as everywhere
    expect(m.searches).toEqual(["/api/search?q=alpha&spaces=all&limit=50"]);
    await expect(carnet.getByRole("link", { name: "Journal alpha" })).toHaveAttribute("href", "/s/carnet/wiki/journal/2026-11-27/");
    await expect(demo.getByRole("link", { name: "Alpha concept" })).toHaveAttribute("href", "/s/demo/wiki/concepts/alpha/");
    // back to this space: the page of its own index again
    await scope(page).getByRole("radio", { name: /This space|Cet espace/ }).check();
    await expect(page.getByRole("region", { name: /Results of|Résultats de/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Alpha concept/ }).first()).toBeVisible();
  });

  test("choose the spaces: the picked ones are asked, none asked says so, a failing search is announced", async ({ page }) => {
    const m = newMock({ across });
    await mount(page, m);
    await page.goto("/s/demo/search/?q=alpha");
    await scope(page).getByRole("radio", { name: /Choose the spaces|Choisir les espaces/ }).check();
    await expect(page.getByText(/Choose at least one space|Choisissez au moins un espace/)).toBeVisible();
    expect(m.searches).toEqual([]);
    await scope(page).getByRole("checkbox", { name: /Carnet personnel/ }).check();
    await scope(page).getByRole("checkbox", { name: /Famille/ }).check();
    await expect.poll(() => m.searches.at(-1)).toBe("/api/search?q=alpha&spaces=carnet,ro&limit=50");
    await expect(page.getByRole("region", { name: /Carnet personnel/ })).toBeVisible();
    await page.route("**/api/search?*", (r) => r.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
    await scope(page).getByRole("checkbox", { name: /Famille/ }).uncheck();
    await expect(page.getByText(/search across spaces failed|recherche dans les espaces a échoué/)).toBeVisible();
  });

  test("a visitor with one space to choose from has no control", async ({ page }) => {
    await mount(page, newMock({ spaces: [{ name: "demo", title: "Demo space", read_only: false, content: ["resources"] }] }));
    await page.goto("/s/demo/search/");
    await expect(page.getByText(/In this space|Dans cet espace/)).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
  });
});

test.describe("accepting an invitation", () => {
  const invite = "/s/demo/account/invite/?token=tok";
  const heading = (page: Page) => page.getByRole("heading", { level: 1 });

  test("signed out: the sign-in methods, and the way back to this very link", async ({ page }) => {
    await mount(page, newMock({ signedIn: false }));
    await page.goto(invite);
    await expect(heading(page)).toContainText(/Join the space demo|Rejoindre l'espace demo/);
    await expect(page.getByRole("button", { name: /Authelia/ })).toBeVisible();
    await page.route("**/api/auth/login/oidc**", (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "login" }));
    const login = page.waitForRequest("**/api/auth/login/oidc**");
    await page.getByRole("button", { name: /Authelia/ }).click();
    expect(new URL((await login).url()).searchParams.get("return")).toBe(invite);
  });

  test("signed in: joining accepts the link and goes into the space; a refused link says why", async ({ page }) => {
    const m = newMock();
    await mount(page, m);
    await page.goto(invite);
    await expect(page.getByText(/Signed in as Ada Lovelace|Connecté en tant que Ada Lovelace/)).toBeVisible();
    await page.getByRole("button", { name: /Join demo|Rejoindre demo/ }).click();
    await expect(page).toHaveURL(/\/s\/demo\/$/);
    expect(m.writes.find((w) => w.path === "/api/invites/tok/accept")).toBeTruthy();
    const refused = newMock({ inviteError: 404 });
    const second = await page.context().newPage();
    await mount(second, refused);
    await second.goto(invite);
    await second.getByRole("button", { name: /Join demo|Rejoindre demo/ }).click();
    await expect(second.getByRole("alert")).toContainText(/not valid any more|n.est plus valide/);
    await expect(second.getByRole("button", { name: /Join demo|Rejoindre demo/ })).toHaveCount(0);
  });

  test("no token: nothing to accept", async ({ page }) => {
    await mount(page, newMock());
    await page.goto("/s/demo/account/invite/");
    await expect(page.getByRole("alert")).toContainText(/not valid any more|n.est plus valide/);
  });
});

test.describe("favorites are a space's own", () => {
  test("under /s/<name>/ a favorite is sent to the space's state alone, the preferences to the root", async ({ page }) => {
    const m = newMock();
    await mount(page, m);
    await page.goto("/s/demo/wiki/concepts/alpha/");
    await expect(banner(page)).toBeVisible();
    await page.waitForLoadState("networkidle");
    m.writes.length = 0;
    await page.getByRole("button", { name: /Add to favorites|Mettre en favori/ }).first().click();
    await expect.poll(() => m.writes.filter((w) => w.path.endsWith("/api/me/state")).length, { timeout: 5000 }).toBeGreaterThan(0);
    const puts = m.writes.filter((w) => w.path.endsWith("/api/me/state"));
    expect(puts.map((w) => w.path)).toEqual(["/s/demo/api/me/state"]);
    expect(puts[0]!.body).toEqual({ favs: ["concepts/alpha"] });
  });
});

test.describe("account: my spaces", () => {
  test("a table of the spaces: title, slug, content, visibility, members, storage; settings only for the owner", async ({ page }) => {
    const m = newMock();
    await mount(page, m);
    await page.goto("/s/demo/account/");
    const table = page.getByRole("table");
    await expect(table.getByRole("row")).toHaveCount(5); // header and four spaces
    const demo = table.getByRole("row").filter({ hasText: "Demo space" });
    await expect(demo).toContainText("demo");
    await expect(demo).toContainText(/Private|Privé/);
    await expect(demo).toContainText(/2 members|2 membres/);
    await expect(demo).toContainText(/Instance repository|Dépôt de l'instance/);
    await expect(demo.getByRole("link", { name: /Settings of|Réglages de/ })).toHaveAttribute("href", /account\/settings\/\?space=demo$/);
    const ro = table.getByRole("row").filter({ hasText: "Famille" });
    await expect(ro).toContainText(/Read-only|Lecture seule/);
    await expect(ro.getByRole("link", { name: /Settings of|Réglages de/ })).toHaveCount(0);
    await expect(table.getByRole("row").filter({ hasText: "open" })).toContainText(/Open|Ouvert/);
  });

  test("create a space: only offered to who may", async ({ page }) => {
    const m = newMock({ canCreate: false });
    await mount(page, m);
    await page.goto("/s/demo/account/");
    await expect(page.getByRole("heading", { name: /My spaces|Mes espaces/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Create a space|Créer un espace/ })).toHaveCount(0);
  });

  test("archived spaces: restore, and the name taken meanwhile is said", async ({ page }) => {
    const m = newMock({ restoreError: 409 });
    await mount(page, m);
    await page.goto("/s/demo/account/");
    const section = page.getByRole("region", { name: /Archived spaces|Espaces archivés/ });
    await expect(section).toContainText("Ancienne documentation");
    await expect(section.getByRole("listitem")).toContainText(/Notes/);
    await expect(section.getByRole("listitem")).toContainText(/Resources|Ressources/);
    await section.getByRole("button", { name: /Restore|Restaurer/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("/s/old/");
    await dialog.getByRole("button", { name: /^(Restore|Restaurer)$/ }).click();
    await expect(dialog.getByRole("alert")).toContainText(/taken by another space|repris par un autre espace/);
    // the name is free again: the restoration goes through and the row leaves the list
    m.restoreError = undefined;
    await dialog.getByRole("button", { name: /^(Restore|Restaurer)$/ }).click();
    await expect(dialog).toBeHidden();
    await expect(section.getByRole("listitem")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: /restored|restauré/ })).toBeVisible();
  });
});

test.describe("create a space", () => {
  test("the slug is checked as it is typed, the address previewed, one content at least is required, then the space is created", async ({ page }) => {
    const m = newMock({ createdTaken: ["libre"] });
    await mount(page, m);
    await page.route("**/s/libre/", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>libre</title>libre" }));
    await page.goto("/s/demo/account/new/");
    const slug = page.getByLabel(/Space identifier|Identifiant de l'espace/);
    await slug.fill("Mon Espace");
    await expect(page.getByRole("alert").filter({ hasText: /lowercase|minuscules/ })).toBeVisible();
    await expect(slug).toHaveAttribute("aria-invalid", "true");
    await slug.fill("demo"); // an active space of the visitor
    await expect(page.getByRole("alert").filter({ hasText: /not available|pas disponible/ })).toBeVisible();
    await slug.fill("libre");
    await expect(page.locator("output")).toContainText("/s/libre/");
    // at least one content
    await page.getByRole("checkbox", { name: /Resources|Ressources/ }).uncheck();
    await page.getByRole("button", { name: /Create the space|Créer l'espace/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: /at least one content|au moins un contenu/ })).toBeVisible();
    expect(m.writes.filter((w) => w.path === "/api/spaces")).toEqual([]);
    await page.getByRole("checkbox", { name: /Notes/ }).check();
    await page.getByLabel(/Display title|Titre affiché/).fill("Mon carnet");
    // the server says the name is taken: said, nothing navigates
    await page.getByRole("button", { name: /Create the space|Créer l'espace/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: /not available|pas disponible/ })).toBeVisible();
    expect(m.writes.find((w) => w.path === "/api/spaces")!.body).toEqual({ name: "libre", title: "Mon carnet", content: ["notes"] });
    m.createdTaken = [];
    await page.getByRole("button", { name: /Create the space|Créer l'espace/ }).click();
    await expect(page).toHaveURL(/\/s\/libre\/$/);
  });

  test("not offered to someone who may not create", async ({ page }) => {
    await mount(page, newMock({ canCreate: false }));
    await page.goto("/s/demo/account/new/");
    await expect(page.getByText(/not open to you|ne vous est pas ouverte/)).toBeVisible();
    await expect(page.getByLabel(/Space identifier|Identifiant de l'espace/)).toHaveCount(0);
  });
});

test.describe("settings of a space", () => {
  test("owners edit the title and the content; the slug is read-only", async ({ page }) => {
    const m = newMock();
    await mount(page, m);
    await page.goto("/s/demo/account/settings/?space=demo");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Demo space");
    await expect(page.getByLabel(/Identifier and address|Identifiant et adresse/)).toHaveAttribute("readonly", "");
    await page.getByLabel(/Display title|Titre affiché/).fill("Renamed");
    await page.getByRole("checkbox", { name: /Notes/ }).check();
    await page.getByRole("button", { name: /^(Save|Enregistrer)$/ }).click();
    await expect(page.getByRole("status").filter({ hasText: /Saved|Enregistré/ })).toBeVisible();
    expect(m.writes.find((w) => w.method === "PATCH")!.body).toEqual({ title: "Renamed", content: ["resources", "notes"] });
  });

  test("a member who is not an owner is told the settings are for owners", async ({ page }) => {
    await mount(page, newMock());
    await page.goto("/s/demo/account/settings/?space=ro");
    await expect(page.getByRole("alert")).toContainText(/reserved for the owners|réservés aux propriétaires/);
    await expect(page.getByRole("button", { name: /^(Save|Enregistrer)$/ })).toHaveCount(0);
  });

  test("members: the last owner cannot be removed; an invitation link is shown with its role and copied", async ({ page, context }) => {
    const m = newMock();
    await mount(page, m);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await page.goto("/s/demo/account/settings/?space=demo");
    const ada = page.getByRole("listitem").filter({ hasText: "Ada Lovelace" });
    await expect(ada.getByRole("button", { name: /Remove|Retirer/ })).toBeDisabled();
    await expect(page.getByRole("listitem").filter({ hasText: "Marie Laurent" }).getByRole("button", { name: /Remove|Retirer/ })).toBeEnabled();
    await page.getByLabel(/Role granted by the link|Rôle accordé par le lien/).selectOption("owner");
    await page.getByRole("button", { name: /Create an invitation link|Créer un lien d'invitation/ }).click();
    await expect(page.getByLabel(/Link created|Lien créé/)).toHaveValue(/\/s\/demo\/account\/invite\/\?token=tok$/);
    expect(m.writes.find((w) => w.path.endsWith("/invites"))!.body).toEqual({ role: "owner" });
    await expect(page.getByText(/(Link created|Lien créé) · (Owner|Propriétaire)/)).toBeVisible();
  });

  test("visibility asks for a confirmation; read-only is a switch with its own save", async ({ page }) => {
    const m = newMock();
    await mount(page, m);
    await page.goto("/s/demo/account/settings/?space=demo");
    await page.getByRole("radio", { name: /^Open|^Ouvert/ }).check();
    await page.getByRole("button", { name: /Apply the visibility|Appliquer la visibilité/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(/first member|vidée|emptied/);
    await dialog.getByRole("button", { name: /Cancel|Annuler/ }).click();
    expect(m.writes.filter((w) => w.method === "PATCH")).toEqual([]);
    await page.getByRole("switch", { name: /Read-only|Lecture seule/ }).check();
    await page.getByRole("button", { name: /Save the mode|Enregistrer le mode/ }).click();
    await expect(page.getByRole("status").filter({ hasText: /now read-only|maintenant en lecture seule/ })).toBeVisible();
    expect(m.writes.find((w) => w.method === "PATCH")!.body).toEqual({ read_only: true });
  });

  test("archive: the slug has to be typed, and the server's refusal is shown as it is", async ({ page }) => {
    const m = newMock({ archiveError: { status: 409, error: "this space is its own git repository: use cortex space archive on the server." } });
    await mount(page, m);
    await page.goto("/s/demo/account/settings/?space=demo");
    await page.getByRole("button", { name: /^(Archive|Archiver)$/ }).click();
    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByRole("button", { name: /Archive the space|Archiver l'espace/ });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/Type the slug|Saisissez le slug/).fill("dem");
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/Type the slug|Saisissez le slug/).fill("demo");
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog.getByRole("alert")).toContainText("its own git repository");
    expect(m.writes.find((w) => w.path.endsWith("/archive"))!.body).toEqual({ confirm: "demo" });
  });
});
