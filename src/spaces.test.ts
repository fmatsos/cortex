import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { accountsFile, addSpaceMember, deleteUser, forgetSpace, getSpace, memberRole, openAccounts, removeSpaceMember, setMemberRole, setSpace, spaceMembers, spaceVisibility, upsertUser } from "./accounts";
import { confine } from "./backends/sandbox";
import { configFile, lintConfig, loadConfig } from "./config";
import { findRoot, instanceRoot, listSpaces } from "./lib";
import { encodePayload } from "./remote";
import { archiveSpace, restoreSpace } from "./space";
import { changedPaths, withSync } from "./sync";

/** Spaces: the root of a multi-space instance, `cortex space`, git per space and the sandbox of an agent. */

const CLI = join(import.meta.dir, "cortex.ts");
const cortex = (cwd: string, args: string[], env: Record<string, string> = {}) => {
  const e: Record<string, string | undefined> = { ...process.env, NO_COLOR: "1", ...env };
  for (const k of ["CORTEX_ROOT", "CORTEX_SPACE", "CORTEX_WIKI", "CORTEX_AGENT", "CORTEX_AGENT_BATCH"]) if (!(k in env)) delete e[k];
  const p = Bun.spawnSync(["bun", CLI, ...args], { cwd, env: e });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};
const sh = (cwd: string, ...a: string[]) => {
  const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stderr: "pipe", stdout: "pipe" });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString().trim();
};
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "cortex-spaces-")));
/** A multi-space instance with the given spaces (each with an empty wiki/ and raw/) and a cortex.json. */
function instance(names: string[], config: object = {}) {
  const root = tmp();
  writeFileSync(join(root, "cortex.json"), JSON.stringify(config));
  for (const n of names) { mkdirSync(join(root, "spaces", n, "wiki"), { recursive: true }); mkdirSync(join(root, "spaces", n, "raw"), { recursive: true }); }
  return root;
}
const page = "---\ntype: Concept\ntitle: T\ndescription: D.\n---\nx\n";

describe("root resolution", () => {
  const saved = { root: process.env.CORTEX_ROOT, space: process.env.CORTEX_SPACE };
  afterEach(() => {
    for (const [k, v] of [["CORTEX_ROOT", saved.root], ["CORTEX_SPACE", saved.space]] as const) v === undefined ? delete process.env[k] : (process.env[k] = v);
  });
  const reset = () => { delete process.env.CORTEX_ROOT; delete process.env.CORTEX_SPACE; };

  test("a legacy instance (no spaces/) is its own root, from any folder inside it", () => {
    reset();
    const root = tmp();
    writeFileSync(join(root, "cortex.json"), "{}");
    mkdirSync(join(root, "wiki/concepts"), { recursive: true });
    expect(findRoot(root)).toBe(root);
    expect(findRoot(join(root, "wiki/concepts"))).toBe(root);
    process.env.CORTEX_ROOT = root;
    expect(findRoot(tmp())).toBe(root);
  });

  test("the folder you are in selects its space, wherever in it", () => {
    reset();
    const root = instance(["veille", "pro"], { default_space: "pro" });
    expect(findRoot(join(root, "spaces/veille"))).toBe(join(root, "spaces/veille"));
    expect(findRoot(join(root, "spaces/veille/wiki"))).toBe(join(root, "spaces/veille"));
    expect(() => findRoot(join(root, "spaces/veille"), "pro")).toThrow("inside the space veille");
  });

  test("outside a space: --space, then $CORTEX_SPACE, then default_space, then the only space", () => {
    reset();
    const root = instance(["veille", "pro"], { default_space: "pro" });
    expect(findRoot(root, "veille")).toBe(join(root, "spaces/veille"));
    process.env.CORTEX_SPACE = "veille";
    expect(findRoot(root)).toBe(join(root, "spaces/veille"));
    expect(findRoot(root, "pro")).toBe(join(root, "spaces/pro")); // the option beats the environment
    delete process.env.CORTEX_SPACE;
    expect(findRoot(root)).toBe(join(root, "spaces/pro")); // default_space
  });

  test("the only space is the default; several without a default, or an unknown name, are usage errors that list the spaces", () => {
    reset();
    const one = instance(["solo"]);
    expect(findRoot(one)).toBe(join(one, "spaces/solo"));
    const two = instance(["veille", "pro"]);
    expect(() => findRoot(two)).toThrow(/several spaces.*pro, veille/);
    expect(() => findRoot(two, "nope")).toThrow(/unknown space: nope.*pro, veille/);
    const none = instance([]);
    mkdirSync(join(none, "spaces"));
    expect(() => findRoot(none)).toThrow("cortex space add");
  });

  test("$CORTEX_ROOT may point into a space (what child processes get) or at the instance; the instance is found above it", () => {
    reset();
    const root = instance(["veille", "pro"], { default_space: "pro" });
    process.env.CORTEX_ROOT = join(root, "spaces/veille");
    process.env.CORTEX_SPACE = "pro"; // a child of a space stays in it
    expect(findRoot(tmp())).toBe(join(root, "spaces/veille"));
    process.env.CORTEX_ROOT = root;
    expect(findRoot(tmp())).toBe(join(root, "spaces/pro"));
    // a legacy folder without cortex.json is still returned as it is
    const bare = tmp();
    process.env.CORTEX_ROOT = bare;
    expect(findRoot(tmp())).toBe(bare);
  });

  test("helpers: the instance of a space, the spaces of an instance", () => {
    const root = instance(["b", "a"]);
    mkdirSync(join(root, "spaces/Not_A_Name"));
    expect(instanceRoot(join(root, "spaces/a"))).toBe(root);
    expect(instanceRoot(root)).toBe(root);
    expect(listSpaces(root)).toEqual(["a", "b"]);
    expect(listSpaces(tmp())).toEqual([]);
  });
});

describe("shared config", () => {
  test("cortex.json and accounts.db are the instance's, whatever space the root is", async () => {
    const root = instance(["veille"], { language: "French", default_space: "veille", spaces: { veille: { repo: "git@h:me/v.git" } } });
    const space = join(root, "spaces/veille");
    expect(await loadConfig(space)).toEqual({ language: "French", default_space: "veille", spaces: { veille: { repo: "git@h:me/v.git" } } });
    expect(configFile(space).name).toBe(join(root, "cortex.json"));
    expect(accountsFile(space)).toBe(join(root, ".cortex/accounts.db"));
    expect(accountsFile(root)).toBe(join(root, ".cortex/accounts.db"));
  });

  test("default_space and spaces are validated", () => {
    const errors = (c: object) => lintConfig(c).filter((i) => i.level === "error").map((i) => i.msg);
    expect(errors({ default_space: "veille", spaces: { veille: { repo: "x" }, pro: {} } })).toEqual([]);
    expect(errors({ default_space: "Not Valid" })[0]).toContain("default_space");
    expect(errors({ spaces: { "Bad Name": {} } })[0]).toContain("invalid space name");
    expect(errors({ spaces: { a: { repo: "x", branch: "y" } } }).length).toBe(1); // strict: only repo, schema
    expect(errors({ site_spaces: { create: "anyone" } })).toEqual([]);
    expect(errors({ site_spaces: { create: "everyone" } })[0]).toContain("site_spaces.create");
    expect(errors({ site_spaces: { create: "owners", more: 1 } }).length).toBe(1);
  });

  test("spaces.<name>.schema: the built-in notes, or a path; a bare unknown name is refused", () => {
    const errors = (c: object) => lintConfig(c).filter((i) => i.level === "error").map((i) => i.msg);
    expect(errors({ spaces: { pro: { schema: "notes" }, perso: { schema: "schemas/perso.md" }, a: { schema: "x.md" } } })).toEqual([]);
    expect(errors({ spaces: { pro: { schema: "veille" } } })).toEqual(['unknown built-in schema "veille" in "spaces.<name>.schema" (notes), or give a path to a .md file.']);
    expect(errors({ schema: "bogus" })[0]).toContain('unknown built-in schema "bogus"');
    expect(errors({ schema: "notes" })).toEqual([]);
  });
});

describe("cortex space", () => {
  test("add --schema notes records it, writes the space's agent file from it, and refuses a bad value before creating anything", async () => {
    const root = tmp();
    writeFileSync(join(root, "cortex.json"), JSON.stringify({ client: "codex" }));
    expect(cortex(root, ["space", "add", "pro", "--schema", "notes"]).out).toContain("space pro created (schema: notes)");
    expect(cortex(root, ["space", "add", "veille"]).code).toBe(0);
    expect(await loadConfig(root)).toEqual({ client: "codex", spaces: { pro: { schema: "notes" } } });
    expect(readFileSync(join(root, "spaces/pro/AGENTS.md"), "utf8")).toContain("a space of personal notes");
    expect(readFileSync(join(root, "spaces/veille/AGENTS.md"), "utf8")).toContain("the second brain"); // no schema: the built-in default
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
    for (const bad of ["veille", "absent.md"]) {
      const r = cortex(root, ["space", "add", "x", "--schema", bad]);
      expect([r.code, existsSync(join(root, "spaces/x"))]).toEqual([2, false]);
    }
    expect(cortex(root, ["schema"], { CORTEX_SPACE: "pro" }).out).toContain("a space of personal notes");
    expect(cortex(join(root, "spaces/veille"), ["schema"]).out).toContain("the second brain");
  });

  test("add creates an empty space with its index and journal; list marks the default; a name is validated", () => {
    const root = tmp();
    writeFileSync(join(root, "cortex.json"), "{}");
    expect(cortex(root, ["space", "add", "veille"]).out).toContain("space veille created");
    expect(existsSync(join(root, "spaces/veille/wiki/index.md"))).toBe(true);
    expect(existsSync(join(root, "spaces/veille/raw/.gitkeep"))).toBe(true);
    expect(cortex(root, ["space", "add", "veille"]).code).toBe(2); // exists
    expect(cortex(root, ["space", "add", "Bad Name"]).code).toBe(2);
    expect(cortex(root, ["space", "add", "pro"]).code).toBe(0);
    expect(cortex(root, ["space", "list"]).out).toBe("  pro  open\n  veille  open\n");
    writeFileSync(join(root, "cortex.json"), '{"default_space":"veille"}');
    expect(cortex(root, ["space", "list"]).out).toBe("  pro  open\n* veille  open\n");
    expect(cortex(root, ["space", "nope"]).code).toBe(2);
    // from inside a space, `space` still acts on the instance
    expect(cortex(join(root, "spaces/pro"), ["space", "list"]).out).toBe("  pro  open\n* veille  open\n");
  });

  test("add refuses a legacy wiki that still has wiki/ at its root: migrate first", () => {
    const root = tmp();
    writeFileSync(join(root, "cortex.json"), "{}");
    mkdirSync(join(root, "wiki"));
    const r = cortex(root, ["space", "add", "veille"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("space migrate");
    expect(existsSync(join(root, "spaces"))).toBe(false);
  });

  test("the commands work on the chosen space: --space, the folder, an ambiguity (exit 2)", () => {
    const root = tmp();
    writeFileSync(join(root, "cortex.json"), "{}");
    cortex(root, ["space", "add", "veille"]);
    cortex(root, ["space", "add", "pro"]);
    mkdirSync(join(root, "spaces/pro/wiki/concepts"), { recursive: true });
    writeFileSync(join(root, "spaces/pro/wiki/concepts/a.md"), page);
    const amb = cortex(root, ["ls"]);
    expect(amb.code).toBe(2);
    expect(amb.err).toContain("several spaces");
    expect(cortex(root, ["--space", "pro", "ls"]).out).toContain("T");
    expect(cortex(root, ["--space", "veille", "ls"]).out).toContain("No pages");
    expect(cortex(root, ["ls"], { CORTEX_SPACE: "pro" }).out).toContain("T");
    expect(cortex(join(root, "spaces/pro/wiki"), ["ls"]).out).toContain("T");
    expect(cortex(join(root, "spaces/veille"), ["ls"], { CORTEX_SPACE: "pro" }).out).toContain("No pages"); // the folder wins over the environment
    expect(cortex(root, ["--space", "nope", "ls"]).code).toBe(2);
    expect(cortex(join(root, "spaces/veille"), ["--space", "pro", "ls"]).code).toBe(2); // a command run in a space cannot reach another one
    // config acts on the instance without a space being chosen
    expect(cortex(root, ["config", "set", "default_space", "pro"]).code).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "cortex.json"), "utf8")).default_space).toBe("pro");
    expect(cortex(root, ["ls"]).out).toContain("T");
  });

  test("add --repo clones the space into its own repository, ignores it in the instance's and records it", () => {
    const d = tmp(), remote = join(d, "pro.git"), root = join(d, "inst");
    sh(d, "init", "-q", "--bare", "-b", "main", remote);
    mkdirSync(root);
    writeFileSync(join(root, "cortex.json"), "{}");
    writeFileSync(join(root, ".gitignore"), ".cortex/");
    sh(root, "init", "-q", "-b", "main");
    const r = cortex(root, ["space", "add", "pro", "--repo", remote]);
    expect(r.code).toBe(0);
    expect(existsSync(join(root, "spaces/pro/.git"))).toBe(true);
    expect(existsSync(join(root, "spaces/pro/wiki/index.md"))).toBe(true);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(".cortex/\n/spaces/pro/\n");
    expect(JSON.parse(readFileSync(join(root, "cortex.json"), "utf8")).spaces).toEqual({ pro: { repo: remote } });
    expect(sh(root, "status", "--porcelain")).not.toContain("spaces/pro");
    expect(cortex(root, ["space", "list"]).out).toContain("(own repo)");
    expect(cortex(root, ["space", "add", "x", "--repo", join(d, "missing.git")]).code).toBe(1);
  });

  test("migrate moves wiki/, raw/, paths/, inbox/ and the space part of .cortex/ with git mv, keeps accounts.db, sets default_space", () => {
    const root = tmp();
    writeFileSync(join(root, "cortex.json"), "{}");
    for (const [f, c] of [["wiki/concepts/a.md", page], ["raw/r1/source.md", "r"], ["paths/p.md", "p"]] as const) { mkdirSync(join(root, f, ".."), { recursive: true }); writeFileSync(join(root, f), c); }
    sh(root, "init", "-q", "-b", "main"); sh(root, "add", "-A"); sh(root, "commit", "-qm", "init");
    mkdirSync(join(root, "wiki/untracked"), { recursive: true }); writeFileSync(join(root, "wiki/untracked/u.md"), "u");
    mkdirSync(join(root, ".cortex/serve/a"), { recursive: true });
    openAccounts(join(root, ".cortex/accounts.db")).close(); // a real one: migrate gives its rows to the space
    for (const f of [".cortex/search.db", ".cortex/judge.db", ".cortex/serve/a/x"]) writeFileSync(join(root, f), "d");
    const r = cortex(root, ["space", "migrate", "veille"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("spaces/veille/");
    for (const f of ["wiki/concepts/a.md", "wiki/untracked/u.md", "raw/r1/source.md", "paths/p.md", ".cortex/search.db", ".cortex/judge.db", ".cortex/serve/a/x"]) {
      expect(existsSync(join(root, "spaces/veille", f))).toBe(true);
      expect(existsSync(join(root, f))).toBe(false);
    }
    expect(existsSync(join(root, ".cortex/accounts.db"))).toBe(true);
    expect(existsSync(join(root, "wiki"))).toBe(false);
    expect(sh(root, "status", "--porcelain")).toContain("R  wiki/concepts/a.md -> spaces/veille/wiki/concepts/a.md"); // history kept
    expect(JSON.parse(readFileSync(join(root, "cortex.json"), "utf8")).default_space).toBe("veille");
    expect(cortex(root, ["ls"]).out).toContain("T"); // the default space now answers
    expect(cortex(root, ["space", "migrate", "other"]).code).toBe(2); // spaces/ exists: refused
  });

  test("migrate gives the saved conversations, journeys and favorites of the legacy instance to the space (an accounts.db of before the spaces)", () => {
    const root = tmp();
    writeFileSync(join(root, "cortex.json"), "{}");
    mkdirSync(join(root, "wiki"), { recursive: true }); mkdirSync(join(root, "raw"), { recursive: true });
    mkdirSync(join(root, ".cortex"), { recursive: true });
    const old = new Database(join(root, ".cortex/accounts.db"), { create: true });
    old.run(`
      create table users (id text primary key, provider text not null, subject text not null, name text, email text, created_at integer not null, last_login_at integer not null, unique (provider, subject));
      create table user_state (user_id text primary key references users(id) on delete cascade, data text not null, updated_at integer not null);
      create table conversations (id text primary key, user_id text not null references users(id) on delete cascade, title text not null, turns text not null, exchanges integer not null, search text not null, created_at integer not null, updated_at integer not null);
      create table journeys (id text primary key, user_id text not null references users(id) on delete cascade, title text not null, route text not null, created_at integer not null, updated_at integer not null);
      create table space_members (space text not null, user_id text not null, primary key (space, user_id));
      insert into users values ('u1', 'github', '1', 'Ada', null, 1, 1), ('u2', 'github', '2', 'Bob', null, 1, 1);
      insert into user_state values ('u1', '{"theme":"dark","favs":["wiki/concepts/x","wiki/y"]}', 1), ('u2', '{"theme":"light"}', 1);
      insert into conversations values ('c1', 'u1', 'Q', '[]', 0, 'q', 1, 1);
      insert into journeys values ('j1', 'u1', 'J', '["a"]', 1, 1), ('j2', 'u2', 'K', '["b"]', 1, 1);`);
    old.close();
    expect(cortex(root, ["space", "migrate", "veille"]).code).toBe(0);
    const db = openAccounts(accountsFile(root));
    expect(db.query("select id, space from conversations").all()).toEqual([{ id: "c1", space: "veille" }]);
    expect(db.query("select id, space from journeys order by id").all()).toEqual([{ id: "j1", space: "veille" }, { id: "j2", space: "veille" }]);
    expect(db.query("select user_id, space, data from space_state").all()).toEqual([{ user_id: "u1", space: "veille", data: '{"favs":["wiki/concepts/x","wiki/y"]}' }]);
    expect(db.query("select user_id, data from user_state order by user_id").all()).toEqual([{ user_id: "u1", data: '{"theme":"dark"}' }, { user_id: "u2", data: '{"theme":"light"}' }]); // the account keeps its preferences
    db.close();
  });

  test("migrate without git is a plain rename, and an existing default_space is kept", () => {
    const root = tmp();
    writeFileSync(join(root, "cortex.json"), '{"default_space":"pro"}');
    mkdirSync(join(root, "wiki"));
    mkdirSync(join(root, "raw"));
    expect(cortex(root, ["space", "migrate", "veille"]).code).toBe(0);
    expect(existsSync(join(root, "spaces/veille/wiki"))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, "cortex.json"), "utf8")).default_space).toBe("pro");
    const empty = tmp();
    writeFileSync(join(empty, "cortex.json"), "{}");
    expect(cortex(empty, ["space", "migrate", "veille"]).code).toBe(2); // nothing to move
  });
});

describe("git per space", () => {
  /** A bare remote with one clone as the instance (monorepo), or as the space's own repository. */
  const remoteWith = (d: string, name: string, files: Record<string, string>) => {
    const bare = join(d, `${name}.git`), seed = join(d, `${name}-seed`);
    sh(d, "init", "-q", "--bare", "-b", "main", bare);
    sh(d, "clone", "-q", bare, seed);
    for (const [f, c] of Object.entries(files)) { mkdirSync(join(seed, f, ".."), { recursive: true }); writeFileSync(join(seed, f), c); }
    sh(seed, "add", "-A"); sh(seed, "commit", "-qm", "init"); sh(seed, "push", "-q", "-u", "origin", "main");
    return bare;
  };
  const show = (bare: string, f: string) => Bun.spawnSync(["git", "-C", bare, "show", `main:${f}`]).stdout.toString();

  test("monorepo: the changed paths of a space are relative to it and a synced command commits only its files", async () => {
    const d = tmp(), bare = remoteWith(d, "inst", { "cortex.json": "{}", "spaces/a/wiki/p.md": "1\n", "spaces/b/wiki/p.md": "1\n" });
    sh(d, "clone", "-q", bare, "work");
    const work = join(d, "work"), a = join(work, "spaces/a");
    writeFileSync(join(a, "wiki/new.md"), "x\n");
    writeFileSync(join(work, "spaces/b/wiki/other.md"), "y\n"); // another space: not this command's
    expect(changedPaths(a)).toEqual(["wiki/new.md"]);
    await withSync(a, "new", async () => { writeFileSync(join(a, "wiki/second.md"), "z\n"); }, () => {});
    expect(show(bare, "spaces/a/wiki/new.md")).toBe("x\n");
    expect(show(bare, "spaces/a/wiki/second.md")).toBe("z\n");
    expect(show(bare, "spaces/b/wiki/other.md")).toBe(""); // not committed
    expect(sh(work, "status", "--porcelain")).toContain("spaces/b/wiki/other.md");
  });

  test("cortex space add --sync commits the new space's wiki, raw and agent file (cortex.json for a schema)", () => {
    const d = tmp(), bare = remoteWith(d, "inst", { "cortex.json": "{}", "spaces/a/wiki/p.md": "1\n" });
    sh(d, "clone", "-q", bare, "work");
    const work = join(d, "work");
    expect(cortex(work, ["space", "add", "n", "--schema", "notes", "--sync"]).code).toBe(0);
    expect(sh(d, `--git-dir=${bare}`, "ls-tree", "-r", "--name-only", "main")).toEqual(expect.stringContaining("spaces/n/raw/.gitkeep")); // empty: `show` cannot tell it
    for (const f of ["spaces/n/CLAUDE.md", "spaces/n/wiki/index.md"]) expect(show(bare, f)).not.toBe("");
    expect(show(bare, "cortex.json")).toContain('"schema": "notes"');
    expect(sh(work, "log", "-1", "--format=%s")).toBe("space: add n");
    expect(cortex(work, ["space", "add", "m"]).code).toBe(0); // without --sync: left to the user, as before
    expect(show(bare, "spaces/m/CLAUDE.md")).toBe("");
  });

  test("monorepo: archiving and restoring a space commit the move (and cortex.json when default_space changes)", async () => {
    const d = tmp(), bare = remoteWith(d, "inst", { "cortex.json": '{"default_space":"a"}\n', "spaces/a/wiki/p.md": "1\n", "spaces/b/wiki/p.md": "1\n" });
    sh(d, "clone", "-q", bare, "work");
    const work = join(d, "work");
    await archiveSpace(work, "a", true);
    expect(show(bare, "spaces/a/wiki/p.md")).toBe(""); // gone from the tree, still in the history
    expect(show(bare, "spaces/b/wiki/p.md")).toBe("1\n");
    expect(show(bare, "cortex.json")).not.toContain("default_space\": \"a");
    expect(sh(work, "log", "-1", "--format=%s")).toBe("space: archive a");
    expect(sh(work, "status", "--porcelain")).not.toContain("spaces/");
    restoreSpace(work, "a", true);
    expect(show(bare, "spaces/a/wiki/p.md")).toBe("1\n");
    expect(sh(work, "log", "-1", "--format=%s")).toBe("space: restore a");
    // nothing tracked, nothing to commit: no error either
    mkdirSync(join(work, "spaces/c/wiki"), { recursive: true });
    await archiveSpace(work, "c", true);
    expect(sh(work, "log", "-1", "--format=%s")).toBe("space: restore a");
  });

  test("monorepo: a tracked file modified in another space does not stop the pull, nor is it lost", async () => {
    const d = tmp(), bare = remoteWith(d, "inst", { "cortex.json": "{}", "spaces/a/wiki/p.md": "1\n", "spaces/b/wiki/p.md": "1\n" });
    sh(d, "clone", "-q", bare, "work"); sh(d, "clone", "-q", bare, "other");
    const work = join(d, "work"), a = join(work, "spaces/a");
    writeFileSync(join(d, "other/spaces/a/wiki/q.md"), "from another writer\n"); sh(join(d, "other"), "add", "-A"); sh(join(d, "other"), "commit", "-qm", "q"); sh(join(d, "other"), "push", "-q");
    writeFileSync(join(work, "spaces/b/wiki/p.md"), "unsaved work in b\n"); // tracked, modified, not this space's
    await withSync(a, "new", async () => { writeFileSync(join(a, "wiki/new.md"), "x\n"); }, () => {});
    expect(show(bare, "spaces/a/wiki/new.md")).toBe("x\n");
    expect(show(bare, "spaces/a/wiki/q.md")).toBe("from another writer\n");
    expect(readFileSync(join(work, "spaces/b/wiki/p.md"), "utf8")).toBe("unsaved work in b\n");
  });

  test("a remote host runs and syncs a forwarded command in the space it names, monorepo or own repository", () => {
    const d = tmp(), inst = remoteWith(d, "inst", { "cortex.json": "{}", ".gitignore": "/spaces/pro/\n", "spaces/veille/wiki/p.md": "1\n" }), pro = remoteWith(d, "pro", { "wiki/p.md": "1\n" });
    sh(d, "clone", "-q", inst, "work");
    const work = join(d, "work");
    sh(work, "clone", "-q", pro, "spaces/pro");
    const exec = (...argv: string[]) => Bun.spawnSync(["bun", CLI, "remote-exec", encodePayload({ argv })], { cwd: d, env: { ...process.env, NO_COLOR: "1", CORTEX_ROOT: work }, stdin: Buffer.from(`Une source distante ${argv.at(-1)}, assez longue pour être capturée.`) });
    expect(exec("add", "-", "--space", "veille").exitCode).toBe(0);
    expect(exec("add", "-", "--space", "pro").exitCode).toBe(0);
    const rawIn = (bare: string, prefix: string) => Bun.spawnSync(["git", "-C", bare, "ls-tree", "-r", "--name-only", "main"]).stdout.toString().split("\n").filter((f) => f.startsWith(prefix) && f.endsWith("source.md"));
    expect(rawIn(inst, "spaces/veille/raw/").length).toBe(1); // the monorepo got its space's source
    expect(rawIn(pro, "raw/").length).toBe(1); // the own repository got its own
    expect(rawIn(inst, "spaces/pro/").length).toBe(0);
    expect(exec("search", "x").exitCode).toBe(2); // two spaces, none chosen
  });

  test("own repository: the space is synced into its own remote, not into the instance's", async () => {
    const d = tmp(), inst = remoteWith(d, "inst", { "cortex.json": "{}", ".gitignore": "/spaces/pro/\n" }), pro = remoteWith(d, "pro", { "wiki/p.md": "1\n", "raw/.gitkeep": "" });
    sh(d, "clone", "-q", inst, "work");
    const work = join(d, "work"), space = join(work, "spaces/pro");
    mkdirSync(join(work, "spaces"));
    sh(work, "clone", "-q", pro, "spaces/pro");
    await withSync(space, "new", async () => { writeFileSync(join(space, "wiki/new.md"), "x\n"); }, () => {});
    expect(show(pro, "wiki/new.md")).toBe("x\n");
    expect(show(inst, "spaces/pro/wiki/new.md")).toBe("");
    expect(sh(work, "status", "--porcelain")).toBe("");
  });
});

describe("sandbox of a multi-space instance", () => {
  const bwrap = process.platform !== "darwin" && Bun.which("bwrap");
  test.skipIf(!bwrap)("linux: the whole instance read-only, the other spaces hidden, only the space's wiki/ writable", () => {
    const root = instance(["veille", "pro", "perso"]), cmd = ["claude", "p"], at = (n: string) => join(root, "spaces", n);
    expect(confine(at("pro"), cmd, "write")).toEqual([
      "bwrap", "--dev-bind", "/", "/", "--ro-bind", root, root,
      "--tmpfs", at("perso"), "--tmpfs", at("veille"),
      "--bind", join(at("pro"), "wiki"), join(at("pro"), "wiki"), "--die-with-parent", "--", ...cmd,
    ]);
    expect(confine(at("pro"), cmd, "read")).toEqual(["bwrap", "--dev-bind", "/", "/", "--ro-bind", root, root, "--tmpfs", at("perso"), "--tmpfs", at("veille"), "--die-with-parent", "--", ...cmd]);
  });

  test.skipIf(!bwrap)("linux: a legacy instance is confined as before", () => {
    const root = tmp();
    writeFileSync(join(root, "cortex.json"), "{}");
    mkdirSync(join(root, "wiki"));
    expect(confine(root, ["x"], "write")).toEqual(["bwrap", "--dev-bind", "/", "/", "--ro-bind", root, root, "--bind", join(root, "wiki"), join(root, "wiki"), "--die-with-parent", "--", "x"]);
    expect(confine(root, ["x"], "read")).toEqual(["bwrap", "--dev-bind", "/", "/", "--ro-bind", root, root, "--die-with-parent", "--", "x"]);
  });

  test.skipIf(!bwrap)("linux: for real, the agent of a space reads its own, cannot read the others nor write outside its wiki/", () => {
    const root = instance(["veille", "pro"]);
    writeFileSync(join(root, "spaces/veille/wiki/secret.md"), "veille\n");
    writeFileSync(join(root, "spaces/pro/wiki/own.md"), "pro\n");
    const run = (script: string) => {
      const p = Bun.spawnSync(confine(join(root, "spaces/pro"), ["sh", "-c", script], "write"), { stdout: "pipe", stderr: "pipe" });
      if (p.exitCode !== 0 && /bwrap:|Operation not permitted|Permission denied/.test(p.stderr.toString()) && !/sh:/.test(p.stderr.toString())) return undefined; // no user namespaces here
      return p;
    };
    const probe = run(`cat ${join(root, "spaces/pro/wiki/own.md")}`);
    if (!probe) return; // bwrap cannot run in this environment (container without user namespaces)
    expect(probe.stdout.toString()).toBe("pro\n");
    expect(run(`cat ${join(root, "spaces/veille/wiki/secret.md")}`)!.exitCode).not.toBe(0);
    expect(run(`echo x > ${join(root, "spaces/pro/wiki/new.md")}`)!.exitCode).toBe(0);
    expect(run(`echo x > ${join(root, "spaces/pro/raw/new.md")}`)!.exitCode).not.toBe(0);
    expect(run(`echo x > ${join(root, "cortex.json")}`)!.exitCode).not.toBe(0);
  });

  test("macos: writes denied under the instance but the wiki, reads denied under the other spaces", () => {
    const root = instance(["veille", "pro"]), at = (n: string) => join(root, "spaces", n);
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "darwin" });
    try {
      const argv = confine(at("pro"), ["claude"], "write");
      expect(argv.slice(0, 2)).toEqual(["sandbox-exec", "-p"]);
      expect(argv[2]).toBe(`(version 1)(allow default)(deny file-write* (require-all (subpath ${JSON.stringify(root)}) (require-not (subpath ${JSON.stringify(join(at("pro"), "wiki"))}))))(deny file-read* (subpath ${JSON.stringify(at("veille"))}))`);
    } finally { Object.defineProperty(process, "platform", platform); }
  });
});

describe("search across spaces", () => {
  const doc = (title: string, body: string) => `---\ntype: Concept\ntitle: ${title}\ndescription: D.\n---\n${body}\n`;
  /** a: "Zythum Alpha" (title match, rank 1) and "Brew" (body only, rank 2); b: "Zythum Beta" (rank 1); c: nothing. */
  const fixture = () => {
    const root = instance(["a", "b", "c"], { default_space: "a" });
    writeFileSync(join(root, "spaces/a/wiki/alpha.md"), doc("Zythum Alpha", "Un texte."));
    writeFileSync(join(root, "spaces/a/wiki/brew.md"), doc("Brew", "Un texte sur le zythum."));
    writeFileSync(join(root, "spaces/b/wiki/beta.md"), doc("Zythum Beta", "Un autre texte."));
    return root;
  };
  const search = (cwd: string, ...args: string[]) => cortex(cwd, ["search", "zythum", "--json", ...args]);
  const titles = (out: string) => JSON.parse(out).map((h: { space: string; title: string }) => `${h.space}:${h.title}`);

  test("fuses each space's ranking by rank (a tie goes to the first space), each hit names its space", () => {
    const root = fixture();
    expect(titles(search(root, "--space", "a,b").out)).toEqual(["a:Zythum Alpha", "b:Zythum Beta", "a:Brew"]);
    expect(titles(search(root, "--space", "b,a").out)).toEqual(["b:Zythum Beta", "a:Zythum Alpha", "a:Brew"]);
    expect(titles(search(root, "--space", "a,b", "--limit", "2").out)).toEqual(["a:Zythum Alpha", "b:Zythum Beta"]);
    expect(JSON.parse(search(root, "--space", "a,b").out)[0].score).toBeCloseTo(-1 / 61, 10); // k = 60, rank 1
  });

  test("all searches every space; text output prefixes the space only when several were searched", () => {
    const root = fixture();
    expect(titles(search(root, "--space", "all").out)).toEqual(["a:Zythum Alpha", "b:Zythum Beta", "a:Brew"]);
    const text = cortex(root, ["search", "zythum", "--space", "all"]).out.split("\n").filter((l) => /^\S+\s+wiki/.test(l));
    expect(text.map((l) => l.split(/\s+/)[0])).toEqual(["a", "b", "a"]);
    expect(cortex(root, ["search", "zythum", "--space", "a,a"]).out).not.toMatch(/^a\s+wiki/m); // one space: no prefix
  });

  test("by default, and with one name, a search stays in one space and its output is unchanged", () => {
    const root = fixture();
    expect(JSON.parse(search(root).out).map((h: { title: string; space?: string }) => [h.title, h.space])).toEqual([["Zythum Alpha", undefined], ["Brew", undefined]]);
    expect(search(root, "--space", "b").out).not.toContain('"space"');
    expect(titles(search(root, "--space", "b").out)).toEqual(["undefined:Zythum Beta"]);
  });

  test("an unknown space, a list on a legacy instance: usage errors", () => {
    const root = fixture(), legacy = tmp();
    writeFileSync(join(legacy, "cortex.json"), "{}");
    const r = search(root, "--space", "a,nope");
    expect([r.code, r.err]).toEqual([2, expect.stringContaining("unknown space: nope")]);
    expect(search(legacy, "--space", "all").code).toBe(2);
  });

  test("every other command refuses several spaces", () => {
    const root = fixture();
    for (const args of [["ls"], ["lint"], ["show", "x"], ["related", "x"], ["index"], ["log"]]) for (const space of ["a,b", "all"]) {
      const r = cortex(root, [...args, "--space", space]);
      expect([args[0], r.code, r.err]).toEqual([args[0], 2, expect.stringContaining("only for cortex search")]);
    }
  });

  test("refused inside a space (an agent confined to it): from its folder or through CORTEX_ROOT", () => {
    const root = fixture();
    for (const r of [search(join(root, "spaces/a"), "--space", "all"), cortex(root, ["search", "zythum", "--space", "a,b"], { CORTEX_ROOT: join(root, "spaces/a") })]) {
      expect(r.code).toBe(2);
      expect(r.err).toContain("inside the space a");
    }
    expect(search(join(root, "spaces/a")).code).toBe(0); // its own space is still searchable
  });

  test("a remote host searches several spaces, runs at the instance; other commands are refused there", () => {
    const root = fixture();
    const exec = (...argv: string[]) => Bun.spawnSync(["bun", CLI, "remote-exec", encodePayload({ argv })], { cwd: root, env: { ...process.env, NO_COLOR: "1", CORTEX_ROOT: root } });
    const ok = exec("search", "zythum", "--json", "--space", "a,b");
    expect(ok.exitCode).toBe(0);
    expect(titles(ok.stdout.toString())).toEqual(["a:Zythum Alpha", "b:Zythum Beta", "a:Brew"]);
    expect(exec("ls", "--space", "all").exitCode).not.toBe(0);
  });

  /** The MCP server over stdio: `call(name, args)` resolves the tool result. */
  async function mcp(env: Record<string, string>, args = ["mcp"]) {
    const e: Record<string, string | undefined> = { ...process.env, ...env };
    for (const k of ["CORTEX_SPACE", "CORTEX_WIKI"]) delete e[k];
    const proc = Bun.spawn(["bun", CLI, ...args], { env: e, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const reader = proc.stdout.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "", n = 0;
    const rpc = async (method: string, params?: object) => {
      const id = ++n;
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); proc.stdin.flush();
      for (;;) {
        const nl = buf.indexOf("\n");
        if (nl >= 0) { const m = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1); if (m.id === id) return m.result; continue; }
        const { value, done } = await reader.read();
        if (done) throw new Error(await new Response(proc.stderr).text());
        buf += value;
      }
    };
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    return { call: (name: string, args: object) => rpc("tools/call", { name, arguments: args }), tools: () => rpc("tools/list"), close: () => { proc.stdin.end(); proc.kill(); } };
  }
  const data = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

  test("MCP: search takes a space argument (a name, a list, all); get and related open a hit of another space", async () => {
    const root = fixture(), m = await mcp({ CORTEX_ROOT: root });
    try {
      const props = (await m.tools()).tools.map((t: { name: string; inputSchema: { properties: object } }) => [t.name, Object.keys(t.inputSchema.properties)]);
      for (const t of ["search", "get", "related"]) expect(props.find(([n]: string[]) => n === t)[1]).toContain("space");
      const own = data(await m.call("search", { q: "zythum" }));
      expect(own.hits.map((h: { title: string; space?: string }) => [h.title, h.space])).toEqual([["Zythum Alpha", undefined], ["Brew", undefined]]); // today's behaviour
      expect(data(await m.call("search", { q: "zythum", space: "all" })).hits.map((h: { space: string; title: string }) => `${h.space}:${h.title}`)).toEqual(["a:Zythum Alpha", "b:Zythum Beta", "a:Brew"]);
      expect(data(await m.call("search", { q: "zythum", space: "b" })).hits.map((h: { space: string }) => h.space)).toEqual(["b"]);
      expect((await m.call("get", { path: "/wiki/beta.md" })).isError).toBe(true); // not in the server's space
      expect((await m.call("get", { path: "/wiki/beta.md", space: "b" })).content[0].text).toContain("Zythum Beta");
      expect((await m.call("related", { path: "/wiki/beta.md", space: "b" })).isError).toBeFalsy();
      expect((await m.call("get", { path: "/wiki/beta.md", space: "a,b" })).isError).toBe(true);
      expect((await m.call("search", { q: "zythum", space: "nope" })).isError).toBe(true);
    } finally { m.close(); }
  });

  test("MCP over ssh: the server starts at the instance, so the space argument works and the default space is the one selected; a key that holds one space stays confined", async () => {
    const root = fixture(), remote = (argv: string[]) => ["remote-exec", encodePayload({ argv })];
    let m = await mcp({ CORTEX_ROOT: root }, remote(["mcp"]));
    try {
      expect(data(await m.call("search", { q: "zythum" })).hits.map((h: { title: string }) => h.title)).toEqual(["Zythum Alpha", "Brew"]); // default_space: a
      expect(data(await m.call("search", { q: "zythum", space: "all" })).hits.map((h: { space: string }) => h.space)).toEqual(["a", "b", "a"]);
      expect((await m.call("get", { path: "/wiki/beta.md", space: "b" })).content[0].text).toContain("Zythum Beta");
    } finally { m.close(); }
    m = await mcp({ CORTEX_ROOT: root }, remote(["mcp", "--space", "b"]));
    try { expect(data(await m.call("search", { q: "zythum" })).hits.map((h: { title: string }) => h.title)).toEqual(["Zythum Beta"]); } finally { m.close(); }
    m = await mcp({ CORTEX_ROOT: join(root, "spaces/a") }, remote(["mcp"])); // the key's forced command points into a space
    try {
      const r = await m.call("search", { q: "zythum", space: "all" });
      expect([r.isError, r.content[0].text]).toEqual([true, expect.stringContaining("confined")]);
      expect(data(await m.call("search", { q: "zythum" })).hits.length).toBe(2);
    } finally { m.close(); }
  });

  test("MCP: a server confined to a space refuses the space argument", async () => {
    const root = fixture(), m = await mcp({ CORTEX_ROOT: join(root, "spaces/a") });
    try {
      for (const [name, args] of [["search", { q: "zythum", space: "all" }], ["get", { path: "/wiki/beta.md", space: "b" }]] as const) {
        const r = await m.call(name, args);
        expect([name, r.isError, r.content[0].text]).toEqual([name, true, expect.stringContaining("confined")]);
      }
      expect(data(await m.call("search", { q: "zythum" })).hits.length).toBe(2); // its own space still answers
    } finally { m.close(); }
  });
});

describe("visibility and roles", () => {
  /** The accounts database as it was before spaces had a visibility: members were rows, and a space with any row was private. */
  const OLD = `
    create table users (id text primary key, provider text not null, subject text not null, name text, email text, created_at integer not null, last_login_at integer not null, unique (provider, subject));
    create table space_members (space text not null, user_id text not null, primary key (space, user_id));`;
  const user = (db: Database, sub: string, email: string | null = null) => upsertUser(db, "github", sub, sub, email, 1).id;

  test("an accounts.db of an earlier version is migrated in place: its members become owners and their spaces stay private, the others stay open", () => {
    const path = join(tmp(), "accounts.db"), old = new Database(path, { create: true });
    old.run(OLD);
    old.run("insert into users values ('u1', 'github', '1', 'Ada', null, 1, 1), ('u2', 'github', '2', 'Bob', null, 1, 1)");
    old.run("insert into space_members values ('priv', 'u1'), ('priv', 'u2')");
    old.close();
    const db = openAccounts(path);
    expect(spaceMembers(db, "priv").map((m) => [m.id, m.role])).toEqual([["u1", "owner"], ["u2", "owner"]]);
    expect(spaceVisibility(db, "priv")).toBe("private"); // not opened by the upgrade
    expect(spaceVisibility(db, "veille")).toBe("open"); // no row: open, nothing to migrate
    setSpace(db, "priv", { visibility: "open" });
    db.close();
    const again = openAccounts(path); // opening again changes nothing
    expect(spaceVisibility(again, "priv")).toBe("open");
    expect(spaceMembers(again, "priv").length).toBe(2);
    again.close();
  });

  test("the last owner cannot be removed or downgraded; with another owner, they can", () => {
    const db = openAccounts(join(tmp(), "a.db")), ada = user(db, "1"), bob = user(db, "2"), eve = user(db, "3");
    addSpaceMember(db, "s", ada, "owner"); addSpaceMember(db, "s", bob, "member");
    expect(removeSpaceMember(db, "s", ada)).toBe("last-owner");
    expect(setMemberRole(db, "s", ada, "member")).toBe("last-owner");
    expect(memberRole(db, "s", ada)).toBe("owner");
    expect(setMemberRole(db, "s", bob, "owner")).toBe("ok");
    expect(setMemberRole(db, "s", ada, "member")).toBe("ok"); // bob owns it too
    expect(removeSpaceMember(db, "s", bob)).toBe("last-owner");
    expect(removeSpaceMember(db, "s", ada)).toBe("ok"); // a plain member goes freely
    expect(removeSpaceMember(db, "s", eve)).toBe("unknown");
    addSpaceMember(db, "s", bob, "member"); // already in: keeps their role
    expect(memberRole(db, "s", bob)).toBe("owner");
    db.close();
  });

  test("an account that is the last owner of a space cannot be deleted; any other can, and leaves no membership behind", () => {
    const db = openAccounts(join(tmp(), "a.db")), ada = user(db, "1"), bob = user(db, "2");
    addSpaceMember(db, "s", ada, "owner"); addSpaceMember(db, "s", bob, "member"); addSpaceMember(db, "t", bob, "owner");
    expect(deleteUser(db, ada)).toEqual(["s"]);
    expect(deleteUser(db, bob)).toEqual(["t"]);
    expect(db.query("select count(*) as n from users").get()).toEqual({ n: 2 });
    setMemberRole(db, "s", bob, "owner");
    expect(deleteUser(db, ada)).toEqual([]); // not the last owner any more
    expect(spaceMembers(db, "s").map((m) => m.id)).toEqual([bob]);
    db.close();
  });

  test("forgetting a space removes its people, visibility and title: a later space of that name inherits nothing", () => {
    const db = openAccounts(join(tmp(), "a.db")), ada = user(db, "1");
    setSpace(db, "s", { visibility: "private", title: "Secret" }); addSpaceMember(db, "s", ada, "owner");
    forgetSpace(db, "s");
    expect([getSpace(db, "s"), spaceMembers(db, "s"), spaceVisibility(db, "s")]).toEqual([undefined, [], "open"]);
    db.close();
  });

  test("cortex space set and member: visibility, title and roles from the command line; list shows them", () => {
    const root = instance(["a", "b"], { default_space: "a" }), db = openAccounts(accountsFile(root));
    const ada = user(db, "1", "ada@example.org"), bob = user(db, "2", "bob@example.org");
    db.close();
    expect(cortex(root, ["space", "set", "a", "--visibility", "private", "--title", "  Ma   veille "]).code).toBe(0);
    let list = cortex(root, ["space", "list"]).out;
    expect(list).toContain('* a  private  "Ma veille"');
    expect(list).toContain("  b  open");
    expect(cortex(root, ["space", "member", "a", "add", "ADA@example.org", "--role", "owner"]).code).toBe(0); // by e-mail, any case
    expect(cortex(root, ["space", "member", "a", "add", bob]).code).toBe(0); // by id
    const members = cortex(root, ["space", "member", "a"]).out;
    expect(members).toMatch(/owner\s+1/);
    expect(members).toMatch(/member\s+2/);
    for (const args of [["remove", "ada@example.org"], ["add", "ada@example.org", "--role", "member"]]) { // the last owner
      const r = cortex(root, ["space", "member", "a", ...args]);
      expect([r.code, r.err]).toEqual([1, expect.stringContaining("last owner")]);
    }
    expect(cortex(root, ["space", "member", "a", "add", "bob@example.org", "--role", "owner"]).code).toBe(0); // an existing member is promoted
    expect(cortex(root, ["space", "member", "a", "remove", "ada@example.org"]).code).toBe(0);
    expect(cortex(root, ["space", "member", "a", "remove", "ada@example.org"]).code).toBe(2); // no longer a member
    expect(cortex(root, ["space", "member", "a", "add", "nobody@example.org"]).err).toContain("sign in once");
    expect(cortex(root, ["space", "member", "a", "add", "bob@example.org", "--role", "root"]).code).toBe(2);
    expect(cortex(root, ["space", "member", "nope", "add", "bob@example.org"]).code).toBe(2);
    expect(cortex(root, ["space", "set", "b", "--read-only", "true"]).code).toBe(0);
    expect(cortex(root, ["space", "list"]).out).toContain("  b  open  read-only");
    expect(cortex(root, ["space", "set", "b", "--read-only", "maybe"]).code).toBe(2);
    expect(cortex(root, ["space", "set", "b", "--read-only", "false"]).code).toBe(0);
    expect(cortex(root, ["space", "list"]).out).not.toContain("read-only");
    expect(cortex(root, ["space", "set", "a", "--visibility", "secret"]).code).toBe(2);
    expect(cortex(root, ["space", "set", "a"]).code).toBe(2);
    expect(cortex(root, ["space", "set", "a", "--visibility", "open", "--title", ""]).code).toBe(0);
    list = cortex(root, ["space", "list"]).out;
    expect(list).toContain("* a  open");
    expect(list).not.toContain("Ma veille");
    const check = openAccounts(accountsFile(root));
    expect(spaceMembers(check, "a").map((m) => [m.id, m.role])).toEqual([[bob, "owner"]]);
    check.close();
  });

  test("cortex space archive and restore: out of spaces/ and out of the lists, nothing else lost, the name stays taken", () => {
    const root = instance(["a", "b"], { default_space: "a" });
    writeFileSync(join(root, "spaces/a/wiki/p.md"), page);
    expect(cortex(root, ["space", "archive", "nope"]).code).toBe(2);
    expect(cortex(root, ["space", "archive", "a"]).code).toBe(0);
    expect(existsSync(join(root, "spaces/a"))).toBe(false);
    expect(JSON.parse(readFileSync(join(root, "cortex.json"), "utf8")).default_space ?? null).toBeNull();
    expect(cortex(root, ["space", "list"]).out).toBe("* b  open\n"); // the only one left is the default
    expect(cortex(root, ["--space", "a", "ls"]).code).toBe(2); // nothing reads it, search included
    expect(cortex(root, ["space", "list", "--archived"]).out).toMatch(/^a  archived \d{8}-\d{6}\n$/);
    const r = cortex(root, ["space", "add", "a"]);
    expect([r.code, r.err]).toEqual([2, expect.stringContaining("archived")]);
    expect(cortex(root, ["space", "restore", "a"]).code).toBe(0);
    expect(readFileSync(join(root, "spaces/a/wiki/p.md"), "utf8")).toBe(page);
    expect(cortex(root, ["space", "list"]).out).toContain("  a  open");
    expect(cortex(root, ["space", "list", "--archived"]).out).toContain("No archived space");
    expect(cortex(root, ["space", "restore", "a"]).code).toBe(2); // nothing archived any more
    expect(cortex(root, ["space", "restore", "b"]).code).toBe(2);
  });

  test("archiving keeps the people, visibility and title; a restored space gets them back", () => {
    const root = instance(["a", "b"]), db = openAccounts(accountsFile(root)), ada = user(db, "1");
    setSpace(db, "a", { visibility: "private", title: "Mine" }); addSpaceMember(db, "a", ada, "owner");
    db.close();
    expect(cortex(root, ["space", "archive", "a"]).code).toBe(0);
    let check = openAccounts(accountsFile(root));
    expect(getSpace(check, "a")).toMatchObject({ visibility: "private", title: "Mine", archived_at: expect.any(Number) });
    expect(spaceMembers(check, "a").map((m) => m.id)).toEqual([ada]);
    check.close();
    expect(cortex(root, ["space", "restore", "a"]).code).toBe(0);
    check = openAccounts(accountsFile(root));
    expect(getSpace(check, "a")).toMatchObject({ visibility: "private", title: "Mine", archived_at: null });
    expect(spaceMembers(check, "a").length).toBe(1);
    check.close();
  });

  test("cortex space add starts clean: nothing of an earlier space of that name is inherited", () => {
    const root = instance(["keep"]), db = openAccounts(accountsFile(root));
    const ada = user(db, "1");
    setSpace(db, "again", { visibility: "private", title: "Old" }); addSpaceMember(db, "again", ada, "owner");
    db.close();
    expect(cortex(root, ["space", "add", "again"]).code).toBe(0);
    const check = openAccounts(accountsFile(root));
    expect([getSpace(check, "again"), spaceMembers(check, "again")]).toEqual([undefined, []]);
    check.close();
  });
});
