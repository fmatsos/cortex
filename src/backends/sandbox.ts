import { existsSync, realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { findInstance, isMultiSpace, listSpaces } from "../lib";
import type { Mode } from "./backend";

/**
 * Confines an agent command: whole repo read-only, except wiki/ in write mode. In a multi-space instance the confined
 * folder is the whole instance (the agent of a space writes nothing outside its wiki/, config and accounts included) and
 * the other spaces are neither readable nor writable.
 * `allowed` (a question that reads several spaces, `ask --space a,b`): read mode only, from the instance (or any folder of it): the instance is
 * read-only, and every space not in the list is hidden as well, with the archived ones (`.cortex/archive/`), the accounts' database and the
 * instance's own `.git` (it holds every space's committed pages: `git show HEAD:spaces/<other>/…` would read them), whatever folder the command runs in. The
 * `.git` of an allowed space that is its own repository stays. The list is the sandbox's, not an option of the command: nothing the agent runs can widen it.
 * Applies to any CLI (default engine, interactive sessions); the rest of the system stays writable
 * (the agent's own state: ~/.claude, ~/.codex…).
 * Linux: bubblewrap. macOS: sandbox-exec (Seatbelt, the one Codex and Claude Code use).
 */
export function confine(root: string, cmd: string[], mode: Mode, allowed?: string[]): string[] {
  const r = realpathSync(root); // macOS: /var → /private/var, the profile must target the real path
  const wiki = join(r, "wiki");
  const inst = findInstance(r);
  let base: string, hidden: string[];
  if (allowed) {
    if (mode !== "read") throw new Error("a question that reads several spaces never writes.");
    if (!inst || !isMultiSpace(inst)) throw new Error("several spaces: this is not a multi-space instance.");
    base = inst;
    const db = join(inst, ".cortex/accounts.db"), keep = new Set(allowed);
    hidden = [...listSpaces(inst).filter((n) => !keep.has(n)).map((n) => join(inst, "spaces", n)), join(inst, ".cortex/archive"), join(inst, ".git"), db, `${db}-wal`, `${db}-shm`, `${db}-journal`].filter((p) => existsSync(p));
  } else {
    const [dir, name] = inst && isMultiSpace(inst) ? relative(inst, r).split(sep) : [];
    base = dir === "spaces" && name ? inst! : r; // the folder that is read-only
    hidden = base === r ? [] : listSpaces(base).filter((n) => n !== name).map((n) => join(base, "spaces", n));
  }
  if (process.platform === "darwin") {
    const q = (p: string) => JSON.stringify(p); // quoted, escaped SBPL string
    const write = mode === "write" ? `(require-not (subpath ${q(wiki)}))` : "";
    const hide = hidden.map((p) => `(deny file-read* (subpath ${q(p)}))`).join("");
    const profile = `(version 1)(allow default)(deny file-write* (require-all (subpath ${q(base)}) ${write}))${hide}`;
    return ["sandbox-exec", "-p", profile, ...cmd];
  }
  if (!Bun.which("bwrap")) throw new Error("bubblewrap (bwrap) not found: it confines the agent to wiki/. Install it (apt install bubblewrap).");
  // what is hidden comes after the read-only bind (it masks what is under it): a folder by an empty tmpfs, a file by /dev/null; the writable wiki/ last
  const mask = hidden.flatMap((p) => (statSync(p).isDirectory() ? ["--tmpfs", p] : ["--ro-bind", "/dev/null", p]));
  return ["bwrap", "--dev-bind", "/", "/", "--ro-bind", base, base, ...mask, ...(mode === "write" ? ["--bind", wiki, wiki] : []), "--die-with-parent", "--", ...cmd];
}
