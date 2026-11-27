import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountsFile, addSpaceMember, createSession, getSpace, memberRole, openAccounts, randomToken, setSpace, sha256, spaceMembers, upsertUser, type Role } from "./accounts";
import { serve } from "./serve";

// `cortex serve` on a multi-space instance: /s/<space>/ routing, who may see a space, and creating one from the site.
// The site is not built for real: a small script stands for `cortex export --out` and writes what it was told (the space, the base path).
const dir = mkdtempSync(join(tmpdir(), "cortex-fake-export-"));
const script = join(dir, "export.ts");
writeFileSync(script, `
import { mkdirSync, writeFileSync } from "node:fs";
const [out] = Bun.argv.slice(2);
if ((process.env.CORTEX_ROOT ?? "").endsWith("boom")) { console.error("boom"); process.exit(1); }
mkdirSync(out, { recursive: true });
writeFileSync(out + "/index.html", (process.env.CORTEX_ROOT ?? "").split("/").at(-1) + "|" + (process.env.CORTEX_SITE_BASE ?? ""));
writeFileSync(out + "/service-worker.js", "// sw of " + (process.env.CORTEX_SITE_BASE ?? ""));
`);
const exportCmd = (_: string, out: string) => [process.execPath, script, out];

const AUTH = { auth: { public_urls: ["http://localhost"], github: { client_id: "x", allow: [1] } } };
/** An entry of GET /api/spaces for a space with no title and not read-only. */
const plain = (name: string) => ({ name, title: null, read_only: false });
const ANYONE = { ...AUTH, site_spaces: { create: "anyone" } };
const SECRET = "CORTEX_GITHUB_CLIENT_SECRET";
let saved: string | undefined;
beforeAll(() => { saved = process.env[SECRET]; process.env[SECRET] = "s"; });
afterAll(() => { if (saved === undefined) delete process.env[SECRET]; else process.env[SECRET] = saved; });

const instance = (spaces: string[], config: object = {}) => {
  const root = mkdtempSync(join(tmpdir(), "cortex-spaces-serve-"));
  writeFileSync(join(root, "cortex.json"), JSON.stringify(config));
  for (const n of spaces) mkdirSync(join(root, "spaces", n, "wiki"), { recursive: true });
  return root;
};
/** A signed-in person: a user and a session straight in the accounts database (the sign-in itself is account.test.ts). */
const person = (root: string, sub: string) => {
  const db = openAccounts(accountsFile(root)), now = Date.now(), user = upsertUser(db, "github", sub, sub, null, now), token = randomToken();
  createSession(db, user.id, sha256(token), now, 86_400_000);
  db.close();
  return { id: user.id, cookie: { cookie: `cortex_session=${token}` } };
};
const members = (root: string, space: string) => { const db = openAccounts(accountsFile(root)); try { return spaceMembers(db, space).map((m) => m.id); } finally { db.close(); } };
/** Makes `userId` a member of `space`, which becomes private (what `cortex space set --visibility private` and `member add` do). */
const hold = (root: string, space: string, userId: string, role: Role = "owner") => { const db = openAccounts(accountsFile(root)); setSpace(db, space, { visibility: "private" }); addSpaceMember(db, space, userId, role); db.close(); };

const servers: { stop(force?: boolean): unknown }[] = [];
afterEach(() => { servers.splice(0).forEach((s) => s.stop(true)); });
const start = async (root: string, sync = false) => {
  const said: string[] = [];
  const server = await serve(root, { port: 0, sync, reviewer: "t", say: (m) => said.push(m), exportCmd, settleMs: 5, embeddings: async () => undefined });
  servers.push(server);
  const origin = `http://localhost:${server.port}`;
  const get = (path: string, headers: Record<string, string> = {}) => fetch(origin + path, { redirect: "manual", headers });
  const post = (path: string, body: unknown, headers: Record<string, string> = { origin }) => fetch(origin + path, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = { origin }) => fetch(origin + path, { method, redirect: "manual", headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { server, said, origin, get, post, send };
};

test("a legacy instance is served as before: the site at the root, no /s/, no /api/spaces", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-legacy-serve-"));
  writeFileSync(join(root, "cortex.json"), "{}");
  mkdirSync(join(root, "wiki"), { recursive: true });
  const { get } = await start(root);
  expect(await (await get("/")).text()).toEndWith("|"); // no base path
  expect((await get("/s/wiki/")).status).toBe(404);
  expect((await get("/api/spaces")).status).toBe(404);
  expect((await get("/api/status")).status).toBe(200);
});

test("multi-space: each space under /s/<name>/ with its own base path and APIs, / leads to the default one", async () => {
  const root = instance(["a", "b"], { default_space: "b" });
  const { get, said } = await start(root);
  expect(await (await get("/s/a/")).text()).toBe("a|/s/a");
  expect(await (await get("/s/b/")).text()).toBe("b|/s/b");
  expect(existsSync(join(root, "spaces/a/.cortex/serve/a/index.html"))).toBe(true); // its builds are its own
  const home = await get("/");
  expect(home.status).toBe(302);
  expect(home.headers.get("location")).toBe("/s/b/");
  const bare = await get("/s/a?x=1");
  expect([bare.status, bare.headers.get("location")]).toEqual([302, "/s/a/?x=1"]);
  expect((await get("/s/nope/")).status).toBe(404);
  expect((await get("/s/a/wiki/missing/")).status).toBe(404);
  expect((await (await get("/s/a/api/status")).json()).building).toBe(false); // the space's own API
  expect((await get("/api/status")).status).toBe(404); // not at the root: the root holds the instance's routes
  expect(said.some((m) => m.includes("2 spaces: a, b"))).toBe(true);
  const spaces = await (await get("/api/spaces")).json();
  expect(spaces).toEqual({ spaces: [plain("a"), plain("b")], canCreate: false, default: "b" });
  // without default_space, the first
  const other = await start(instance(["x", "y"]));
  expect((await other.get("/")).headers.get("location")).toBe("/s/x/");
});

test("a broken first build of one space does not stop the others", async () => {
  const root = instance(["boom", "ok"]);
  const { get, said } = await start(root);
  expect((await get("/s/boom/")).status).toBe(404);
  expect(await (await get("/s/ok/")).text()).toBe("ok|/s/ok");
  expect(said.some((m) => m.startsWith("space boom:"))).toBe(true);
});

test("a private space is for its members alone: files, APIs and the listing answer 404 to anyone else; an open one is for everybody", async () => {
  const root = instance(["open", "priv"], { default_space: "priv", ...AUTH });
  const ada = person(root, "1"), bob = person(root, "2");
  hold(root, "priv", ada.id);
  const { get } = await start(root);
  const list = async (h?: Record<string, string>) => ((await (await get("/api/spaces", h)).json()) as { spaces: { name: string }[] }).spaces.map((s) => s.name);
  for (const who of [undefined, bob.cookie]) {
    expect((await get("/s/priv/", who)).status).toBe(404);
    expect((await get("/s/priv/api/status", who)).status).toBe(404);
    expect((await get("/s/priv/api/verify", who)).status).toBe(404);
    expect(await list(who)).toEqual(["open"]);
    expect((await get("/", who)).headers.get("location")).toBe("/s/open/"); // the default space is hidden: the first one visible
    expect((await get("/s/open/", who)).status).toBe(200);
  }
  // the same answer as a space that does not exist: nothing tells it is there
  expect(await (await get("/s/priv/")).text()).toBe(await (await get("/s/ghost/")).text());
  expect(await (await get("/s/priv/", { cookie: "cortex_session=forged" })).text()).toBe("Not found");
  expect(await (await get("/s/priv/", ada.cookie)).text()).toBe("priv|/s/priv");
  expect(await list(ada.cookie)).toEqual(["open", "priv"]);
  expect((await get("/", ada.cookie)).headers.get("location")).toBe("/s/priv/");
  expect(await (await get("/api/spaces", ada.cookie)).json()).toMatchObject({ canCreate: true, default: "priv" });
  expect(await (await get("/api/spaces", bob.cookie)).json()).toMatchObject({ canCreate: false, default: "open" }); // creating is for owners
  expect(await (await get("/api/spaces")).json()).toMatchObject({ canCreate: false });
});

test("without sign-in configured an open space stays open, a private one is hidden (nobody can be its member), and none can be created", async () => {
  const root = instance(["priv", "open"]);
  hold(root, "priv", "someone");
  const db = openAccounts(accountsFile(root)); addSpaceMember(db, "open", "someone", "owner"); db.close(); // members do not make a space private
  const { get, post, origin } = await start(root);
  expect(await (await get("/s/open/")).text()).toBe("open|/s/open");
  expect((await get("/s/priv/")).status).toBe(404);
  expect(((await (await get("/api/spaces")).json()) as { spaces: unknown[] }).spaces).toEqual([plain("open")]);
  expect((await post("/api/spaces", { name: "new" })).status).toBe(403);
  expect(existsSync(join(root, "spaces/new"))).toBe(false);
  expect((await post("/api/spaces", { name: "new" }, { origin })).status).toBe(403);
});

test("a private space never becomes open by losing its member rows; a broken store hides every space", async () => {
  const root = instance(["priv", "open"], AUTH);
  const ada = person(root, "1");
  hold(root, "priv", ada.id);
  const { get } = await start(root);
  expect((await get("/s/priv/", ada.cookie)).status).toBe(200);
  const db = openAccounts(accountsFile(root));
  db.run("delete from space_members"); // however the rows went (a manual edit, a bug): the space stays private
  expect(getSpace(db, "priv")?.visibility).toBe("private");
  expect((await get("/s/priv/", ada.cookie)).status).toBe(404);
  expect((await get("/s/priv/")).status).toBe(404);
  expect((await get("/s/open/")).status).toBe(200);
  db.run("drop table spaces"); // the store fails: closed for everyone, the open space too
  expect((await get("/s/open/")).status).toBe(404);
  expect((await get("/s/priv/", ada.cookie)).status).toBe(404);
  expect(((await (await get("/api/spaces", ada.cookie)).json()) as { spaces: unknown[] }).spaces).toEqual([]);
  db.close();
});

test("POST /api/spaces: same origin, signed in, a valid new name; the creator is its only member and sees it built", async () => {
  const root = instance(["first"], ANYONE);
  const ada = person(root, "1"), bob = person(root, "2");
  const { get, post, origin } = await start(root);
  const create = (name: unknown, h: Record<string, string> = { origin, ...ada.cookie }) => post("/api/spaces", { name }, h);
  expect((await post("/api/spaces", { name: "mine" }, ada.cookie)).status).toBe(403); // no Origin: a script, not the site
  expect((await create("mine", { origin: "https://evil.example", ...ada.cookie })).status).toBe(403);
  expect((await create("mine", { origin })).status).toBe(401); // not signed in
  expect((await create("mine", { origin, cookie: "cortex_session=forged" })).status).toBe(401);
  expect((await fetch(`${origin}/api/spaces`, { method: "PUT", headers: { origin, ...ada.cookie } })).status).toBe(405);
  for (const bad of ["", "A", "a b", "-a", "a/b", "..", "x".repeat(41), 3, undefined]) expect((await create(bad)).status).toBe(400);
  expect((await create("first")).status).toBe(409); // exists
  expect(existsSync(join(root, "spaces/mine"))).toBe(false); // nothing was created by the refused ones

  const ok = await create("mine");
  expect(ok.status).toBe(201);
  expect(await ok.json()).toEqual({ name: "mine", url: "/s/mine/" });
  expect(existsSync(join(root, "spaces/mine/wiki/index.md"))).toBe(true); // the same empty space `cortex space add` makes
  expect(existsSync(join(root, "spaces/mine/raw/.gitkeep"))).toBe(true);
  expect(members(root, "mine")).toEqual([ada.id]);
  const row = openAccounts(accountsFile(root)); // private, and its creator owns it
  expect([getSpace(row, "mine")?.visibility, spaceMembers(row, "mine").map((m) => m.role)]).toEqual(["private", ["owner"]]);
  row.close();
  expect(await (await get("/s/mine/", ada.cookie)).text()).toBe("mine|/s/mine"); // built, and served
  expect((await get("/s/mine/", bob.cookie)).status).toBe(404); // private by default
  expect((await get("/s/mine/")).status).toBe(404);
  expect(await (await get("/s/first/")).text()).toBe("first|/s/first"); // the others stay open
  expect((await create("mine")).status).toBe(409);
  expect(((await (await get("/api/spaces", ada.cookie)).json()) as { spaces: unknown[] }).spaces).toEqual([plain("first"), plain("mine")]);
  expect(((await (await get("/api/spaces", bob.cookie)).json()) as { spaces: unknown[] }).spaces).toEqual([plain("first")]);
});

test("POST /api/spaces is for the owners of a space unless site_spaces.create is \"anyone\"; the listing says who can", async () => {
  const root = instance(["first"], AUTH);
  const ada = person(root, "1"), bob = person(root, "2");
  hold(root, "first", ada.id); hold(root, "first", bob.id, "member");
  const { get, post, origin } = await start(root);
  const create = (who: { cookie: Record<string, string> }) => post("/api/spaces", { name: "mine" }, { origin, ...who.cookie });
  expect((await create(bob)).status).toBe(403); // a member is not an owner
  expect(await (await get("/api/spaces", bob.cookie)).json()).toMatchObject({ canCreate: false });
  expect(existsSync(join(root, "spaces/mine"))).toBe(false);
  expect(await (await get("/api/spaces", ada.cookie)).json()).toMatchObject({ canCreate: true });
  expect((await create(ada)).status).toBe(201);
  expect(existsSync(join(root, "spaces/mine"))).toBe(true);
  // the other value: anyone signed in
  const open = instance(["first"], ANYONE), eve = person(open, "3"), s2 = await start(open);
  expect(await (await s2.get("/api/spaces", eve.cookie)).json()).toMatchObject({ canCreate: true });
  expect((await s2.post("/api/spaces", { name: "eves" }, { origin: s2.origin, ...eve.cookie })).status).toBe(201);
});

test("POST /api/spaces with schema: \"notes\" records it and writes the space's agent file; any other schema is a 400", async () => {
  const root = instance(["first"], ANYONE);
  const ada = person(root, "1");
  const { post, origin } = await start(root);
  const create = (body: object) => post("/api/spaces", body, { origin, ...ada.cookie });
  for (const schema of ["../../etc/passwd", "schemas/x.md", "veille", "", 3, true]) expect((await create({ name: "mine", schema })).status).toBe(400);
  expect(existsSync(join(root, "spaces/mine"))).toBe(false);
  expect((await create({ name: "mine", schema: "notes" })).status).toBe(201);
  expect(JSON.parse(readFileSync(join(root, "cortex.json"), "utf8")).spaces).toEqual({ mine: { schema: "notes" } });
  expect(readFileSync(join(root, "spaces/mine/CLAUDE.md"), "utf8")).toContain("a space of personal notes");
  expect((await create({ name: "plain", schema: null })).status).toBe(201); // a watch space: no schema key
  expect(JSON.parse(readFileSync(join(root, "cortex.json"), "utf8")).spaces).toEqual({ mine: { schema: "notes" } });
  expect(readFileSync(join(root, "spaces/plain/CLAUDE.md"), "utf8")).toContain("the second brain");
});

test("POST /api/spaces: a space whose first build fails is not left behind", async () => {
  const root = instance(["first"], ANYONE);
  const ada = person(root, "1");
  const { post, get, origin, said } = await start(root);
  const r = await post("/api/spaces", { name: "boom" }, { origin, ...ada.cookie });
  expect(r.status).toBe(500);
  expect(existsSync(join(root, "spaces/boom"))).toBe(false);
  expect(members(root, "boom")).toEqual([]);
  expect((await post("/api/spaces", { name: "boom", schema: "notes" }, { origin, ...ada.cookie })).status).toBe(500);
  expect(JSON.parse(readFileSync(join(root, "cortex.json"), "utf8")).spaces ?? {}).toEqual({}); // its schema is not left in cortex.json
  expect((await get("/s/boom/", ada.cookie)).status).toBe(404);
  expect(said.some((m) => m.startsWith("space boom:"))).toBe(true);
});

test("POST /api/sync at the root pulls and rebuilds every space (loopback only)", async () => {
  const root = instance(["a", "b"]);
  const { post, said, origin } = await start(root);
  const before = said.filter((m) => m.startsWith("site rebuilt")).length;
  expect((await post("/api/sync", {}, { origin, "x-forwarded-for": "1.2.3.4" })).status).toBe(403); // through the proxy
  expect((await post("/api/sync", {}, {})).status).toBe(200);
  const until = Date.now() + 10_000;
  while (said.filter((m) => m.startsWith("site rebuilt")).length < before + 2 && Date.now() < until) await Bun.sleep(20);
  expect(said.filter((m) => m.startsWith("site rebuilt")).length).toBe(before + 2);
});

// ---- the administration of a space: /s/<space>/api/space

const manage = async (extra: object = {}) => {
  const root = instance(["open", "mine"], { ...ANYONE, ...extra });
  const ada = person(root, "1"), bob = person(root, "2"), eve = person(root, "3");
  hold(root, "mine", ada.id); hold(root, "mine", bob.id, "member");
  return { root, ada, bob, eve, ...(await start(root)) };
};
const isJson = async (r: Response) => ({ status: r.status, body: (await r.json().catch(() => undefined)) as any });

test("GET /s/<space>/api/space: members only (404 to anyone else, whatever the visibility), the title is shown in the listing", async () => {
  const { ada, bob, eve, get, root } = await manage();
  const info = await isJson(await get("/s/mine/api/space", ada.cookie));
  expect(info.status).toBe(200);
  expect(info.body).toMatchObject({ name: "mine", title: null, visibility: "private", read_only: false, kind: "watch", storage: "instance", you: "owner" });
  expect(info.body.members.map((m: { id: string; role: string }) => [m.id, m.role])).toEqual([[ada.id, "owner"], [bob.id, "member"]]);
  expect((await isJson(await get("/s/mine/api/space", bob.cookie))).body.you).toBe("member"); // a member reads, never changes
  for (const who of [undefined, eve.cookie, { cookie: "cortex_session=forged" }]) expect((await get("/s/mine/api/space", who)).status).toBe(404);
  expect((await get("/s/open/api/space", eve.cookie)).status).toBe(404); // open, but not a member: nothing to administer from the web
  expect((await get("/s/open/api/space")).status).toBe(404);
  mkdirSync(join(root, "spaces/mine/.git"));
  writeFileSync(join(root, "cortex.json"), JSON.stringify({ ...ANYONE, spaces: { mine: { schema: "notes" } } }));
  expect((await isJson(await get("/s/mine/api/space", ada.cookie))).body).toMatchObject({ kind: "notes", storage: "own repo" });
});

test("PATCH /s/<space>/api/space: owners set the title, the visibility and read-only; the slug never changes", async () => {
  const { ada, bob, eve, get, send, origin } = await manage();
  const patch = (body: unknown, who: Record<string, string> = ada.cookie, h: Record<string, string> = { origin }) => send("PATCH", "/s/mine/api/space", body, { ...h, ...who });
  expect((await isJson(await patch({ title: "  Ma   veille  ", name: "other" }))).body).toMatchObject({ name: "mine", title: "Ma veille" });
  expect(await (await get("/api/spaces", ada.cookie)).json()).toMatchObject({ spaces: [{ name: "mine", title: "Ma veille" }, plain("open")] });
  expect((await isJson(await patch({ read_only: true }))).body.read_only).toBe(true);
  expect((await isJson(await patch({ visibility: "open", read_only: false }))).body).toMatchObject({ visibility: "open", read_only: false });
  expect((await get("/s/mine/", eve.cookie)).status).toBe(200); // open now
  expect((await isJson(await patch({ visibility: "private", title: null }))).body).toMatchObject({ visibility: "private", title: null });
  expect((await get("/s/mine/", eve.cookie)).status).toBe(404);
  expect((await patch({ title: 3 })).status).toBe(400);
  expect((await patch({ title: "x".repeat(121) })).status).toBe(400);
  expect((await patch({ visibility: "secret" })).status).toBe(400);
  expect((await patch({ read_only: "yes" })).status).toBe(400);
  expect((await patch({})).status).toBe(400);
  expect((await patch({ title: "x" }, bob.cookie)).status).toBe(403); // a member
  expect((await patch({ title: "x" }, eve.cookie)).status).toBe(404); // a stranger
  expect((await patch({ title: "x" }, {})).status).toBe(404);
  expect((await patch({ title: "x" }, ada.cookie, {})).status).toBe(403); // no Origin
  expect((await patch({ title: "x" }, ada.cookie, { origin: "https://evil.example" })).status).toBe(403);
  expect((await isJson(await get("/s/mine/api/space", ada.cookie))).body.title).toBeNull();
  expect((await send("PUT", "/s/mine/api/space", {}, { origin, ...ada.cookie })).status).toBe(405);
});

test("members: owners change roles and remove people; the last owner stays; a stranger cannot", async () => {
  const { root, ada, bob, eve, send, origin } = await manage();
  const act = (method: string, id: string, body?: unknown, who = ada.cookie) => send(method, `/s/mine/api/space/members/${id}`, body, { origin, ...who });
  expect((await act("DELETE", ada.id)).status).toBe(409); // the last owner
  expect((await act("PATCH", ada.id, { role: "member" })).status).toBe(409);
  expect((await act("PATCH", bob.id, { role: "root" })).status).toBe(400);
  expect((await act("PATCH", eve.id, { role: "owner" })).status).toBe(404); // not a member
  expect((await act("DELETE", bob.id, undefined, bob.cookie)).status).toBe(403); // a member cannot, not even to leave
  expect((await act("PATCH", bob.id, { role: "owner" }, eve.cookie)).status).toBe(404);
  const promoted = await isJson(await act("PATCH", bob.id, { role: "owner" }));
  expect(promoted.body.members.map((m: { role: string }) => m.role)).toEqual(["owner", "owner"]);
  expect((await act("PATCH", ada.id, { role: "member" }, bob.cookie)).status).toBe(200); // bob owns it now
  expect((await act("DELETE", ada.id)).status).toBe(403); // ada is a plain member now
  expect((await act("DELETE", ada.id, undefined, bob.cookie)).status).toBe(200);
  expect(members(root, "mine")).toEqual([bob.id]);
  expect((await act("DELETE", bob.id, undefined, bob.cookie)).status).toBe(409);
});

test("invitations: a single-use link, 7 days, stored hashed; accepted from the root; a private space stays hidden until then", async () => {
  const { root, ada, bob, eve, get, send, origin } = await manage();
  const invite = (body: unknown = {}, who = ada.cookie) => send("POST", "/s/mine/api/space/invites", body, { origin, ...who });
  expect((await invite({}, bob.cookie)).status).toBe(403);
  expect((await invite({}, eve.cookie)).status).toBe(404);
  expect((await invite({ role: "root" })).status).toBe(400);
  const made = await isJson(await invite({ role: "owner" }));
  expect(made.status).toBe(201);
  expect(made.body.url).toMatch(/^\/s\/mine\/invite\/[A-Za-z0-9_-]{43}$/);
  const token = made.body.url.split("/").pop();
  expect(Date.parse(made.body.expires_at) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
  const db = openAccounts(accountsFile(root));
  expect(JSON.stringify(db.query("select * from space_invites").all())).not.toContain(token); // only a hash
  db.close();
  expect((await isJson(await get("/s/mine/api/space/invites", ada.cookie))).body.invites.map((i: { id: string; role: string }) => [i.id, i.role])).toEqual([[made.body.id, "owner"]]);
  expect((await get("/s/mine/api/space/invites", bob.cookie)).status).toBe(403);
  // the page is answered to someone who is not a member, for a valid token only
  const page = await get(made.body.url);
  expect([page.status, page.headers.get("referrer-policy"), page.headers.get("cache-control")]).toEqual([200, "no-referrer", "no-store"]);
  expect(await page.text()).toContain("Join the space <code>mine</code>");
  expect((await get(`/s/mine/invite/${"x".repeat(43)}`)).status).toBe(404);
  expect((await get(`/s/open/invite/${token}`)).status).toBe(404); // another space
  expect((await get("/s/mine/", eve.cookie)).status).toBe(404);
  const accept = (t: string, h: Record<string, string> = { origin, ...eve.cookie }) => send("POST", `/api/invites/${t}/accept`, undefined, h);
  expect((await accept(token, { origin })).status).toBe(401);
  expect((await accept(token, eve.cookie)).status).toBe(403); // no Origin
  expect((await accept(token, { origin: "https://evil.example", ...eve.cookie })).status).toBe(403);
  expect((await accept("y".repeat(43))).status).toBe(404);
  expect((await isJson(await accept(token))).body).toEqual({ space: "mine", role: "owner", url: "/s/mine/" });
  expect((await get("/s/mine/", eve.cookie)).status).toBe(200);
  expect(members(root, "mine").includes(eve.id)).toBe(true);
  const frank = person(root, "4");
  expect((await accept(token, { origin, ...frank.cookie })).status).toBe(404); // single use
  expect((await get(made.body.url)).status).toBe(404);
  expect((await get("/s/mine/api/space/invites", ada.cookie).then(isJson)).body.invites).toEqual([]);
  // someone already in keeps their role and does not spend the link
  const again = (await isJson(await invite({ role: "owner" }))).body.url.split("/").pop();
  expect((await isJson(await accept(again, { origin, ...bob.cookie }))).body.role).toBe("member");
  expect((await get(`/s/mine/invite/${again}`)).status).toBe(200);
  // revoked, and expired
  const rev = await isJson(await invite()), revToken = rev.body.url.split("/").pop();
  expect((await send("DELETE", `/s/mine/api/space/invites/${rev.body.id}`, undefined, { origin, ...bob.cookie })).status).toBe(403);
  expect((await send("DELETE", `/s/mine/api/space/invites/${rev.body.id}`, undefined, { origin, ...ada.cookie })).status).toBe(200);
  expect((await send("DELETE", `/s/mine/api/space/invites/${rev.body.id}`, undefined, { origin, ...ada.cookie })).status).toBe(404);
  expect((await accept(revToken, { origin, ...frank.cookie })).status).toBe(404);
  const old = (await isJson(await invite())).body.url.split("/").pop();
  const w = openAccounts(accountsFile(root)); w.run("update space_invites set expires_at = 1"); w.close();
  expect((await accept(old, { origin, ...frank.cookie })).status).toBe(404);
  expect((await get(`/s/mine/invite/${old}`)).status).toBe(404);
});

test("archive: typed confirmation, out of spaces/, not served nor listed, restorable by an owner with its people; a space with its own repository is refused", async () => {
  const { root, ada, bob, eve, get, send, origin, said } = await manage();
  const archive = (confirm: unknown, who = ada.cookie, name = "mine") => send("POST", `/s/${name}/api/space/archive`, { confirm }, { origin, ...who });
  expect((await archive("nope")).status).toBe(400);
  expect((await archive(undefined)).status).toBe(400);
  expect((await archive("mine", bob.cookie)).status).toBe(403);
  expect((await archive("mine", eve.cookie)).status).toBe(404);
  mkdirSync(join(root, "spaces/mine/.git"));
  expect((await archive("mine")).status).toBe(409); // its own repository: the CLI only
  expect(existsSync(join(root, "spaces/mine/wiki"))).toBe(true);
  writeFileSync(join(root, "cortex.json"), JSON.stringify({ ...ANYONE, default_space: "mine" }));
  rmSync(join(root, "spaces/mine/.git"), { recursive: true });
  expect((await archive("mine")).status).toBe(200);
  expect(existsSync(join(root, "spaces/mine"))).toBe(false);
  const kept = readdirSync(join(root, ".cortex/archive")).filter((d) => /^mine-\d{8}-\d{6}$/.test(d));
  expect(kept.length).toBe(1);
  expect(existsSync(join(root, ".cortex/archive", kept[0]!, "wiki"))).toBe(true);
  expect(JSON.parse(readFileSync(join(root, "cortex.json"), "utf8")).default_space ?? null).toBeNull(); // the CLI no longer fails on it
  expect((await get("/s/mine/", ada.cookie)).status).toBe(404);
  expect((await get("/s/mine/api/space", ada.cookie)).status).toBe(404);
  expect(((await (await get("/api/spaces", ada.cookie)).json()) as { spaces: { name: string }[] }).spaces.map((s) => s.name)).toEqual(["open"]);
  expect(said.some((m) => m.startsWith("space mine archived"))).toBe(true);
  // the rows are kept: its owners find it, others do not, and nobody can take the name meanwhile
  const list = async (who?: Record<string, string>) => ((await (await get("/api/spaces/archived", who)).json()) as { archived?: { name: string; archived_at: string }[] }).archived;
  expect((await list(ada.cookie))?.map((a) => a.name)).toEqual(["mine"]);
  expect(Date.parse((await list(ada.cookie))![0]!.archived_at)).toBeGreaterThan(Date.now() - 60_000);
  expect(await list(bob.cookie)).toEqual([]); // a member, not an owner
  expect(await list(eve.cookie)).toEqual([]);
  expect((await get("/api/spaces/archived")).status).toBe(401);
  expect((await send("POST", "/api/spaces", { name: "mine" }, { origin, ...ada.cookie })).status).toBe(409);
  const restore = (who: Record<string, string> = ada.cookie, h: Record<string, string> = { origin }) => send("POST", "/api/spaces/mine/restore", undefined, { ...h, ...who });
  expect((await restore(eve.cookie)).status).toBe(404);
  expect((await restore(bob.cookie)).status).toBe(404);
  expect((await restore({})).status).toBe(401);
  expect((await restore(ada.cookie, {})).status).toBe(403);
  expect((await send("POST", "/api/spaces/ghost/restore", undefined, { origin, ...ada.cookie })).status).toBe(404);
  expect((await isJson(await restore())).body).toEqual({ name: "mine", url: "/s/mine/" });
  expect(await (await get("/s/mine/", ada.cookie)).text()).toBe("mine|/s/mine");
  expect(await (await get("/s/mine/", eve.cookie)).status).toBe(404); // private as before
  expect((await get("/s/mine/", bob.cookie)).status).toBe(200); // its people are back
  expect(members(root, "mine").sort()).toEqual([ada.id, bob.id].sort());
  expect(await list(ada.cookie)).toEqual([]);
  expect((await restore()).status).toBe(404); // not archived any more
});

test("restore is refused (409) when a live space has the name", async () => {
  const { root, ada, send, origin } = await manage();
  expect((await send("POST", "/s/mine/api/space/archive", { confirm: "mine" }, { origin, ...ada.cookie })).status).toBe(200);
  mkdirSync(join(root, "spaces/mine/wiki"), { recursive: true }); // what a manual `cortex space add` would leave
  expect((await send("POST", "/api/spaces/mine/restore", undefined, { origin, ...ada.cookie })).status).toBe(409);
});

test("a space's conversations, journeys and favorites are served under /s/<space>/api, behind the same visibility check", async () => {
  const root = instance(["open", "priv"], AUTH);
  const ada = person(root, "1"), bob = person(root, "2");
  hold(root, "priv", ada.id);
  const { get, send } = await start(root), origin = "http://localhost"; // the account routes accept the origins of auth.public_urls
  const turns = [{ question: "q", answer: "a" }];
  const save = (space: string, who: Record<string, string>) => send("POST", `/s/${space}/api/conversations`, { turns }, { origin, ...who });
  expect((await save("priv", ada.cookie)).status).toBe(201);
  expect((await save("priv", bob.cookie)).status).toBe(404); // not a member: the space does not exist for them
  expect((await save("priv", {})).status).toBe(404);
  expect((await get("/s/priv/api/journeys", bob.cookie)).status).toBe(404);
  expect((await get("/s/priv/api/me/state", bob.cookie)).status).toBe(404);
  expect((await save("open", bob.cookie)).status).toBe(201);
  expect((await save("open", {})).status).toBe(401); // open, but saving needs an account
  const mine = async (space: string, who: Record<string, string>) => ((await (await get(`/s/${space}/api/conversations`, who)).json()) as { conversations: unknown[] }).conversations.length;
  expect([await mine("priv", ada.cookie), await mine("open", ada.cookie), await mine("open", bob.cookie)]).toEqual([1, 0, 1]);
  expect((await send("PUT", "/s/open/api/me/state", { favs: ["wiki/x"] }, { origin, ...ada.cookie })).status).toBe(200);
  expect(await (await get("/s/open/api/me/state", ada.cookie)).json()).toEqual({ favs: ["wiki/x"] });
  expect(await (await get("/s/priv/api/me/state", ada.cookie)).json()).toEqual({});
});

test("the share target: /s/<space>/share/ delivers into that space (behind its visibility check), the root /share/ into the default one", async () => {
  const root = instance(["a", "b", "priv"], { ...AUTH, default_space: "b" });
  const ada = person(root, "1"), bob = person(root, "2");
  hold(root, "priv", ada.id);
  const { get, send } = await start(root);
  const share = (path: string, url: string, who?: Record<string, string>) => send("POST", path, { url }, who ?? {});
  const unreachable = (n: string) => `http://127.0.0.1:1/${n}`; // never fetched: a failed entry stays in the space's inbox/
  const inbox = (space: string) => { try { return readdirSync(join(root, "spaces", space, "inbox")); } catch { return []; } };
  const manifest = await (await get("/s/a/share/manifest.webmanifest")).json() as { scope: string };
  expect(manifest.scope).toBe("/s/a/share/");
  expect(await (await get("/share/manifest.webmanifest")).json()).toMatchObject({ scope: "/share/" });
  expect((await get("/s/a/share/")).status).toBe(200);
  expect((await share("/s/a/share/api", unreachable("a"))).status).toBe(200);
  expect((await share("/share/api", unreachable("root"))).status).toBe(200);
  expect((await share("/s/priv/share/api", unreachable("p"), bob.cookie)).status).toBe(404); // not a member
  expect((await get("/s/priv/share/", bob.cookie)).status).toBe(404);
  expect((await share("/s/priv/share/api", unreachable("p"), ada.cookie)).status).toBe(200);
  const until = Date.now() + 5000;
  while ((!inbox("a").length || !inbox("b").length || !inbox("priv").length) && Date.now() < until) await Bun.sleep(20);
  expect([inbox("a").length, inbox("b").length, inbox("priv").length]).toEqual([1, 1, 1]); // each in its own space; the default one got the root's
});

test("with --sync the creation commit holds the space's wiki, raw and agent file (and cortex.json for a schema)", async () => {
  const d = mkdtempSync(join(tmpdir(), "cortex-spaces-sync-")), sh = (cwd: string, ...a: string[]) => { const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stderr: "pipe", stdout: "pipe" }); if (r.exitCode) throw new Error(r.stderr.toString()); return r.stdout.toString().trim(); };
  sh(d, "init", "-q", "--bare", "-b", "main", "remote.git"); sh(d, "clone", "-q", "remote.git", "seed");
  mkdirSync(join(d, "seed/spaces/first/wiki"), { recursive: true });
  writeFileSync(join(d, "seed/spaces/first/wiki/x.md"), "x\n"); writeFileSync(join(d, "seed/cortex.json"), JSON.stringify(ANYONE));
  sh(join(d, "seed"), "add", "-A"); sh(join(d, "seed"), "commit", "-qm", "init"); sh(join(d, "seed"), "push", "-q", "-u", "origin", "main");
  sh(d, "clone", "-q", "remote.git", "work");
  const root = join(d, "work"), ada = person(root, "1");
  const { post, origin } = await start(root, true);
  expect((await post("/api/spaces", { name: "mine", schema: "notes" }, { origin, ...ada.cookie })).status).toBe(201);
  const files = sh(d, "--git-dir=remote.git", "ls-tree", "-r", "--name-only", "main").split("\n");
  expect(files).toEqual(expect.arrayContaining(["spaces/mine/CLAUDE.md", "spaces/mine/wiki/index.md", "spaces/mine/raw/.gitkeep", "cortex.json"]));
  expect(sh(d, "--git-dir=remote.git", "show", "main:cortex.json")).toContain('"schema": "notes"');
  expect(sh(d, "--git-dir=remote.git", "show", "main:spaces/mine/CLAUDE.md")).toContain("a space of personal notes");
  expect((await post("/api/spaces", { name: "plain" }, { origin, ...ada.cookie })).status).toBe(201);
  expect(sh(d, "--git-dir=remote.git", "ls-tree", "-r", "--name-only", "main")).toContain("spaces/plain/CLAUDE.md");
});

test("the service worker of a space answers right after its creation, and while it is rebuilt; every 404 under /s/<name>/ says which branch answered", async () => {
  const root = instance(["first"], ANYONE);
  const ada = person(root, "1");
  const { get, post, origin, said } = await start(root);
  expect((await post("/api/spaces", { name: "fresh" }, { origin, ...ada.cookie })).status).toBe(201);
  const sw = async () => (await get("/s/fresh/service-worker.js", ada.cookie)).status;
  expect(await sw()).toBe(200); // the very next request after the 201
  expect(said.filter((m) => m.startsWith("404"))).toEqual([]);
  // a rebuild swaps the build folders while the browser polls for a new service worker
  const rebuilt = () => said.filter((m) => m.startsWith("site rebuilt")).length, before = rebuilt();
  expect((await post("/api/sync", {}, {})).status).toBe(200); // both spaces are rebuilt
  const until = Date.now() + 5000, seen = new Set<number>();
  do { seen.add(await sw()); await Bun.sleep(1); } while (rebuilt() < before + 2 && Date.now() < until);
  expect([...seen]).toEqual([200]);
  // the four ways to a 404, each in the journal
  const lines = () => said.filter((m) => m.startsWith("404 "));
  await get("/s/ghost/service-worker.js", ada.cookie);
  expect(lines().at(-1)).toContain("no such site");
  await get("/s/fresh/nothing-here", ada.cookie);
  expect(lines().at(-1)).toContain("not a file nor a route");
  const db = openAccounts(accountsFile(root));
  setSpace(db, "fresh", { visibility: "private" }); db.run("delete from space_members");
  await get("/s/fresh/service-worker.js", ada.cookie);
  expect(lines().at(-1)).toContain("not allowed");
  db.run("drop table spaces");
  await get("/s/fresh/service-worker.js", ada.cookie);
  expect(lines().at(-1)).toContain("store failed");
  db.close();
  expect(lines().every((m) => /^404 (GET|HEAD) \/s\/(ghost|fresh)\//.test(m))).toBe(true);
});

test("read-only: the space stays visible and searchable, every write to its wiki and raw is refused (409), the person's own data is not one", async () => {
  const { root, ada, bob, get, send, origin, said } = await manage();
  mkdirSync(join(root, "spaces/mine/inbox"), { recursive: true });
  const patch = (body: unknown) => send("PATCH", "/s/mine/api/space", body, { origin, ...ada.cookie });
  const verify = (method = "POST") => send(method, "/s/mine/api/verify", method === "POST" ? { id: "concepts/x" } : undefined, { origin, ...ada.cookie });
  const share = () => send("POST", "/s/mine/share/api", { url: "http://127.0.0.1:1/x" }, ada.cookie);
  expect((await verify("HEAD")).status).toBe(204);
  expect((await patch({ read_only: true })).status).toBe(200);
  expect((await verify("HEAD")).status).toBe(409); // the probe: no button, the site says why
  const refused = await verify();
  expect([refused.status, ((await refused.json()) as { error: string }).error]).toEqual([409, expect.stringContaining("read-only")]);
  const shared = await share();
  expect([shared.status, await shared.text()]).toEqual([409, expect.stringContaining("read-only")]);
  expect(readdirSync(join(root, "spaces/mine/inbox"))).toEqual([]); // nothing was delivered
  // reading is as visible as its visibility says
  expect((await get("/s/mine/", ada.cookie)).status).toBe(200);
  expect((await get("/s/mine/", bob.cookie)).status).toBe(200);
  expect((await get("/s/mine/api/status", ada.cookie)).status).toBe(200);
  expect(await (await get("/api/spaces", ada.cookie)).json()).toMatchObject({ spaces: [{ name: "mine", read_only: true }, { name: "open", read_only: false }] });
  expect((await (await get("/s/mine/api/space", ada.cookie)).json() as { read_only: boolean }).read_only).toBe(true);
  // the person's own conversations and favorites are theirs, not the space's content
  const o = "http://localhost";
  expect((await send("POST", "/s/mine/api/conversations", { turns: [{ question: "q", answer: "a" }] }, { origin: o, ...ada.cookie })).status).toBe(201);
  expect((await send("PUT", "/s/mine/api/me/state", { favs: ["x"] }, { origin: o, ...ada.cookie })).status).toBe(200);
  expect((await send("PATCH", "/s/mine/api/space", { read_only: true }, { origin, ...bob.cookie })).status).toBe(403); // owners only
  // and back
  expect((await patch({ read_only: false })).status).toBe(200);
  expect((await verify("HEAD")).status).toBe(204);
  expect((await share()).status).toBe(200);
  expect(said.some((m) => m.includes("read-only"))).toBe(false);
});

test("read-only: what waits in a space's inbox/ is not taken in while it is read-only", async () => {
  const root = instance(["ro"], AUTH);
  mkdirSync(join(root, "spaces/ro/inbox"), { recursive: true });
  writeFileSync(join(root, "spaces/ro/inbox/waiting.url"), "http://127.0.0.1:1/x\n");
  const db = openAccounts(accountsFile(root)); setSpace(db, "ro", { read_only: true }); db.close();
  const { said } = await start(root);
  const until = Date.now() + 3000;
  while (!said.some((m) => m.startsWith("inbox:")) && Date.now() < until) await Bun.sleep(20);
  expect(said.find((m) => m.startsWith("inbox:"))).toContain("read-only");
  expect(readdirSync(join(root, "spaces/ro/inbox"))).toEqual(["waiting.url"]);
});

test("a space served alone (--space) is read-only too", async () => {
  const root = instance(["ro", "other"], AUTH);
  const db = openAccounts(accountsFile(root)); setSpace(db, "ro", { read_only: true }); db.close();
  const alone = await start(join(root, "spaces/ro"));
  expect((await alone.send("HEAD", "/api/verify")).status).toBe(409);
  expect((await alone.send("POST", "/api/verify", { id: "x" })).status).toBe(409);
  const other = await start(join(root, "spaces/other"));
  expect((await other.send("HEAD", "/api/verify")).status).toBe(204);
});

test("archiving right after a sync leaves no export or inbox writing into the moved folder", async () => {
  const { root, ada, post, send, origin } = await manage();
  expect((await post("/api/sync", {}, {})).status).toBe(200); // both spaces start to rebuild
  expect((await send("POST", "/s/mine/api/space/archive", { confirm: "mine" }, { origin, ...ada.cookie })).status).toBe(200);
  await Bun.sleep(400); // longer than the quiet time and a fake build
  expect(existsSync(join(root, "spaces/mine"))).toBe(false); // nothing recreated it
  expect((await send("POST", "/api/spaces/mine/restore", undefined, { origin, ...ada.cookie })).status).toBe(200); // so the name is free to restore
});
