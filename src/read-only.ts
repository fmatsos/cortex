import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { accountsFile, getSpace, openAccounts } from "./accounts";
import { CortexError, instanceRoot, isMultiSpace } from "./lib";

/**
 * A space can be set read-only (`cortex space set <name> --read-only true`, or by its owners from the site): it stays visible and
 * searchable as its visibility says, but nothing writes to its wiki/ or raw/. The state is kept next to the visibility, in the
 * accounts' database. `readOnlyReason` is the question every write path asks (the CLI, the MCP server's `add`, the agent in write
 * mode); `serve` asks the same through its own handle. An unreadable database refuses, rather than lets a write through.
 */
export function readOnlyReason(root: string): string | undefined {
  const inst = instanceRoot(root);
  if (!isMultiSpace(inst)) return;
  const [dir, name] = relative(inst, resolve(root)).split(sep);
  if (dir !== "spaces" || !name || !existsSync(accountsFile(inst))) return;
  const db = (() => { try { return openAccounts(accountsFile(inst)); } catch (e) { return e as Error; } })();
  if (db instanceof Error) return `cannot tell whether space ${name} is read-only (${db.message}): nothing is written.`;
  try { return getSpace(db, name)?.read_only ? readOnlyMessage(name) : undefined; }
  catch (e) { return `cannot tell whether space ${name} is read-only (${(e as Error).message}): nothing is written.`; }
  finally { db.close(); }
}

export const readOnlyMessage = (name: string) => `space ${name} is read-only: nothing is written to it (cortex space set ${name} --read-only false, or its owners on the site, lifts it).`;

/** Throws a `refused` error when the space `root` belongs to is read-only. */
export function assertWritable(root: string) {
  const why = readOnlyReason(root);
  if (why) throw new CortexError(why, "refused");
}
