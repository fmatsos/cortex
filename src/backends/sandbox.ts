import { realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { findInstance, isMultiSpace, listSpaces } from "../lib";
import type { Mode } from "./backend";

/**
 * Confines an agent command: whole repo read-only, except wiki/ in write mode. In a multi-space instance the confined
 * folder is the whole instance (the agent of a space writes nothing outside its wiki/, config and accounts included) and
 * the other spaces are neither readable nor writable.
 * Applies to any CLI (default engine, interactive sessions); the rest of the system stays writable
 * (the agent's own state: ~/.claude, ~/.codex…).
 * Linux: bubblewrap. macOS: sandbox-exec (Seatbelt, the one Codex and Claude Code use).
 */
export function confine(root: string, cmd: string[], mode: Mode): string[] {
  const r = realpathSync(root); // macOS: /var → /private/var, the profile must target the real path
  const wiki = join(r, "wiki");
  const inst = findInstance(r), [dir, name] = inst && isMultiSpace(inst) ? relative(inst, r).split(sep) : [];
  const base = dir === "spaces" && name ? inst! : r; // the folder that is read-only
  const others = base === r ? [] : listSpaces(base).filter((n) => n !== name).map((n) => join(base, "spaces", n));
  if (process.platform === "darwin") {
    const q = (p: string) => JSON.stringify(p); // quoted, escaped SBPL string
    const write = mode === "write" ? `(require-not (subpath ${q(wiki)}))` : "";
    const hide = others.map((p) => `(deny file-read* (subpath ${q(p)}))`).join("");
    const profile = `(version 1)(allow default)(deny file-write* (require-all (subpath ${q(base)}) ${write}))${hide}`;
    return ["sandbox-exec", "-p", profile, ...cmd];
  }
  if (!Bun.which("bwrap")) throw new Error("bubblewrap (bwrap) not found: it confines the agent to wiki/. Install it (apt install bubblewrap).");
  // the tmpfs come after the read-only bind (they mask what is under it), the writable wiki/ last
  return ["bwrap", "--dev-bind", "/", "/", "--ro-bind", base, base, ...others.flatMap((p) => ["--tmpfs", p]), ...(mode === "write" ? ["--bind", wiki, wiki] : []), "--die-with-parent", "--", ...cmd];
}
