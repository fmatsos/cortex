import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { warn } from "./style";

/**
 * Which SQLite library cortex uses. macOS ships a SQLite that refuses extensions (so sqlite-vec cannot load); Bun can use another
 * one, chosen with `Database.setCustomSQLite` before the first Database of the process. This module does it as a side effect
 * of being imported, and src/cortex.ts imports it first (every command, `serve` and `mcp` included, goes through it; the
 * modules that open a database import it too). No cortex.json key: the library is chosen before any config is read.
 *
 * Order: $CORTEX_SQLITE_LIB (a libsqlite3.dylib / .so; `system` = the system's, no detection), then on macOS only Homebrew's
 * (/opt/homebrew/opt/sqlite, /usr/local/opt/sqlite). A library that is missing or refused: one warning, the system's SQLite stays
 * (and the nearest neighbours are computed in JS). Bun only honours `setCustomSQLite` on macOS (checked on Linux: the call succeeds and
 * the SQLite in use stays Bun's own, which loads extensions already): elsewhere the variable is recorded as `ignored`, `cortex doctor` says so.
 */
export const HOMEBREW_SQLITE = ["/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib", "/usr/local/opt/sqlite/lib/libsqlite3.dylib"];

export type SqliteChoice = { path?: string; source: "env" | "homebrew" | "system" };
/** The choice, from what the environment says: pure (the environment, the platform and the file test are arguments). */
export function pickSqlite(env: Record<string, string | undefined>, platform: string, exists: (p: string) => boolean): SqliteChoice {
  const want = env.CORTEX_SQLITE_LIB?.trim();
  if (want === "system") return { source: "system" };
  if (want) return { path: want, source: "env" };
  const brew = platform === "darwin" ? HOMEBREW_SQLITE.find(exists) : undefined;
  return brew ? { path: brew, source: "homebrew" } : { source: "system" };
}

/** What `applySqlite` did: the library in use (undefined = the system's), where the choice came from, and why a chosen one was not used. */
export type SqliteState = { path?: string; source: SqliteChoice["source"]; error?: string; /** asked for, but Bun uses its own SQLite on this platform */ ignored?: boolean };

/** Applies the choice; never throws. Exported for the tests (the module runs it once, at import). */
export function applySqlite(choice: SqliteChoice, exists: (p: string) => boolean = existsSync, set: (p: string) => void = (p) => Database.setCustomSQLite(p), platform: string = process.platform): SqliteState {
  if (!choice.path) return { source: choice.source };
  let error: string | undefined;
  if (!exists(choice.path)) error = "file not found";
  else try { set(choice.path); } catch (e) { error = (e as Error).message; }
  if (error) {
    warn(`SQLite library ${choice.path}: ${error}; using the system's SQLite${process.platform === "darwin" ? " (sqlite-vec off, nearest neighbours computed in JS)" : ""}. Set CORTEX_SQLITE_LIB=system to silence this.`);
    return { source: choice.source, error };
  }
  return platform === "darwin" ? { path: choice.path, source: choice.source } : { source: choice.source, ignored: true };
}

/** The library this process uses. */
export const sqliteState: SqliteState = applySqlite(pickSqlite(process.env, process.platform, existsSync));
