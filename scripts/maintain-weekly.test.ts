import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// scripts/maintain-weekly.sh on a real git clone of a real (empty) wiki. `cortex maintain <task>` is a stub that records its
// calls and, for `merge --apply`, writes a page (and a cache file under .cortex/); every other cortex command is the real one,
// so the journal line is written by `cortex log add`.
const SCRIPT = join(import.meta.dir, "maintain-weekly.sh"), CORTEX = join(import.meta.dir, "../src/cortex.ts");
const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); });

const sh = (cwd: string, cmd: string[], env: Record<string, string> = {}) => {
  const r = Bun.spawnSync(cmd, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", ...env }, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};
const git = (cwd: string, ...a: string[]) => sh(cwd, ["git", ...a]);

/** A wiki clone on `main` with a bare remote, and the stub: `fail` = the subtasks that exit 1, `write` = the ones that write a page. */
function setup(o: { fail?: string[]; write?: string[] } = {}) {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cortex-maintain-"));
  dirs.push(dir);
  const wiki = join(dir, "wiki-clone"), remote = join(dir, "remote.git"), calls = join(dir, "calls.log"), stub = join(dir, "cortex");
  mkdirSync(wiki);
  git(dir, "init", "-q", "--bare", "-b", "main", remote);
  sh(wiki, ["bun", CORTEX, "config", "init", "openai"], { CORTEX_ROOT: wiki });
  git(wiki, "init", "-q", "-b", "main");
  git(wiki, "remote", "add", "origin", remote);
  git(wiki, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A");
  git(wiki, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  git(wiki, "push", "-q", "origin", "main");
  writeFileSync(stub, `#!/usr/bin/env bash
if [ "$1" = maintain ]; then
  echo "$@" >> "${calls}"
  case " ${(o.write ?? []).join(" ")} " in *" $2 "*) [ "$3" = --apply ] && { mkdir -p wiki/concepts .cortex; echo "# $2" > "wiki/concepts/$2.md"; echo '{}' > .cortex/maintain.json; } ;; esac
  case " ${(o.fail ?? []).join(" ")} " in *" $2 "*) exit 1 ;; esac
  exit 0
fi
exec bun "${CORTEX}" "$@"
`);
  chmod(stub);
  const run = (args: string[] = [], env: Record<string, string> = {}) =>
    sh(wiki, ["bash", SCRIPT, ...args], { CORTEX_BIN: stub, MAINTAIN_DATE: "2026-11-08", ...env });
  const called = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []);
  return { wiki, remote, run, called };
}
const chmod = (f: string) => chmodSync(f, 0o755);
const branches = (cwd: string) => git(cwd, "branch", "--format", "%(refname:short)").out.trim().split("\n").sort();

test("every subtask runs with --apply, the changes land in one commit on maintain/<date> (cache excluded), the journal says it, the base is back, nothing pushed", () => {
  const t = setup({ write: ["merge"] });
  const r = t.run();
  expect(r.code).toBe(0);
  expect(t.called()).toEqual(["maintain merge --apply", "maintain contradictions --apply", "maintain split --apply", "maintain synthesize --apply"]);
  expect(git(t.wiki, "symbolic-ref", "--short", "HEAD").out.trim()).toBe("main");
  expect(branches(t.wiki)).toEqual(["main", "maintain/2026-11-08"]);
  const files = git(t.wiki, "show", "--name-only", "--format=%an|%s|%b", "maintain/2026-11-08").out;
  expect(files).toContain("cortex-maintain|maintain: 2026-11-08|Maintenance hebdomadaire du 2026-11-08 : merge contradictions split synthesize terminées ; ");
  expect(files).toContain("wiki/concepts/merge.md");
  expect(files).toContain("wiki/log.jsonl"); // the journal line, in the same commit
  expect(files).not.toContain(".cortex");
  expect(existsSync(join(t.wiki, "wiki/log.jsonl"))).toBe(false); // base branch checked out: the line is on the branch only
  expect(git(t.remote, "branch", "--format", "%(refname:short)").out.trim()).toBe("main");
  expect(git(t.wiki, "show", "maintain/2026-11-08:wiki/log.jsonl").out).toContain('"kind":"update"');
});

test("a failing subtask does not stop the others: what they wrote is committed, the exit code is 1 and the journal names it", () => {
  const t = setup({ write: ["split"], fail: ["merge"] });
  const r = t.run();
  expect(r.code).toBe(1);
  expect(t.called()).toHaveLength(4);
  expect(git(t.wiki, "log", "-1", "--format=%b", "maintain/2026-11-08").out).toContain("contradictions split synthesize terminées, en échec : merge ;");
});

test("nothing written: no branch is left, no commit, exit 0 (1 when a subtask failed)", () => {
  const t = setup();
  expect(t.run().code).toBe(0);
  expect(branches(t.wiki)).toEqual(["main"]);
  expect(git(t.wiki, "rev-list", "--count", "main").out.trim()).toBe("1");
  const f = setup({ fail: ["split"] });
  expect(f.run().code).toBe(1);
  expect(branches(f.wiki)).toEqual(["main"]);
});

test("--push sends the branch (not main's history, no force) to the remote; MAINTAIN_PUSH=1 does the same", () => {
  const t = setup({ write: ["merge"] });
  expect(t.run(["--push"]).code).toBe(0);
  expect(git(t.remote, "branch", "--format", "%(refname:short)").out.trim().split("\n").sort()).toEqual(["main", "maintain/2026-11-08"]);
  const u = setup({ write: ["merge"] });
  expect(u.run([], { MAINTAIN_PUSH: "1" }).code).toBe(0);
  expect(git(u.remote, "branch", "--format", "%(refname:short)").out).toContain("maintain/2026-11-08");
});

test("a failed push stays local and is reported (exit 2); the base is checked out again", () => {
  const t = setup({ write: ["merge"] });
  git(t.wiki, "remote", "set-url", "origin", "/nonexistent/remote.git");
  const r = t.run(["--push"], { MAINTAIN_NO_SYNC: "1" });
  expect(r.code).toBe(2);
  expect(r.err).toContain("push of maintain/2026-11-08");
  expect(git(t.wiki, "symbolic-ref", "--short", "HEAD").out.trim()).toBe("main");
  expect(branches(t.wiki)).toContain("maintain/2026-11-08");
});

test("an unmerged maintenance branch blocks the next run (no piling) until it is merged", () => {
  const t = setup({ write: ["merge"] });
  t.run();
  const again = t.run([], { MAINTAIN_DATE: "2026-11-15" });
  expect(again.code).toBe(3); // visible: the unit shows as failed until the branch is reviewed
  expect(again.out).toContain("waiting for the review of: maintain/2026-11-08");
  expect(branches(t.wiki)).toEqual(["main", "maintain/2026-11-08"]);
  expect(t.called()).toHaveLength(4); // the second run launched nothing
  git(t.wiki, "-c", "user.name=t", "-c", "user.email=t@t", "merge", "-q", "--ff-only", "maintain/2026-11-08");
  expect(t.run([], { MAINTAIN_DATE: "2026-11-15", MAINTAIN_NO_SYNC: "1" }).code).toBe(0);
  expect(t.called()).toHaveLength(8);
});

test("a branch merged by squash (or rebase) is seen as merged: deleted, the run goes on", () => {
  const t = setup({ write: ["merge"] });
  t.run();
  const id = ["-c", "user.name=t", "-c", "user.email=t@t"];
  git(t.wiki, ...id, "merge", "-q", "--squash", "maintain/2026-11-08");
  git(t.wiki, ...id, "commit", "-q", "-m", "squash");
  git(t.wiki, "push", "-q", "origin", "main");
  expect(git(t.wiki, "branch", "--no-merged", "main", "--format", "%(refname:short)").out).toContain("maintain/2026-11-08"); // git itself says unmerged
  const again = t.run([], { MAINTAIN_DATE: "2026-11-15" });
  expect(again.code).toBe(0);
  expect(again.out).toContain("already in main");
  expect(t.called()).toHaveLength(8);
  expect(branches(t.wiki)).not.toContain("maintain/2026-11-08");
});

test("a dirty clone is refused (exit 2) before anything runs; .cortex/ alone does not count as dirty", () => {
  const t = setup();
  mkdirSync(join(t.wiki, ".cortex"));
  writeFileSync(join(t.wiki, ".cortex/maintain.json"), "{}");
  expect(t.run().code).toBe(0);
  writeFileSync(join(t.wiki, "stray.md"), "x");
  const r = t.run();
  expect(r.code).toBe(2);
  expect(r.err).toContain("uncommitted changes");
  expect(t.called()).toHaveLength(4); // only the first run's calls
});

test("--dry-run lists every subtask without --apply and touches nothing (no branch, even in a dirty clone)", () => {
  const t = setup({ write: ["merge"] });
  writeFileSync(join(t.wiki, "stray.md"), "x");
  const r = t.run(["--dry-run"]);
  expect(r.code).toBe(0);
  expect(t.called()).toEqual(["maintain merge", "maintain contradictions", "maintain split", "maintain synthesize"]);
  expect(branches(t.wiki)).toEqual(["main"]);
});

test("MAINTAIN_LIMIT is passed to every subtask", () => {
  const t = setup();
  t.run([], { MAINTAIN_LIMIT: "5" });
  expect(t.called()).toEqual(["maintain merge --apply --limit 5", "maintain contradictions --apply --limit 5", "maintain split --apply --limit 5", "maintain synthesize --apply --limit 5"]);
});
