import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountsFile } from "./accounts";
import { confine } from "./backends/sandbox";
import { configFile, lintConfig, loadConfig } from "./config";
import { findRoot, instanceRoot, listSpaces } from "./lib";
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
    expect(errors({ spaces: { a: { repo: "x", branch: "y" } } }).length).toBe(1); // strict: only repo
  });
});

describe("cortex space", () => {
  test("add creates an empty space with its index and journal; list marks the default; a name is validated", () => {
    const root = tmp();
    writeFileSync(join(root, "cortex.json"), "{}");
    expect(cortex(root, ["space", "add", "veille"]).out).toContain("space veille created");
    expect(existsSync(join(root, "spaces/veille/wiki/index.md"))).toBe(true);
    expect(existsSync(join(root, "spaces/veille/raw/.gitkeep"))).toBe(true);
    expect(cortex(root, ["space", "add", "veille"]).code).toBe(2); // exists
    expect(cortex(root, ["space", "add", "Bad Name"]).code).toBe(2);
    expect(cortex(root, ["space", "add", "pro"]).code).toBe(0);
    expect(cortex(root, ["space", "list"]).out).toBe("  pro\n  veille\n");
    writeFileSync(join(root, "cortex.json"), '{"default_space":"veille"}');
    expect(cortex(root, ["space", "list"]).out).toBe("  pro\n* veille\n");
    expect(cortex(root, ["space", "nope"]).code).toBe(2);
    // from inside a space, `space` still acts on the instance
    expect(cortex(join(root, "spaces/pro"), ["space", "list"]).out).toBe("  pro\n* veille\n");
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
    for (const f of [".cortex/accounts.db", ".cortex/accounts.db-wal", ".cortex/search.db", ".cortex/judge.db", ".cortex/serve/a/x"]) writeFileSync(join(root, f), "d");
    const r = cortex(root, ["space", "migrate", "veille"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("spaces/veille/");
    for (const f of ["wiki/concepts/a.md", "wiki/untracked/u.md", "raw/r1/source.md", "paths/p.md", ".cortex/search.db", ".cortex/judge.db", ".cortex/serve/a/x"]) {
      expect(existsSync(join(root, "spaces/veille", f))).toBe(true);
      expect(existsSync(join(root, f))).toBe(false);
    }
    expect(existsSync(join(root, ".cortex/accounts.db"))).toBe(true);
    expect(existsSync(join(root, ".cortex/accounts.db-wal"))).toBe(true);
    expect(existsSync(join(root, "wiki"))).toBe(false);
    expect(sh(root, "status", "--porcelain")).toContain("R  wiki/concepts/a.md -> spaces/veille/wiki/concepts/a.md"); // history kept
    expect(JSON.parse(readFileSync(join(root, "cortex.json"), "utf8")).default_space).toBe("veille");
    expect(cortex(root, ["ls"]).out).toContain("T"); // the default space now answers
    expect(cortex(root, ["space", "migrate", "other"]).code).toBe(2); // spaces/ exists: refused
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
