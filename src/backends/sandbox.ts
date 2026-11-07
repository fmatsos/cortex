import { realpathSync } from "node:fs";
import { join } from "node:path";
import type { Mode } from "./backend";

/**
 * Confines an agent command: whole repo read-only, except wiki/ in write mode.
 * Applies to any CLI (default engine, interactive sessions); the rest of the system stays writable
 * (the agent's own state: ~/.claude, ~/.codex…).
 * Linux: bubblewrap. macOS: sandbox-exec (Seatbelt, the one Codex and Claude Code use).
 */
export function confine(root: string, cmd: string[], mode: Mode): string[] {
  const r = realpathSync(root); // macOS: /var → /private/var, the profile must target the real path
  const wiki = join(r, "wiki");
  if (process.platform === "darwin") {
    const q = (p: string) => JSON.stringify(p); // quoted, escaped SBPL string
    const write = mode === "write" ? `(require-not (subpath ${q(wiki)}))` : "";
    const profile = `(version 1)(allow default)(deny file-write* (require-all (subpath ${q(r)}) ${write}))`;
    return ["sandbox-exec", "-p", profile, ...cmd];
  }
  if (!Bun.which("bwrap")) throw new Error("bubblewrap (bwrap) not found: it confines the agent to wiki/. Install it (apt install bubblewrap).");
  return ["bwrap", "--dev-bind", "/", "/", "--ro-bind", r, r, ...(mode === "write" ? ["--bind", wiki, wiki] : []), "--die-with-parent", "--", ...cmd];
}
