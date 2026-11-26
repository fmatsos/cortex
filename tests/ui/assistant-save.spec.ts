import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./helpers";

// Save, resume and export of the assistant's conversations: the header buttons, the state beside the title, the dialogs,
// and the account page's Resume and Export. There is no `cortex serve` here: `/api/*` is a mock that keeps its own state.
// Both projects run it: the docked panel (desktop) and the drawer (mobile). Service workers are blocked so that a reload never
// lets one answer in place of the mock.
test.use({ serviceWorkers: "block", launchOptions: { args: ["--enable-unsafe-swiftshader"] } });

type Turn = { question: string; answer: string; pages?: string[]; at?: string };
type Saved = { id: string; title: string; turns: Turn[]; created_at: string; updated_at: string };
type Mock = {
  ask: boolean;
  providers: { id: string; label: string }[] | null;
  me: { id: string; name: string; email: string; provider: string } | null;
  conversations: Saved[];
  asks: { q: string; history: { role: string; text: string }[] }[];
  posts: Record<string, unknown>[];
  puts: { id: string; body: Record<string, unknown> }[];
  renders: string[][];
  failSave: boolean;
  /** Questions wait for this to be released (to look at the panel while an answer is on its way). */
  gate?: Promise<void>;
};

const ADA = { id: "u1", name: "Ada Lovelace", email: "ada@example.org", provider: "oidc" };
const PROVIDERS = [{ id: "oidc", label: "Authelia" }];
const answerTo = (q: string) => `Answer to "${q}": see [Alpha concept](/wiki/concepts/alpha.md).`;
const saved = (id: string, title: string, turns: Turn[]): Saved => ({ id, title, turns, created_at: "2026-11-01T10:00:00.000Z", updated_at: "2026-11-02T10:00:00.000Z" });
const newMock = (over: Partial<Mock> = {}): Mock => ({ ask: true, providers: PROVIDERS, me: ADA, conversations: [], asks: [], posts: [], puts: [], renders: [], failSave: false, ...over });

async function mockApi(page: Page, m: Mock) {
  await page.route("**/api/**", async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const body = () => (req.postData() ? JSON.parse(req.postData()!) : {});
    if (path === "/api/ask") {
      if (!m.ask) return route.fulfill({ status: 404 });
      if (method === "HEAD") return route.fulfill({ status: 204 });
      const b = body();
      m.asks.push(b);
      await m.gate;
      return json({ segments: [{ html: `<p>${answerTo(b.q).replace(/\[Alpha concept\]\([^)]*\)/, "Alpha concept")}</p>` }], md: answerTo(b.q), cited: ["concepts/alpha"], retained: [], related: [], model: "test-model" });
    }
    if (path === "/api/ask/render") {
      if (!m.ask) return route.fulfill({ status: 404 });
      m.renders.push(body().answers);
      return json({ answers: (body().answers as string[]).map((a) => ({ segments: [{ html: `<p>Rendered: ${a}</p>` }], cited: [] })) });
    }
    if (path === "/api/auth/methods") return m.providers ? json({ providers: m.providers }) : route.fulfill({ status: 404 });
    if (path.startsWith("/api/auth/login/")) return route.fulfill({ status: 200, contentType: "text/html", body: "<title>provider</title>login" });
    if (path === "/api/me") return m.me ? json(m.me) : json({ error: "not signed in" }, 401);
    if (!m.me) return json({ error: "not signed in" }, 401);
    if (path === "/api/me/state") return json({});
    if (path === "/api/conversations") {
      if (method === "POST") {
        if (m.failSave) return json({ error: "boom" }, 500);
        const b = body();
        m.posts.push(b);
        const c = saved(`n${m.conversations.length + 1}`, b.title ?? "untitled", b.turns);
        m.conversations.push(c);
        return json(c, 201);
      }
      return json({ conversations: m.conversations.map((c) => ({ id: c.id, title: c.title, exchanges: c.turns.length, created_at: c.created_at, updated_at: c.updated_at })) });
    }
    const c = path.match(/^\/api\/conversations\/(.+)$/);
    if (c) {
      const found = m.conversations.find((x) => x.id === c[1]);
      if (!found) return json({ error: "no such conversation" }, 404);
      if (method === "PUT") {
        if (m.failSave) return json({ error: "boom" }, 500);
        m.puts.push({ id: found.id, body: body() });
        found.turns = body().turns ?? found.turns;
        return json(found);
      }
      return json(found);
    }
    return route.fulfill({ status: 404 });
  });
}

const panel = (page: Page) => page.locator("#assistant-panel");
const button = (page: Page, name: string | RegExp) => panel(page).getByRole("button", { name, exact: typeof name === "string" });
const SAVE = "Save the conversation", SIGN_IN_TO_SAVE = "Sign in to save", EXPORT = "Export as Markdown", NEW = "New conversation", CLOSE = "Close the assistant";
const state = (page: Page) => panel(page).locator("[data-conversation-state]");
const field = (page: Page) => page.locator("#assistant-q");
const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });

async function open(page: Page, m: Mock, path = "/graph/") {
  await mockApi(page, m);
  await page.goto(path);
  if (path === "/account/") return;
  await expect(page.locator("#assistant-toggle")).toBeVisible();
  await page.locator("#assistant-toggle").click();
  await expect(panel(page)).toBeVisible();
}
async function ask(page: Page, q: string) {
  await field(page).fill(q);
  await field(page).press("Enter");
  await expect(panel(page).getByRole("article", { name: q })).toContainText("Answer to");
}
const read = async (download: { path: () => Promise<string> }) => readFileSync(await download.path(), "utf8");
/** The button is disabled as far as the user can tell: `aria-disabled`, which Playwright's toBeDisabled understands. */
const disabled = (b: Locator) => expect(b).toBeDisabled();

test.describe("header", () => {
  test("four square buttons in order, tooltip and accessible name identical; Save and Export disabled while nothing is answered", async ({ page }) => {
    await open(page, newMock({ me: null }));
    const group = panel(page).getByRole("group", { name: "Conversation actions" });
    const buttons = group.getByRole("button");
    await expect(buttons).toHaveCount(4);
    await expect(buttons).toHaveText(["", "", "", ""]);
    for (const [i, name] of [SIGN_IN_TO_SAVE, EXPORT, NEW, CLOSE].entries()) {
      await expect(buttons.nth(i)).toHaveAccessibleName(name);
      await expect(buttons.nth(i)).toHaveAttribute("title", name);
    }
    const style = await buttons.first().evaluate((el) => { const s = getComputedStyle(el); return { radius: s.borderTopLeftRadius, w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }; });
    expect(style.radius).toBe("0px");
    expect(style.w).toBe(style.h);
    await disabled(buttons.nth(0)); await disabled(buttons.nth(1)); await disabled(buttons.nth(2));
    await expect(buttons.nth(3)).toBeEnabled();
    // no exchange, no state beside the title
    await expect(state(page)).toBeEmpty();
    await expect(state(page)).toHaveAttribute("aria-live", "polite");
  });

  test("while an answer is on its way, Save, Export and New wait for it", async ({ page }) => {
    let release!: () => void;
    const m = newMock({ gate: new Promise<void>((r) => (release = r)) });
    await open(page, m);
    await field(page).fill("Slow one?");
    await field(page).press("Enter");
    await expect(panel(page).getByText("Reading the wiki")).toBeVisible();
    await disabled(button(page, SAVE)); await disabled(button(page, EXPORT)); await disabled(button(page, NEW));
    release();
    await expect(button(page, SAVE)).toBeEnabled();
    await expect(button(page, EXPORT)).toBeEnabled();
    await expect(button(page, NEW)).toBeEnabled();
  });

  for (const [label, providers] of [["a static site", null], ["a server with no provider", []]] as const) {
    test(`${label}: no Save, no invitation to sign in, Export works`, async ({ page }) => {
      await open(page, newMock({ me: null, providers: providers as Mock["providers"] }));
      await ask(page, "Static?");
      await expect(button(page, EXPORT)).toBeEnabled();
      await expect(panel(page).getByRole("button", { name: /Save|Sign in/ })).toHaveCount(0);
      await expect(state(page)).toBeEmpty();
    });
  }

  test("signed out with a provider: Save stays visible, says to sign in, and a click offers the providers", async ({ page }) => {
    await open(page, newMock({ me: null }));
    await ask(page, "Hello?");
    const save = button(page, SIGN_IN_TO_SAVE);
    await expect(save).toBeEnabled();
    await save.click();
    const d = dialog(page, SIGN_IN_TO_SAVE);
    await expect(d).toBeVisible();
    const login = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/auth/login/oidc");
    await d.getByRole("button", { name: "Sign in with Authelia" }).click();
    expect(new URL((await login).url()).searchParams.get("return")).toBe("/graph/");
  });

  test("the state beside the title appears with an account only: nothing to say before the first exchange", async ({ page }) => {
    await open(page, newMock({ me: null }));
    await ask(page, "Q?");
    await expect(state(page)).toBeEmpty();
  });
});

test.describe("save", () => {
  test("first save asks for a name (the first question, selected), then each save goes straight into the same copy", async ({ page }) => {
    const m = newMock();
    await open(page, m);
    await ask(page, "What   is Alpha?");
    await expect(state(page)).toHaveText("Not saved");
    await button(page, SAVE).click();
    const d = dialog(page, SAVE);
    await expect(d).toBeVisible();
    const name = d.getByRole("textbox", { name: "Conversation name" });
    await expect(name).toBeFocused();
    await expect(name).toHaveValue("What is Alpha?");
    expect(await name.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, "What is Alpha?".length]);
    await name.fill("Alpha notes");
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await expect(d).toBeHidden();
    expect(m.posts).toHaveLength(1);
    expect(m.posts[0]).toMatchObject({ title: "Alpha notes", turns: [{ question: "What   is Alpha?", answer: answerTo("What   is Alpha?"), pages: ["concepts/alpha"] }] });
    expect((m.posts[0].turns as Turn[])[0].at).toMatch(/^\d{4}-\d\d-\d\dT/);
    await expect(panel(page).locator("[data-flow-message]").filter({ hasText: "Conversation saved." })).toBeVisible();
    await expect(state(page)).toHaveText("Saved");

    await ask(page, "And Beta?");
    await expect(state(page)).toHaveText("Not saved");
    await button(page, SAVE).click();
    await expect(panel(page).locator("[data-flow-message]").filter({ hasText: "Conversation updated." })).toBeVisible();
    expect(m.puts).toHaveLength(1);
    expect(m.puts[0].id).toBe("n1");
    expect((m.puts[0].body.turns as Turn[]).map((t) => t.question)).toEqual(["What   is Alpha?", "And Beta?"]);
    expect(m.posts).toHaveLength(1); // no second copy
    await expect(state(page)).toHaveText("Saved");

    // nothing new: no request
    await button(page, SAVE).click();
    await expect(panel(page).locator("[data-flow-message]").filter({ hasText: "Already up to date." })).toBeVisible();
    expect(m.puts).toHaveLength(1);
  });

  test("a failure keeps the dialog open and says so; Escape closes the dialog and not the panel", async ({ page }) => {
    const m = newMock({ failSave: true });
    await open(page, m);
    await ask(page, "Q?");
    await button(page, SAVE).click();
    const d = dialog(page, SAVE);
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await expect(d.getByRole("alert")).toHaveText("The conversation could not be saved. Try again.");
    await expect(d).toBeVisible();
    await expect(state(page)).toHaveText("Not saved");
    m.failSave = false;
    await page.keyboard.press("Escape");
    await expect(d).toBeHidden();
    await expect(panel(page)).toBeVisible();
    await expect(button(page, SAVE)).toBeFocused();
    // and again, now it works
    await button(page, SAVE).click();
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await expect(state(page)).toHaveText("Saved");
  });

  test("a failed update says so in the panel and the state stays 'Not saved'", async ({ page }) => {
    const m = newMock();
    await open(page, m);
    await ask(page, "One?");
    await button(page, SAVE).click();
    await dialog(page, SAVE).getByRole("button", { name: "Save", exact: true }).click();
    await expect(state(page)).toHaveText("Saved");
    await ask(page, "Two?");
    m.failSave = true;
    await button(page, SAVE).click();
    await expect(panel(page).locator("[data-flow-message]").filter({ hasText: "The conversation could not be saved. Try again." })).toBeVisible();
    await expect(state(page)).toHaveText("Not saved");
  });

  test("the conversation survives closing the panel, navigating and reloading, and so does its link to the saved copy", async ({ page }) => {
    const m = newMock();
    await open(page, m);
    await ask(page, "Keep me?");
    await button(page, SAVE).click();
    await dialog(page, SAVE).getByRole("button", { name: "Save", exact: true }).click();
    await expect(state(page)).toHaveText("Saved");
    await button(page, CLOSE).click();
    await expect(panel(page)).toBeHidden();
    // narrow header: the links are inside the "Menu" disclosure
    const menu = page.locator("nav.site-nav").getByRole("button", { name: /Menu/ });
    if (await menu.isVisible()) await menu.click();
    await page.locator("nav.site-nav").getByRole("link", { name: /Tags|Étiquettes/ }).click();
    await page.waitForURL(/\/tags\//);
    await page.locator("#assistant-toggle").click();
    await expect(panel(page).getByRole("article", { name: "Keep me?" })).toBeVisible();
    await page.reload();
    await expect(panel(page).getByRole("article", { name: "Keep me?" })).toBeVisible();
    await expect(state(page)).toHaveText("Saved");
    await ask(page, "More?");
    await button(page, SAVE).click();
    await expect.poll(() => m.puts.length).toBe(1); // updated, not a second copy
    expect(m.posts).toHaveLength(1);
  });
});

test.describe("export", () => {
  test("without an account: the file has the front matter, the questions, absolute links and the sources", async ({ page }) => {
    const m = newMock({ me: null, providers: null });
    await open(page, m);
    await ask(page, 'Quoted "title", right?');
    await ask(page, "Second?");
    const [dl] = await Promise.all([page.waitForEvent("download"), button(page, EXPORT).click()]);
    expect(dl.suggestedFilename()).toBe("quoted-title-right.md");
    const md = await read(dl);
    const site = new URL(page.url()).origin + "/";
    expect(md).toMatch(new RegExp(`^---\\ntitle: "Quoted \\\\"title\\\\", right\\?"\\ndate: \\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z\\nupdated: \\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z\\nsource: Cortex\\nwiki: ${site.replace(/[.]/g, "\\.")}\\nexchanges: 2\\n---\\n\\n# Quoted "title", right\\?\\n\\n## Quoted "title", right\\?\\n\\n`));
    expect(md).toContain(`Answer to "Quoted "title", right?": see [Alpha concept](${site}wiki/concepts/alpha/).`);
    expect(md).toContain("## Second?");
    expect(md).toContain(`## Sources\n\n- [Alpha concept](${site}wiki/concepts/alpha/) (\`concepts/alpha\`)\n`);
    expect(md.match(/concepts\/alpha`/g)).toHaveLength(1); // cited by both answers, listed once
    await expect(panel(page).locator("[data-flow-message]").filter({ hasText: "Conversation exported." })).toBeVisible();
  });
});

test.describe("new conversation", () => {
  test("not saved, signed in: three choices. Cancel keeps it, 'New conversation' drops it, 'Save and start over' saves first", async ({ page }) => {
    const m = newMock();
    await open(page, m);
    await ask(page, "Keep?");
    await button(page, NEW).click();
    const d = dialog(page, "Start a new conversation?");
    await expect(d).toContainText("not saved");
    await expect(d.getByRole("button")).toHaveText(["Cancel", "New conversation", "Save and start over"]);
    await expect(d.getByRole("button", { name: "Cancel" })).toBeFocused();
    await d.getByRole("button", { name: "Cancel" }).click();
    await expect(panel(page).getByRole("article", { name: "Keep?" })).toBeVisible();

    await button(page, NEW).click();
    await d.getByRole("button", { name: "Save and start over" }).click();
    const name = dialog(page, SAVE);
    await expect(name).toBeVisible();
    // a failed save does not start over
    m.failSave = true;
    await name.getByRole("button", { name: "Save", exact: true }).click();
    await expect(name.getByRole("alert")).toBeVisible();
    await expect(panel(page).getByRole("article", { name: "Keep?" })).toBeVisible();
    m.failSave = false;
    await name.getByRole("button", { name: "Save", exact: true }).click();
    await expect(panel(page).getByRole("article")).toHaveCount(0);
    expect(m.posts).toHaveLength(1);
    await expect(field(page)).toBeFocused();
    await expect(state(page)).toBeEmpty();

    // the next conversation is a new copy, and 'New conversation' in the dialog drops what is not saved
    await ask(page, "Again?");
    await button(page, NEW).click();
    await d.getByRole("button", { name: "New conversation" }).click();
    await expect(panel(page).getByRole("article")).toHaveCount(0);
    await expect(field(page)).toBeFocused();
    expect(m.posts).toHaveLength(1);
  });

  test("already saved: starts over at once, no question", async ({ page }) => {
    const m = newMock();
    await open(page, m);
    await ask(page, "Saved one?");
    await button(page, SAVE).click();
    await dialog(page, SAVE).getByRole("button", { name: "Save", exact: true }).click();
    await expect(state(page)).toHaveText("Saved");
    await button(page, NEW).click();
    await expect(page.getByRole("dialog", { name: "Start a new conversation?" })).toBeHidden();
    await expect(panel(page).getByRole("article")).toHaveCount(0);
    await expect(field(page)).toBeFocused();
    await expect(button(page, NEW)).toHaveAttribute("aria-disabled", "true");
  });

  test("signed out with exchanges: the conversation would be lost, 'Export and start over' keeps a copy", async ({ page }) => {
    const m = newMock({ me: null, providers: null });
    await open(page, m);
    await ask(page, "Lost?");
    await button(page, NEW).click();
    const d = dialog(page, "Start a new conversation?");
    await expect(d).toContainText("will be lost");
    await expect(d.getByRole("button")).toHaveText(["Cancel", "New conversation", "Export and start over"]);
    const [dl] = await Promise.all([page.waitForEvent("download"), d.getByRole("button", { name: "Export and start over" }).click()]);
    expect(await read(dl)).toContain("## Lost?");
    await expect(panel(page).getByRole("article")).toHaveCount(0);
    await expect(field(page)).toBeFocused();
  });
});

test.describe("account page", () => {
  const CONV = saved("c1", "Alpha question", [
    { question: "First?", answer: "Because **alpha**.", pages: ["concepts/alpha"], at: "2026-11-01T10:00:00.000Z" },
    { question: "Second?", answer: "Because beta, see [Beta](/wiki/concepts/beta.md).", pages: ["concepts/alpha", "concepts/beta"], at: "2026-11-01T10:05:00.000Z" },
  ]);
  const resume = (page: Page) => page.getByRole("button", { name: "Resume the conversation « Alpha question »" });

  test("Resume opens the panel on the same page with the exchanges; the next question goes into the same saved copy", async ({ page }) => {
    const m = newMock({ conversations: [CONV] });
    await open(page, m, "/account/");
    await expect(panel(page)).toBeHidden();
    await expect(resume(page)).not.toHaveAttribute("aria-disabled", "true");
    await resume(page).click();
    await expect(panel(page)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/account/");
    expect(m.renders).toEqual([["Because **alpha**.", "Because beta, see [Beta](/wiki/concepts/beta.md)."]]);
    await expect(panel(page).getByRole("article", { name: "First?" })).toContainText("Rendered: Because **alpha**.");
    await expect(panel(page).getByRole("article", { name: "Second?" })).toBeVisible();
    await expect(panel(page).getByRole("link", { name: "Alpha concept" }).first()).toBeVisible(); // the pages cited, under the answer
    await expect(panel(page).locator("[data-flow-message]").filter({ hasText: "Conversation “Alpha question” resumed." })).toBeVisible();
    await expect(state(page)).toHaveText("Saved");
    await expect(field(page)).toBeFocused();

    // the history the agent gets is the resumed conversation, Markdown as written
    await ask(page, "Third?");
    expect(m.asks[0].history).toEqual([
      { role: "user", text: "First?" }, { role: "assistant", text: "Because **alpha**." },
      { role: "user", text: "Second?" }, { role: "assistant", text: "Because beta, see [Beta](/wiki/concepts/beta.md)." },
    ]);
    await expect(state(page)).toHaveText("Not saved");
    await button(page, SAVE).click();
    await expect(panel(page).locator("[data-flow-message]").filter({ hasText: "Conversation updated." })).toBeVisible();
    expect(m.puts).toHaveLength(1);
    expect(m.puts[0].id).toBe("c1");
    expect((m.puts[0].body.turns as Turn[]).map((t) => t.question)).toEqual(["First?", "Second?", "Third?"]);
    expect(m.posts).toHaveLength(0);
  });

  test("resuming over a conversation that is not saved asks first: Cancel keeps it, 'Save and resume' saves it, then replaces it", async ({ page }) => {
    const m = newMock({ conversations: [CONV] });
    await open(page, m, "/account/");
    await page.locator("#assistant-toggle").click();
    await ask(page, "Current one?");
    await button(page, CLOSE).click();
    await resume(page).click();
    const d = dialog(page, "Resume this conversation?");
    await expect(d).toBeVisible();
    await expect(d).toContainText("replaced by “Alpha question”");
    await expect(d.getByRole("button")).toHaveText(["Cancel", "Resume without saving", "Save and resume"]);
    await d.getByRole("button", { name: "Cancel" }).click();
    await expect(panel(page)).toBeHidden();

    await page.locator("#assistant-toggle").click();
    await expect(panel(page).getByRole("article", { name: "Current one?" })).toBeVisible();
    await button(page, CLOSE).click();
    await resume(page).click();
    await d.getByRole("button", { name: "Save and resume" }).click();
    await dialog(page, SAVE).getByRole("button", { name: "Save", exact: true }).click();
    await expect(panel(page).getByRole("article", { name: "First?" })).toBeVisible();
    await expect(panel(page).getByRole("article", { name: "Current one?" })).toHaveCount(0);
    expect(m.posts).toHaveLength(1);
    expect(m.posts[0]).toMatchObject({ turns: [{ question: "Current one?" }] });
    await expect(state(page)).toHaveText("Saved");
  });

  test("Export downloads the saved conversation as Markdown, the dates and the title of the account", async ({ page }) => {
    await open(page, newMock({ conversations: [CONV] }), "/account/");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export the conversation « Alpha question » as Markdown" }).click()]);
    expect(dl.suggestedFilename()).toBe("alpha-question.md");
    const md = await read(dl);
    const site = new URL(page.url()).origin + "/";
    expect(md).toContain('title: "Alpha question"\ndate: 2026-11-01T10:00:00.000Z\nupdated: 2026-11-02T10:00:00.000Z\nsource: Cortex\n');
    expect(md).toContain("exchanges: 2");
    expect(md).toContain("## First?\n\nBecause **alpha**.\n");
    expect(md).toContain(`Because beta, see [Beta](${site}wiki/concepts/beta/).`);
    expect(md).toContain(`- [Alpha concept](${site}wiki/concepts/alpha/) (\`concepts/alpha\`)\n- [Beta concept](${site}wiki/concepts/beta/) (\`concepts/beta\`)`);
  });

  test("on a server that cannot answer questions, Resume is inert and Export still works", async ({ page }) => {
    await open(page, newMock({ ask: false, conversations: [CONV] }), "/account/");
    await expect(resume(page)).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("button", { name: "Export the conversation « Alpha question » as Markdown" })).not.toHaveAttribute("aria-disabled", "true");
  });
});
