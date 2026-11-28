import type { Page } from "@playwright/test";
import { expect, test } from "./helpers";

// "Compile the queue", the entry of the account menu of a `cortex serve` site (a signed-in member of the space). There is no server here:
// the answers of /api/compile are mocks. Service workers are blocked so that a reload never lets one answer in place of the mock.
test.use({ serviceWorkers: "block" });

type Status = { running: boolean; pending: number; done: number; failed: number; current?: { id: string; title: string }; lastError?: string };

/** `reads` is what the next GETs answer, one by one (the last one stays); every POST is recorded and answers 202 with `started`, or `post` when given. */
async function mock(page: Page, opts: { get: number; reads?: Status[]; started?: Status; post?: { status: number; error: string } }) {
  const posts: { origin: string | undefined }[] = [], reads = [...(opts.reads ?? [])];
  await page.route("**/api/**", (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/auth/methods") return json({ providers: [{ id: "oidc", label: "Authelia" }] });
    if (path === "/api/me") return json({ id: "u1", name: "Ada Lovelace", email: "ada@example.org", provider: "oidc" });
    if (path === "/api/compile" && req.method() === "POST") {
      posts.push({ origin: req.headers().origin });
      return opts.post ? json({ error: opts.post.error }, opts.post.status) : json(opts.started, 202);
    }
    if (path === "/api/compile") return opts.get === 200 ? json(reads.length > 1 ? reads.shift() : reads[0]) : json({ error: "no" }, opts.get);
    return json({}, 404);
  });
  return { posts };
}
const trigger = (page: Page) => page.locator("[data-prefs-trigger]");
const entry = (page: Page, count?: number) => page.getByRole("menuitem", { name: new RegExp(`^(Compile the queue|Compiler la file d'attente) \\(${count ?? "\\d+"}\\)$|^(Compiling…|Compilation en cours…)$`) });

test("the menu offers the queue with its count; a click starts the compile, shows it running, then tells how it went", async ({ page }) => {
  const idle: Status = { running: false, pending: 3, done: 0, failed: 0 };
  const { posts } = await mock(page, {
    get: 200, reads: [idle, idle, { running: false, pending: 1, done: 2, failed: 1, lastError: "a2-bad: compile exited with code 1" }],
    started: { running: true, pending: 3, done: 0, failed: 0, current: { id: "a1", title: "Premier document" } },
  });
  await page.goto("/search/");
  await expect(trigger(page)).toHaveAccessibleName("Account: Ada Lovelace");
  await trigger(page).click();
  await expect(entry(page, 3)).toBeVisible();
  await expect(entry(page, 3)).not.toHaveAttribute("aria-disabled", "true");
  await entry(page, 3).click(); // the menu closes: the progress is told under the header
  expect(posts).toEqual([{ origin: new URL(page.url()).origin }]);
  const notice = page.locator("[data-compile-notice]");
  await expect(notice).toHaveAttribute("data-compile-notice", "running");
  await expect(notice).toContainText("Premier document");
  await trigger(page).click();
  await expect(entry(page)).toHaveAttribute("aria-disabled", "true"); // not again while it runs
  await page.keyboard.press("Escape");
  // the next read (every 3 s) says it ended: 2 compiled, 1 failed, with what went wrong
  await expect(notice).toHaveAttribute("data-compile-notice", "done", { timeout: 10_000 });
  await expect(notice).toContainText(/2 compiled, 1 failed|2 compilée\(s\), 1 en échec/);
  await expect(notice).toContainText("a2-bad");
  await expect(page.getByRole("status").filter({ hasText: /2 compiled, 1 failed|2 compilée\(s\), 1 en échec/ })).toHaveCount(1); // read out by the live region
  await trigger(page).click();
  await expect(entry(page, 1)).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await notice.getByRole("button", { name: /^(Close this message|Fermer ce message)$/ }).click();
  await expect(notice).toHaveCount(0);
});

test("with nothing pending the entry is disabled; where the server does not say the visitor may (403, a static site: 404) there is no entry", async ({ page }) => {
  await mock(page, { get: 200, reads: [{ running: false, pending: 0, done: 0, failed: 0 }] });
  await page.goto("/search/");
  await trigger(page).click();
  await expect(entry(page, 0)).toHaveAttribute("aria-disabled", "true");
  for (const get of [403, 404]) {
    await page.unrouteAll();
    await mock(page, { get });
    const probed = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/compile");
    await page.goto("/search/");
    await probed; // asked, and told no
    await expect(trigger(page)).toHaveAccessibleName("Account: Ada Lovelace");
    await trigger(page).click();
    await expect(page.getByRole("menuitem", { name: /^(Sign out|Se déconnecter)$/ })).toBeVisible();
    await expect(entry(page)).toHaveCount(0);
  }
});
