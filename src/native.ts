import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/**
 * The native libraries of hybrid search: the sqlite-vec extension (KNN inside SQLite) and the ONNX runtime (the local embedding
 * model). From the sources (bun, tests) both come from node_modules. In the compiled binary, scripts/build.sh embeds the ones
 * of the build's platform (build/native.ts, set on globalThis by bin.ts); they are extracted once to the user's cache and
 * loaded from there. Neither is required: without sqlite-vec the nearest neighbours are computed in JS, without the ONNX runtime
 * (or the model) the search is lexical only.
 */
declare global {
  /** Embedded native libraries (the files' paths in the binary), set by src/bin.ts in the binary only. */
  var CORTEX_NATIVE: { vec?: string; vecName?: string; ort?: string; ortName?: string } | undefined;
}

/** The user's cache (where the sources payload also goes): shared by every wiki. */
export const userCache = () => join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "cortex");

/**
 * Embedded file `embedded` written to `<cache>/native/<hash>-<size>/<name>` once; an existing file of the same size is the one.
 * The folder carries the identity, not the file: SQLite derives the entry point of an extension from its file name (vec0.so →
 * sqlite3_vec0_init) and the runtime is looked up by its SONAME. Written next to its place then renamed (atomic). Not in /tmp:
 * it can be mounted noexec.
 */
async function extract(embedded: string, name: string): Promise<string> {
  const id = basename(embedded).replace(/\.[^-]*$/, "").replace(/^.*-/, "");
  const file = Bun.file(embedded), dir = join(userCache(), "native", `${id}-${file.size}`), dest = join(dir, name);
  if (existsSync(dest) && statSync(dest).size === file.size) return dest;
  mkdirSync(dir, { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  await Bun.write(tmp, file);
  renameSync(tmp, dest);
  return dest;
}

let vec: Promise<string | undefined> | undefined;
/** Path of the sqlite-vec extension, undefined when this build has none (or CORTEX_SQLITE_VEC=off). */
export function vecPath(): Promise<string | undefined> {
  if (process.env.CORTEX_SQLITE_VEC === "off") return Promise.resolve(undefined); // looked at each time: the tests switch it
  return vec ??= (async () => {
    try {
      const n = globalThis.CORTEX_NATIVE;
      if (n?.vec) return await extract(n.vec, n.vecName ?? "vec0.so");
      if (globalThis.CORTEX_DIST === "binary") return; // a binary of a platform that embeds none
      return ((await import("sqlite-vec")) as { getLoadablePath(): string }).getLoadablePath();
    } catch { return; }
  })();
}

/** Loads sqlite-vec into `db`; false (never an error) when this build has none or SQLite refuses it. */
export async function loadVec(db: Database): Promise<boolean> {
  const path = await vecPath();
  if (!path) return false;
  try { db.loadExtension(path); db.query("SELECT vec_version()").get(); return true; } catch { return false; }
}

let ort: Promise<void> | undefined;
/**
 * Before `@huggingface/transformers` is imported: in the binary, puts the ONNX runtime in place (extracted, loaded by path so the
 * addon Bun unpacks into $TMPDIR finds it by its SONAME, then offered to transformers.js as the module `onnxruntime-node`).
 * From the sources, nothing to do. Throws when the library cannot be loaded (the caller falls back to lexical search).
 */
export function prepareOrt(): Promise<void> {
  return ort ??= (async () => {
    const n = globalThis.CORTEX_NATIVE;
    if (!n?.ort) return;
    const lib = await extract(n.ort, n.ortName ?? "libonnxruntime.so.1");
    (await import("bun:ffi")).dlopen(lib, { OrtGetApiBase: { args: [], returns: "ptr" } });
    const mod = await import("onnxruntime-node");
    Bun.plugin({ name: "ort", setup(b) { b.module("onnxruntime-node", () => ({ exports: mod, loader: "object" })); } });
  })();
}
