import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountsFile, addSpaceMember, createSession, getSpace, openAccounts, randomToken, setSpace, sha256, spaceMembers, upsertUser, type Role } from "./accounts";
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
`);
const exportCmd = (_: string, out: string) => [process.execPath, script, out];

const AUTH = { auth: { public_urls: ["http://localhost"], github: { client_id: "x", allow: [1] } } };
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
const start = async (root: string) => {
  const said: string[] = [];
  const server = await serve(root, { port: 0, sync: false, reviewer: "t", say: (m) => said.push(m), exportCmd, settleMs: 5, embeddings: async () => undefined });
  servers.push(server);
  const origin = `http://localhost:${server.port}`;
  const get = (path: string, headers: Record<string, string> = {}) => fetch(origin + path, { redirect: "manual", headers });
  const post = (path: string, body: unknown, headers: Record<string, string> = { origin }) => fetch(origin + path, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { server, said, origin, get, post };
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
  expect(spaces).toEqual({ spaces: [{ name: "a" }, { name: "b" }], canCreate: false, default: "b" });
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
  expect(((await (await get("/api/spaces")).json()) as { spaces: unknown[] }).spaces).toEqual([{ name: "open" }]);
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
  expect(((await (await get("/api/spaces", ada.cookie)).json()) as { spaces: unknown[] }).spaces).toEqual([{ name: "first" }, { name: "mine" }]);
  expect(((await (await get("/api/spaces", bob.cookie)).json()) as { spaces: unknown[] }).spaces).toEqual([{ name: "first" }]);
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
