import type { Page, Route } from "@playwright/test";
import { expect, test } from "./helpers";

// The Add page (a note): the toolbar, the preview, a .md file import, the draft kept in the browser and the request the form sends. There is no
// `cortex serve` here: the static export (served at the root) is mapped under `/s/demo/`, as a multi-space server mounts a space's site, and the
// API answers are mocks. Service workers are blocked so that a reload never lets one answer in place of the mock.
test.use({ serviceWorkers: "block" });

type Share = { type: string; body: string };
/** Maps the static export under `/s/demo/` (a space that holds `content`) and mocks its API; every share request and every preview is recorded. */
async function mount(page: Page, content: ("notes" | "resources")[]) {
  const origin = new URL(test.info().project.use.baseURL ?? process.env.CORTEX_UI_BASE!).origin;
  const shares: Share[] = [], previews: string[] = [];
  await page.route("**/*", async (route: Route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (url.origin !== origin) return route.continue();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/auth/methods") return json({ providers: [{ id: "oidc", label: "Authelia" }] });
    if (path === "/api/me") return json({ id: "u1", name: "Ada Lovelace", email: "ada@example.org", provider: "oidc" });
    if (path === "/api/spaces") return json({ spaces: [{ name: "demo", title: null, read_only: false, content }], canCreate: false, default: "demo" });
    if (path === "/s/demo/share/api") { shares.push({ type: req.headers()["content-type"] ?? "", body: req.postDataBuffer()?.toString("utf8") ?? "" }); return json({ paths: ["inbox/partage-x.md"] }); }
    if (path === "/s/demo/api/markdown") { previews.push(JSON.parse(req.postData() ?? "{}").md); return json({ html: "<h1>Rendu</h1><p>par le serveur</p>" }); }
    if (/^(\/s\/demo)?\/api\//.test(path)) return json({}, 404);
    const stat = path.match(/^\/s\/demo(\/.*)$/);
    if (!stat) return route.continue();
    const response = await route.fetch({ url: origin + stat[1] + url.search }).catch(() => undefined);
    if (response) await route.fulfill({ response }).catch(() => {});
  });
  return { shares, previews, json: () => shares.map((s) => JSON.parse(s.body)) };
}

test("Add > Note: toolbar, preview, import and draft; the share request carries { title, text, note, as: note }", async ({ page }) => {
  const { shares, previews, json } = await mount(page, ["notes", "resources"]);
  await page.goto("/s/demo/add/");
  const note = page.getByRole("tabpanel", { name: "Note" }); // the Resource tab has a field of the same name, hidden
  const title = note.getByLabel(/^(Title|Titre)$/), body = note.getByLabel(/^(Text|Texte)$/), why = note.getByLabel(/^(Why I keep it|Pourquoi je la garde)/);
  const button = (name: RegExp) => page.getByRole("button", { name });
  await expect(title).toBeVisible();
  await expect(page.locator('header nav a[href$="/add/"]')).toHaveCount(1); // the navigation offers it to a signed-in visitor (in the "Menu" panel on a narrow screen)

  // the toolbar wraps the selection
  await body.fill("un mot");
  await body.press("Control+A");
  await button(/^(Bold|Gras)$/).click();
  await expect(body).toHaveValue("**un mot**");

  // a .md file fills the body, its first # heading becomes the title and leaves the body
  await note.locator('input[type="file"]').setInputFiles({ name: "idee.md", mimeType: "text/markdown", buffer: Buffer.from("# Titre importé\n\nCorps **importé**, avec un [lien](https://example.org).\n") });
  await expect(title).toHaveValue("Titre importé");
  await expect(body).toHaveValue("Corps **importé**, avec un [lien](https://example.org).\n");

  // the preview is the server's rendering of the title and the text
  await button(/^(Preview|Aperçu)$/).click();
  await expect(button(/^(Preview|Aperçu)$/)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Rendu" })).toBeVisible();
  expect(previews).toEqual(["# Titre importé\n\nCorps **importé**, avec un [lien](https://example.org).\n"]);
  await button(/^(Write|Écrire)$/).click();
  await expect(body).toBeVisible();

  await why.fill("pour la veille");
  // the draft survives a reload
  await page.reload();
  await expect(title).toHaveValue("Titre importé");
  await expect(why).toHaveValue("pour la veille");

  await button(/^(Add the note|Ajouter la note)$/).click();
  await expect(page.getByText(/^(Added: the note is pending compilation\.|Ajoutée : la note attend sa compilation\.)$/)).toBeVisible();
  expect(json()).toEqual([{ title: "Titre importé", text: "Corps **importé**, avec un [lien](https://example.org).\n", note: "pour la veille", as: "note" }]);
  await expect(title).toHaveValue("");
  await expect(body).toHaveValue("");
  await page.reload(); // sent: the draft is gone
  await expect(title).toHaveValue("");
});

test("Add > Resource: a link is sent as JSON like the extension does, files as one multipart request with the note and as", async ({ page }) => {
  const { shares, json } = await mount(page, ["notes", "resources"]);
  await page.goto("/s/demo/add/");
  await page.getByRole("tab", { name: /^(Resource|Ressource)$/ }).click();
  const panel = page.getByRole("tabpanel", { name: /^(Resource|Ressource)$/ });
  const submit = panel.getByRole("button", { name: /^(Add the resource|Ajouter la ressource)$/ });
  await expect(panel).toBeVisible();

  await submit.click(); // nothing given
  await expect(panel.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(1);
  expect(shares).toEqual([]);

  await panel.getByLabel(/^(Link|Lien)$/).fill("https://example.org/article");
  await panel.getByLabel(/^(Why I keep it|Pourquoi je la garde)/).fill("pour la veille");
  await submit.click();
  await expect(panel.getByText(/^(Link added|Lien ajouté)/)).toBeVisible();
  expect(shares[0]!.type).toContain("application/json");
  expect(json()).toEqual([{ url: "https://example.org/article", note: "pour la veille", as: "resource" }]);

  await panel.locator('input[type="file"]').setInputFiles([
    { name: "rapport.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 x") },
    { name: "idee.md", mimeType: "text/markdown", buffer: Buffer.from("# Idée\n\nTexte") },
  ]);
  await expect(panel.getByText("rapport.pdf")).toBeVisible();
  await panel.getByRole("button", { name: /(Remove|Retirer) idee\.md/ }).click();
  await panel.getByLabel(/^(Why I keep it|Pourquoi je la garde)/).fill("à lire");
  await submit.click();
  await expect(panel.getByText(/^(1 file added|1 fichier ajouté)/)).toBeVisible();
  expect(shares[1]!.type).toContain("multipart/form-data");
  const form = shares[1]!.body;
  expect(form).toContain('name="as"\r\n\r\nresource');
  expect(form).toContain('name="note"\r\n\r\nà lire');
  expect(form).toContain('name="file"; filename="rapport.pdf"');
  expect(form).not.toContain("idee.md"); // removed from the list before sending
  expect(shares).toHaveLength(2);
  await expect(panel.getByText("rapport.pdf")).toHaveCount(0); // sent: the list is empty
});

test("Add: a space that holds resources only offers the Resource tab alone", async ({ page }) => {
  await mount(page, ["resources"]);
  await page.goto("/s/demo/add/");
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.getByRole("tab", { name: /^(Resource|Ressource)$/ })).toBeVisible();
  await expect(page.getByLabel(/^(Link|Lien)$/)).toBeVisible();
  await expect(page.locator('header nav a[href$="/add/"]')).toHaveCount(1);
});
