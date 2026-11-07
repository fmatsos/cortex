import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

/**
 * Real path of `p` (symlinks resolved), also for a path that does not exist yet: the nearest existing parent is
 * resolved and the missing tail appended. A dangling symlink is followed to its target, so a link that leaves a
 * folder cannot be used to create a file outside it.
 */
export function realPath(p: string, depth = 0): string {
  const abs = resolve(p);
  try { return realpathSync(abs); } catch { /* missing or dangling: resolve below */ }
  try {
    if (depth < 16 && lstatSync(abs).isSymbolicLink()) return realPath(resolve(dirname(abs), readlinkSync(abs)), depth + 1);
  } catch { /* nothing at that name */ }
  const parent = dirname(abs);
  return parent === abs ? abs : join(realPath(parent, depth), basename(abs));
}

/**
 * Is `p` (absolute, or relative to `root`) under `root/dir`? The single "is this path inside that folder" check of
 * the CLI. `followSymlinks` (default true) compares real paths; false compares the lexical paths only.
 * `self`: `p` may be the folder itself. `dir` "." is the root.
 */
export function isUnder(root: string, dir: string, p: string, { followSymlinks = true, self = false }: { followSymlinks?: boolean; self?: boolean } = {}): boolean {
  const base = resolve(root, dir), target = resolve(root, p);
  const [b, t] = followSymlinks ? [realPath(base), realPath(target)] : [base, target];
  return (self && t === b) || t.startsWith(b.endsWith(sep) ? b : b + sep);
}
