import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import pkg from "../package.json";

declare global {
  /** Sources tarball (.tar.gz, base64), set by src/bin.ts in the distributed builds only. */
  var CORTEX_PAYLOAD: string | undefined;
  /** How this cortex was installed, set by src/bin.ts; undefined when run from the sources. */
  var CORTEX_DIST: "binary" | "bundle" | undefined;
}

const asBun = { ...process.env, BUN_BE_BUN: "1" }; // the compiled binary behaves as the bun it embeds (no effect on a real bun)

/**
 * In a distributed build (binary or cortex.js bundle), runs this command from the embedded sources: Vite (cortex export) needs real files and its
 * native bindings on disk. Once per build, the tarball is extracted to ~/.cache/cortex/<version>-<hash>/ and the locked
 * dependencies are installed there (network needed that one time); then cortex reruns itself on those sources, with
 * the bun it embeds (binary) or the one running it (bundle). Returns the exit code.
 */
export async function runFromSources(root: string): Promise<number> {
  const payload = globalThis.CORTEX_PAYLOAD;
  if (!payload) throw new Error("build without embedded sources: rebuild it with scripts/build.sh.");
  const bytes = Buffer.from(payload, "base64");
  const cache = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  const dir = join(cache, "cortex", `${pkg.version}-${new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 12)}`);
  if (!existsSync(dir)) {
    // extracted next to its final place, then renamed: a half-extracted folder is never taken for a complete one
    const tmp = `${dir}.tmp-${process.pid}`;
    mkdirSync(tmp, { recursive: true });
    try {
      await new Bun.Archive(bytes).extract(tmp);
      console.error("First export of this version: installing the site's dependencies (once)…");
      const install = Bun.spawn([process.execPath, "install", "--frozen-lockfile", "--production", "--omit", "optional"], { cwd: tmp, env: asBun, stdio: ["ignore", "inherit", "inherit"] });
      if ((await install.exited) !== 0) throw new Error("could not install the dependencies (network?): rerun cortex export.");
      renameSync(tmp, dir);
      // ponytail: no lock; a different build exporting at this very moment loses its folder and fails (rerun it).
      // a new build is in place: earlier versions (~170 MB each) go; folders being extracted (.tmp-) stay unless abandoned for over an hour
      for (const old of readdirSync(dirname(dir))) {
        const p = join(dirname(dir), old);
        if (old !== basename(dir) && (!old.includes(".tmp-") || Date.now() - statSync(p).mtimeMs > 3_600_000)) rmSync(p, { recursive: true, force: true });
      }
    } catch (e) {
      rmSync(tmp, { recursive: true, force: true });
      if (!existsSync(dir)) throw e; // otherwise a concurrent run extracted it first
    }
  }
  const p = Bun.spawn([process.execPath, join(dir, "src/cortex.ts"), ...process.argv.slice(2)], {
    env: { ...asBun, CORTEX_ROOT: root },
    stdio: ["inherit", "inherit", "inherit"],
  });
  return p.exited;
}
