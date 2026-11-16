import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Git sync of a wiki checkout, shared by `cortex serve --sync`, `cortex share` and `cortex remote-exec` (a command
 * forwarded from another machine, docs/REMOTE-PLAN.md). `pullRebase` / `commitAndPush` keep serve's behaviour (a
 * conflict resets to the remote: one click lost at most). `withSync` is the CLI's: it never discards anything.
 */

export const git = (root: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", "-C", root, ...args], { stderr: "pipe", stdout: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString().trim();
};
let lastError = "";
const tryGit = (root: string, ...args: string[]) => { try { git(root, ...args); return true; } catch (e) { lastError = (e as Error).message.split("\n").at(-1) ?? ""; return false; } };

/**
 * Pull with rebase: local commits a failed push left behind go on top of the remote, pushed by the next change.
 * A conflict leaves the checkout at the remote (local commits dropped) rather than stuck in a rebase.
 */
export function pullRebase(root: string) {
  try { git(root, "pull", "-q", "--rebase"); }
  catch (e) {
    try { git(root, "rebase", "--abort"); } catch {}
    git(root, "reset", "-q", "--hard", "@{u}");
    throw new Error(`conflict with the remote, change dropped: ${(e as Error).message}`);
  }
}

/** Commit `paths` (default `wiki/`) and push to the checkout's remote, whatever it is; a rejected push is rebased once (`pullRebase`). */
export function commitAndPush(root: string, message: string, paths = ["wiki"], who = "cortex-serve") {
  git(root, "add", "--", ...paths);
  git(root, "-c", `user.name=${who}`, "-c", `user.email=${who}@localhost`, "commit", "-q", "-m", message);
  try { git(root, "push", "-q"); return; } catch {}
  pullRebase(root);
  git(root, "push", "-q");
}

/** What a command may change in a wiki checkout, and nothing else is ever committed. */
export const SYNC_PATHS = ["raw", "wiki", "cortex.json", "CLAUDE.md", "AGENTS.md"];
const WHO = "cortex-remote";

/** Changed paths among SYNC_PATHS (untracked files one by one; the new name of a rename). */
export function changedPaths(root: string): string[] {
  const r = Bun.spawnSync(["git", "-C", root, "status", "--porcelain=v1", "-z", "-uall", "--", ...SYNC_PATHS], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git status: ${r.stderr.toString().trim()}`);
  // -z: "XY path", NUL-separated, unquoted; a rename or copy is followed by its old name, staged too
  const out: string[] = [], parts = r.stdout.toString().split("\0").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    out.push(parts[i]!.slice(3));
    if (/^[RC]/.test(parts[i]!)) out.push(parts[++i]!);
  }
  return out;
}

/** Commit message of a synced command: English subject, one line per path (at most 50). */
export function syncMessage(cmd: string, paths: string[], status: "ok" | "failed" | "interrupted" = "ok"): string {
  const n = paths.length, what = `${n} file${n > 1 ? "s" : ""} changed`;
  const subject = status === "interrupted" ? `cortex: changes left by an interrupted command (${what})`
    : `cortex ${cmd}: ${what}${status === "failed" ? " (the command failed)" : ""}`;
  const shown = paths.slice(0, 50).map((p) => `- ${p}`);
  if (n > 50) shown.push(`- … and ${n - 50} more`);
  return `${subject}\n\n${shown.join("\n")}`;
}

function commitChanges(root: string, message: (paths: string[]) => string): boolean {
  const paths = changedPaths(root);
  if (!paths.length) return false;
  git(root, "add", "-A", "--", ...paths);
  git(root, "-c", `user.name=${WHO}`, "-c", `user.email=${WHO}@localhost`, "commit", "-q", "-m", message(paths));
  return true;
}

const ahead = (root: string) => Number(git(root, "rev-list", "--count", "@{u}..HEAD"));
const stamp = (d = new Date()) => d.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");

/** Local commits that cannot be rebased on the remote go to a branch of their own there; the checkout returns to the remote. */
function savePending(root: string, say: (m: string) => void, now: Date) {
  const branch = `cortex/pending-${stamp(now)}`;
  git(root, "push", "-q", "origin", `HEAD:refs/heads/${branch}`); // throws (offline): the commits stay local, retried next time
  git(root, "reset", "-q", "--hard", "@{u}");
  say(`conflict with the remote: the changes are kept on branch ${branch} of the remote, to merge by hand.`);
}

/** Pull (rebase), then push local commits. Never drops a commit: a conflict saves them on a pending branch. */
export function syncUp(root: string, say: (m: string) => void, now = new Date()) {
  if (!tryGit(root, "pull", "-q", "--rebase")) {
    tryGit(root, "rebase", "--abort");
    if (!ahead(root)) throw new Error(`git pull failed, nothing was run: ${lastError}`);
    savePending(root, say, now);
    return;
  }
  if (!ahead(root)) return;
  if (tryGit(root, "push", "-q")) return;
  if (tryGit(root, "pull", "-q", "--rebase") && tryGit(root, "push", "-q")) return;
  tryGit(root, "rebase", "--abort");
  savePending(root, say, now);
}

/** Whether `root` is a git checkout whose branch tracks a remote one: only then is there anything to sync. */
export const hasUpstream = (root: string) => tryGit(root, "rev-parse", "--abbrev-ref", "@{u}");

type LockInfo = { pid: number; cmd: string; at: string };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as { code?: string }).code === "EPERM"; } };

/**
 * One synced command at a time per checkout: an atomic `mkdir` of `.git/cortex.lock`, holding the pid, command and start.
 * A lock whose pid is dead is taken over; a live one is waited for, said once on `say`. Returns the release function.
 */
export async function lock(root: string, cmd: string, say: (m: string) => void, pollMs = 300): Promise<() => void> {
  const dir = join(resolve(root, git(root, "rev-parse", "--git-dir")), "cortex.lock"), info = join(dir, "info.json");
  let told = false;
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(info, JSON.stringify({ pid: process.pid, cmd, at: new Date().toISOString() } satisfies LockInfo));
      return () => rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      if ((e as { code?: string }).code !== "EEXIST") throw e;
    }
    let held: LockInfo | undefined;
    try { held = JSON.parse(readFileSync(info, "utf8")); } catch {}
    // no info: being written right now, or a holder killed between mkdir and write (then stale after a few seconds)
    const stale = held ? !alive(held.pid) : Date.now() - (statSync(dir, { throwIfNoEntry: false })?.mtimeMs ?? 0) > 5000;
    if (stale) { rmSync(dir, { recursive: true, force: true }); continue; }
    if (held && !told) {
      const t = new Date(held.at);
      say(`waiting: cortex ${held.cmd} (started ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}) is using the wiki`);
      told = true;
    }
    await Bun.sleep(pollMs);
  }
}

/**
 * Runs `fn` (a command on the checkout) synced with the remote, under the lock: leftovers of an interrupted command
 * committed, pull, run, then whatever changed committed (even when `fn` fails) and pushed. Without an upstream, `fn`
 * just runs. `say` goes to stderr in the CLI: stdout stays the command's own (MCP, --json).
 */
export async function withSync<T>(root: string, cmd: string, fn: () => Promise<T>, say: (m: string) => void = (m) => console.error(m), isFailure: (r: T) => boolean = () => false): Promise<T> {
  if (!hasUpstream(root)) return fn();
  const release = await lock(root, cmd, say);
  try {
    commitChanges(root, (p) => syncMessage(cmd, p, "interrupted"));
    syncUp(root, say);
    let result: T, error: unknown, failed = false;
    try { result = await fn(); failed = isFailure(result); } catch (e) { error = e; failed = true; }
    commitChanges(root, (p) => syncMessage(cmd, p, failed ? "failed" : "ok"));
    syncUp(root, say);
    if (error !== undefined) throw error;
    return result!;
  } finally { release(); }
}
