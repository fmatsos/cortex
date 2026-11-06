import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Wiki } from "./context";
import { CortexError } from "./lib";
import { LIMITS } from "./limits";
import { appendLogCtx } from "./log";
import { collector, type Report, type Result } from "./print";
import { enqueueCtx, queueItems, type QueueItem, type QueueKind } from "./queue";

// --- `cortex maintain <sub>` (docs/PIPELINE.md §8): what the ingestion does not do, done later with the same local stack.
// Common rule: the judge confirms before any call of the 4B, cortex writes, and what does not reach `maintainJudge` goes to
// the queue instead of being applied. Without `--apply` a subcommand lists what it would do and writes nothing at all (no
// page, no queue entry, no journal line, no state). A subcommand is one module that exports a `Task`; to add one, put its
// loader in `TASKS` (and, when its queue entries can be applied by `cortex queue apply`, in `APPLY`).

export type MaintainOpts = {
  /** Write (default: list only). */ apply?: boolean;
  /** Most candidates handled in one run (default: all). */ limit?: number;
  /** The clock (tests). */ now?: () => Date;
};
export type Say = (level: "ok" | "info" | "warn" | "fail", text: string, mark?: string) => void;
/** What a subcommand did or would do: one item per candidate, `action` is its own vocabulary (merged, would-merge, queued…). */
export type Item = { action: string; pages: string[]; note?: string };
export type TaskResult = { ok: boolean; items: Item[] };
export type Task = (w: Wiki, o: MaintainOpts, say: Say) => Promise<TaskResult>;

/** The subcommands, loaded on use. */
export const TASKS: Record<string, () => Promise<Task>> = {
  merge: async () => (await import("./maintain-merge")).maintainMerge,
  contradictions: async () => (await import("./maintain-contradictions")).maintainContradictions,
};

/** Queue entries `cortex queue apply <n>` can apply, by kind: the work of the entry, run as a human decision (the judge is not asked again). */
export const APPLY: Partial<Record<QueueKind, () => Promise<(w: Wiki, item: QueueItem, say: Say) => Promise<boolean>>>> = {
  merge: async () => (await import("./maintain-merge")).applyMergeEntry,
  contradiction: async () => (await import("./maintain-contradictions")).applyContradictionEntry,
};

/** Runs one subcommand; progress goes to `report` as it happens. */
export async function maintainCtx(w: Wiki, sub: string | undefined, opts: MaintainOpts, report?: Report): Promise<Result & { items: Item[] }> {
  const load = sub ? TASKS[sub] : undefined;
  if (!load) throw new CortexError(`Usage: cortex maintain <${Object.keys(TASKS).join("|")}> [--apply | --dry-run] [--limit N]`, "usage");
  const { messages, say, done } = collector(report);
  const r = await (await load())(w, opts, say);
  return { ...done(r.ok), messages, items: r.items };
}

/** `cortex queue apply <n>`: applies the open entry `item` when its kind has an applier. */
export async function applyQueueEntry(w: Wiki, item: QueueItem, report?: Report): Promise<Result> {
  const load = APPLY[item.kind];
  if (!load) throw new CortexError(`cortex queue apply is not available yet for ${item.kind} entries; close the entry with done or dismiss once handled by hand`, "refused");
  const { say, done } = collector(report);
  return done(await (await load())(w, item, say));
}

// --- Shared by the subcommands

/** `.cortex/maintain.json`: one key per subcommand, each its own state (what was judged and need not be asked again). */
const stateFile = (root: string) => join(root, ".cortex/maintain.json");

function readAll(root: string): Record<string, unknown> {
  try { const s = JSON.parse(readFileSync(stateFile(root), "utf8")); return s && typeof s === "object" ? s : {}; } catch { return {}; }
}
/** The state of `key`, `init` when there is none (or the file is unreadable: it is only a cache). */
export function readState<T>(root: string, key: string, init: T): T {
  return (readAll(root)[key] as T | undefined) ?? init;
}
/** Replaces the state of `key`, the others stay (tmp + rename). */
export function writeState(root: string, key: string, value: unknown) {
  const f = stateFile(root);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(`${f}.tmp`, JSON.stringify({ ...readAll(root), version: 1, [key]: value }));
  renameSync(`${f}.tmp`, f);
}

/** A judge answer to a `choice` question is a decision of the maintenance only from this probability. */
export const confident = (p: number | undefined) => (p ?? 0) >= LIMITS.maintainJudge;

const samePages = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((p, i) => p === [...b].sort()[i]);

/** The open queue entry of `kind` about exactly these pages, if any (a weekly rerun must not pile up the same entry). */
export const openEntry = (w: Wiki, kind: QueueKind, pages: string[]) =>
  queueItems(w.queue().entries).find((i) => i.status === "open" && i.kind === kind && samePages(i.pages, pages));

/** Adds an entry to the queue unless an open one of that kind already concerns these pages. True when it was added. */
export async function enqueueOnce(w: Wiki, e: Parameters<typeof enqueueCtx>[1] & { kind: QueueKind; pages: string[] }, now: Date): Promise<boolean> {
  if (openEntry(w, e.kind, e.pages)) return false;
  await enqueueCtx(w, e, now);
  return true;
}

/** The journal line of a maintenance write (`update`). */
export const logUpdate = (w: Wiki, text: string, pages: string[], now: Date) => appendLogCtx(w, { kind: "update", pages, text }, now);

/** Does this path exist under the root (a page that moved or went since the candidates were listed)? */
export const exists = (w: Wiki, p: string) => existsSync(join(w.root, p));
