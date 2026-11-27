import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { regenerateCtx } from "./catalog";
import { BUILT_IN_SCHEMAS, configFile, lintConfig, readConfig, writeConfig } from "./config";
import { openWiki } from "./context";
import { CortexError, isMultiSpace, listSpaces, spaceRoot, SPACE_NAME } from "./lib";
import { writeSchema } from "./schema";
import { paint } from "./style";
import { git } from "./sync";

const usage = (msg: string) => new CortexError(msg, "usage");
const USAGE = "Usage: cortex space list | add <name> [--repo <git url>] [--schema notes] | migrate <name>";

/** What a space owns at the instance root of a legacy wiki (everything else there is shared by the instance). */
const SPACE_PATHS = ["wiki", "raw", "paths", "inbox"];
/** `.cortex/` of the instance keeps the accounts (one database for all the spaces); the rest (search index, judge scores, blobs, site builds) is per space. */
const INSTANCE_STATE = /^accounts\.db(-wal|-shm)?$/;

const checkName = (name?: string) => {
  if (!name || !SPACE_NAME.test(name)) throw usage(`invalid space name "${name ?? ""}": lowercase letters, digits and dashes, at most 40, starting with a letter or digit.`);
  return name;
};

/** Creates `spaces/<name>/` (an empty wiki, or the clone of `repo`) with its agent file: what `cortex space add` does, and `POST /api/spaces` of `cortex serve` (never with a repo). `schema` is recorded under `spaces.<name>`. */
export async function addSpace(instance: string, name: string | undefined, repo?: string, schema?: string) {
  checkName(name);
  const dir = spaceRoot(instance, name!);
  if (existsSync(dir)) throw usage(`space ${name} already exists.`);
  if (schema) { // checked before anything is created: a bad value must not leave a half-made space
    const e = lintConfig({ spaces: { [name!]: { schema } } }).find((i) => i.level === "error");
    if (e) throw usage(e.msg);
    if (!(BUILT_IN_SCHEMAS as readonly string[]).includes(schema) && !existsSync(resolve(instance, schema))) throw usage(`schema not found: ${schema} (relative to the instance root).`);
  }
  if (!isMultiSpace(instance) && (existsSync(join(instance, "wiki")) || existsSync(join(instance, "raw"))))
    throw usage(`this wiki has wiki/ and raw/ at its root: cortex space migrate <name> moves them into a space first.`);
  mkdirSync(join(instance, "spaces"), { recursive: true });
  if (repo) git(instance, "clone", "--", repo, join("spaces", name!));
  const fresh = !existsSync(join(dir, "wiki"));
  mkdirSync(join(dir, "wiki"), { recursive: true });
  mkdirSync(join(dir, "raw"), { recursive: true });
  if (fresh) { // an empty space: raw/ must exist in git, wiki/ gets its index and journal
    await Bun.write(join(dir, "raw/.gitkeep"), "");
    await regenerateCtx(openWiki(dir));
  }
  if (repo) { // the instance's own git must not see the clone
    const ignore = join(instance, ".gitignore"), text = existsSync(ignore) ? readFileSync(ignore, "utf8") : "", line = `/spaces/${name}/`;
    if (!text.split("\n").includes(line)) writeFileSync(ignore, `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`);
  }
  if (repo || schema) {
    const config = await readConfig(instance);
    await writeConfig(configFile(instance), { ...config, spaces: { ...(config.spaces as object), [name!]: { ...(repo && { repo }), ...(schema && { schema }) } } });
  }
  await writeSchema(dir, false); // the agent file of this space (CLAUDE.md or AGENTS.md), from its effective schema
}

/** cortex space list|add|migrate, run at the instance root (the folder holding cortex.json). */
export async function spaceCmd(instance: string, [sub, name]: string[], opts: { repo?: string; schema?: string }) {
  switch (sub) {
    case "list": {
      const config = await readConfig(instance), names = listSpaces(instance);
      const def = typeof config.default_space === "string" ? config.default_space : names.length === 1 ? names[0] : undefined;
      if (!names.length) console.log(paint.dim("No space (cortex space add <name>)."));
      for (const n of names) console.log(`${n === def ? "*" : " "} ${n}${existsSync(join(spaceRoot(instance, n), ".git")) ? paint.dim("  (own repo)") : ""}`);
      return;
    }
    case "add":
      await addSpace(instance, name, opts.repo, opts.schema);
      console.log(`${paint.ok("✓")} space ${name} created${opts.repo ? ` (own repo: ${opts.repo})` : ""}${opts.schema ? ` (schema: ${opts.schema})` : ""}: spaces/${name}/`);
      return;
    case "migrate": {
      checkName(name);
      if (isMultiSpace(instance)) throw usage("spaces/ already exists: nothing to migrate.");
      const present = SPACE_PATHS.filter((p) => existsSync(join(instance, p)));
      if (!present.includes("wiki") && !present.includes("raw")) throw usage("no wiki/ nor raw/ at the root: nothing to migrate (cortex space add <name>).");
      const dir = spaceRoot(instance, name!), inGit = Bun.spawnSync(["git", "-C", instance, "rev-parse", "--is-inside-work-tree"], { stdout: "pipe", stderr: "pipe" }).exitCode === 0;
      mkdirSync(join(dir, ".cortex"), { recursive: true });
      for (const p of present) {
        // git mv keeps the history of what is tracked; anything else (untracked files, ignored folders) is a plain rename
        if (inGit && git(instance, "ls-files", "--", p)) git(instance, "mv", p, join("spaces", name!, p));
        else renameSync(join(instance, p), join(dir, p));
      }
      if (existsSync(join(instance, ".cortex")))
        for (const f of readdirSync(join(instance, ".cortex")).filter((f) => !INSTANCE_STATE.test(f))) renameSync(join(instance, ".cortex", f), join(dir, ".cortex", f));
      const config = await readConfig(instance);
      if (config.default_space == null) await writeConfig(configFile(instance), { ...config, default_space: name });
      console.log(`${paint.ok("✓")} moved ${present.map((p) => `${p}/`).join(", ")} into spaces/${name}/${inGit ? " (git mv: commit the move)" : ""}.`);
      return;
    }
    default:
      throw usage(USAGE);
  }
}
