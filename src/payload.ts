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

/**
 * What `bun install` fetches but cortex never loads from the payload's node_modules, deleted once installed (about 400 MB of 600): the
 * ONNX runtime of the other platforms (only <os>/<arch> is run), source maps and TypeScript declarations (nothing compiles or debugs
 * the dependencies), the tests that packages ship. `onnxruntime-web` is not here: it is replaced by an empty package (package.json "overrides"), so it is not even downloaded.
 */
const PRUNE = {
  /** Folders of a package that are not the one of the machine running cortex. */
  otherPlatforms: ["onnxruntime-node/bin/napi-v*/*/*"],
  /** Files and folders to delete wherever they are in node_modules. */
  everywhere: "**/{*.map,*.d.ts,*.d.mts,*.d.cts,test,tests,__tests__}",
};

/** Deletes what PRUNE lists from `<dir>/node_modules`. Best effort: a file that stays only costs disk. */
export function pruneModules(dir: string, platform = process.platform, arch = process.arch): void {
  const modules = join(dir, "node_modules");
  const keep = `/${platform}/${arch}`;
  const doomed = [
    ...PRUNE.otherPlatforms.flatMap((g) => [...new Bun.Glob(g).scanSync({ cwd: modules, onlyFiles: false })].filter((d) => !d.endsWith(keep))),
    ...new Bun.Glob(PRUNE.everywhere).scanSync({ cwd: modules, onlyFiles: false, dot: true }),
  ];
  for (const d of doomed) rmSync(join(modules, d), { recursive: true, force: true });
}

const asBun = { ...process.env, BUN_BE_BUN: "1" }; // the compiled binary behaves as the bun it embeds (no effect on a real bun)

/** A build payload folder, `<version>-<12 hex>`, or one being extracted (`.tmp-<pid>`): the only folders of the cache that this module owns. */
const PAYLOAD_DIR = /^\d+\.\d+\.\d+[^/]*-[0-9a-f]{12}(\.tmp-.+)?$/;

/**
 * A new build is in place: earlier payloads (~175 MB each) go; folders being extracted (.tmp-) stay unless abandoned for over an hour.
 * Anything else in the cache folder (models/, native/: caches that outlive a version) is never touched.
 */
export function pruneOldPayloads(base: string, keep: string) {
  for (const old of readdirSync(base)) {
    const p = join(base, old);
    if (old !== keep && PAYLOAD_DIR.test(old) && (!old.includes(".tmp-") || Date.now() - statSync(p).mtimeMs > 3_600_000)) rmSync(p, { recursive: true, force: true });
  }
}

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
      pruneModules(tmp);
      renameSync(tmp, dir);
      // ponytail: no lock; a different build exporting at this very moment loses its folder and fails (rerun it).
      pruneOldPayloads(dirname(dir), basename(dir));
    } catch (e) {
      rmSync(tmp, { recursive: true, force: true });
      if (!existsSync(dir)) throw e; // otherwise a concurrent run extracted it first
    }
  }
  const p = Bun.spawn([process.execPath, join(dir, "src/cortex.ts"), ...process.argv.slice(2)], {
    env: { ...asBun, CORTEX_ROOT: root },
    stdio: ["inherit", "inherit", "inherit"],
  });
  // a stop sent to this process (kill, systemd) reaches the command that runs from the sources: `serve` then stops its export child too
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => p.kill(sig));
  return p.exited;
}
