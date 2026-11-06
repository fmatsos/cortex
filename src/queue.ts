import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { openWiki, type Wiki } from "./context";
import { pageId, pageLink } from "./doc";
import { localIso, RAW_ID } from "./lib";
import { LIMITS } from "./limits";
import type { Titles } from "./log";
import { collator } from "./text";

/**
 * Queue: wiki/queue.jsonl (one entry per line, append-only) is what neither the pipeline nor the maintenance decides
 * alone, left visible to the human. wiki/queue.md (OKF-reserved) is generated from it, like wiki/log.md.
 * An entry is closed by appending a `done` / `dismissed` entry that references its `at` (`ref`): the last line for a `ref` wins.
 */
export const QUEUE_KINDS = ["synthesis", "merge", "contradiction", "split", "review"] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];
export const QUEUE_STATUSES = ["open", "done", "dismissed"] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];
/** `pages`: `wiki/…md` paths; `sources`: raw ids; `ref`: the `at` of the entry this one closes. */
export type QueueEntry = {
  at: string; kind: QueueKind; title: string; reason: string; pages: string[]; sources: string[];
  proposal?: string; status: QueueStatus; ref?: string;
};
/** An opening entry with its number (1-based among the opening entries: stable, closing never renumbers) and its current status. */
export type QueueItem = QueueEntry & { n: number; closedAt?: string };

const LABEL: Record<QueueKind, string> = { synthesis: "Synthesis", merge: "Merge", contradiction: "Contradiction", split: "Split", review: "Review" };
export const queueKindLabel = (k: string) => LABEL[k as QueueKind] ?? k;

const AT = /^\d{4}-\d\d-\d\d(T\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d))?$/;
const KEYS = new Set(["at", "kind", "title", "reason", "pages", "sources", "proposal", "status", "ref"]);
const text = (v: unknown) => typeof v === "string" && v.trim() !== "";

/** Valid entry (`pages` and `sources` default to empty) or error message (the first). */
export function parseQueueEntry(v: unknown): QueueEntry | string {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "the entry must be a JSON object";
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!KEYS.has(k)) return `unknown field: ${k}`;
  if (typeof o.at !== "string" || !AT.test(o.at) || Number.isNaN(Date.parse(o.at))) return "at: ISO 8601 with offset, or YYYY-MM-DD";
  if (!QUEUE_KINDS.includes(o.kind as QueueKind)) return `kind: ${QUEUE_KINDS.join("|")}`;
  if (!text(o.title) || /[\r\n]/.test(o.title as string)) return "title: one non-empty line";
  if (!text(o.reason)) return "reason: non-empty text";
  if (!QUEUE_STATUSES.includes(o.status as QueueStatus)) return `status: ${QUEUE_STATUSES.join("|")}`;
  if (o.proposal !== undefined && !text(o.proposal)) return "proposal: non-empty text (omit the field when empty)";
  if (o.ref !== undefined && (typeof o.ref !== "string" || !AT.test(o.ref))) return "ref: the at of the entry it closes";
  if (o.ref === undefined && o.status !== "open") return "status: an entry that closes another one needs a ref";
  for (const [k, ok] of [["pages", (s: string) => /^wiki\/.+\.md$/.test(s)], ["sources", (s: string) => RAW_ID.test(s)]] as const) {
    const a = o[k] ?? [];
    if (!Array.isArray(a) || a.some((s) => typeof s !== "string" || !ok(s))) return `${k}: list of ${k === "sources" ? "raw ids" : "wiki/….md paths"}`;
  }
  return { ...o, pages: o.pages ?? [], sources: o.sources ?? [] } as QueueEntry;
}

/** Reads wiki/queue.jsonl: valid entries (file order) and per-line errors. Missing file = empty queue. */
export function readQueue(root: string): { entries: QueueEntry[]; errors: { line: number; msg: string }[] } {
  const f = join(root, "wiki/queue.jsonl");
  const entries: QueueEntry[] = [], errors: { line: number; msg: string }[] = [];
  if (!existsSync(f)) return { entries, errors };
  readFileSync(f, "utf8").split("\n").forEach((l, i) => {
    if (!l.trim()) return;
    let v: unknown;
    try { v = JSON.parse(l); } catch { errors.push({ line: i + 1, msg: "invalid JSON" }); return; }
    const e = parseQueueEntry(v);
    if (typeof e === "string") errors.push({ line: i + 1, msg: e }); else entries.push(e);
  });
  return { entries, errors };
}

/** The opening entries (those that close nothing), numbered, with the status the last line referencing them gives. */
export function queueItems(entries: QueueEntry[]): QueueItem[] {
  const last = new Map<string, QueueEntry>();
  for (const e of entries) if (e.ref) last.set(e.ref, e);
  return entries.filter((e) => !e.ref).map((e, i) => {
    const c = last.get(e.at);
    return { ...e, n: i + 1, ...(c && { status: c.status, closedAt: c.at }) };
  });
}

/** Open entries, oldest first within each kind, kinds in the order of `QUEUE_KINDS`; `kind` keeps one kind. */
export const openItems = (items: QueueItem[], kind?: string): QueueItem[] =>
  items.filter((i) => i.status === "open" && (!kind || i.kind === kind))
    .sort((a, b) => QUEUE_KINDS.indexOf(a.kind) - QUEUE_KINDS.indexOf(b.kind) || collator.compare(a.at, b.at) || a.n - b.n);

/** Open entries older than `queueStaleDays` at `now`. */
export const staleItems = (items: QueueItem[], now: Date): QueueItem[] =>
  items.filter((i) => i.status === "open" && now.getTime() - Date.parse(i.at) > LIMITS.queueStaleDays * 86_400_000);

const day = (at: string) => at.slice(0, 10);
const link = (p: string, titles: Titles) => `[${titles.get(p) ?? pageId(p)}](${pageLink(p)})`;

/** wiki/queue.md: open entries first (by kind), then the closed ones. Deterministic: no date of the day in it. */
export function renderQueueMd(entries: QueueEntry[], titles: Titles = new Map()): string {
  const items = queueItems(entries), open = openItems(items);
  let out = "# Queue\n\n> Generated from `wiki/queue.jsonl`: do not edit by hand (`cortex queue done|dismiss <n>`, then `cortex index`).\n\n## Open\n";
  if (!open.length) out += "\nNo open entry.\n";
  for (const kind of QUEUE_KINDS) {
    const list = open.filter((i) => i.kind === kind);
    if (!list.length) continue;
    out += `\n### ${queueKindLabel(kind)}\n\n`;
    for (const i of list) {
      out += `- **#${i.n}** ${i.title} (${day(i.at)}): ${i.reason.replace(/\s*[\r\n]+\s*/g, " ").trim()}\n`;
      if (i.pages.length) out += `  - pages: ${i.pages.map((p) => link(p, titles)).join(", ")}\n`;
      if (i.sources.length) out += `  - sources: ${i.sources.map((s) => `\`${s}\``).join(", ")}\n`;
      if (i.proposal) out += `  - <details><summary>Proposal</summary>\n\n${i.proposal.trim().replace(/^(?!$)/gm, "    ")}\n\n    </details>\n`;
    }
  }
  const closed = items.filter((i) => i.status !== "open");
  if (closed.length) {
    out += "\n## Closed\n\n";
    for (const i of closed) out += `- **#${i.n}** ${i.title}: ${i.status}${i.closedAt ? ` (${day(i.closedAt)})` : ""}\n`;
  }
  return out;
}

/** Regenerates wiki/queue.md; nothing to do for a wiki that has no queue yet (no file, no entry). */
export async function writeQueueMdCtx(w: Wiki) {
  const f = join(w.root, "wiki/queue.jsonl"), md = join(w.root, "wiki/queue.md");
  if (existsSync(f) || existsSync(md)) await Bun.write(md, renderQueueMd(w.queue().entries, await w.titles()));
}

/** Appends one line to wiki/queue.jsonl (a single append), then regenerates wiki/queue.md. `at` is unique: a clash moves it to the next second. */
async function appendEntry(w: Wiki, e: Omit<QueueEntry, "at">, d: Date): Promise<QueueEntry> {
  const queue = w.queue(); // read before the append: the memo then gets the new entry, as a re-read would
  const used = new Set(queue.entries.map((x) => x.at));
  let at = localIso(d);
  while (used.has(at)) at = localIso((d = new Date(d.getTime() + 1000)));
  const entry: QueueEntry = { at, ...e };
  const bad = parseQueueEntry(entry);
  if (typeof bad === "string") throw new Error(`Invalid queue entry: ${bad}`);
  const f = join(w.root, "wiki/queue.jsonl");
  mkdirSync(dirname(f), { recursive: true });
  const prev = existsSync(f) ? readFileSync(f, "utf8") : ""; // an entry must not stick to a line without newline (hand edit)
  await appendFile(f, `${prev && !prev.endsWith("\n") ? "\n" : ""}${JSON.stringify(entry)}\n`);
  queue.entries.push(entry);
  await writeQueueMdCtx(w);
  return entry;
}

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** Adds an open entry to the queue (what the pipeline and `cortex maintain` call when they cannot decide). */
export function enqueueCtx(w: Wiki, e: { kind: QueueKind; title: string; reason: string; pages?: string[]; sources?: string[]; proposal?: string }, d = new Date()) {
  return appendEntry(w, {
    kind: e.kind, title: oneLine(e.title), reason: oneLine(e.reason), pages: [...new Set(e.pages ?? [])], sources: [...new Set(e.sources ?? [])],
    ...(e.proposal?.trim() && { proposal: e.proposal.trim() }), status: "open",
  }, d);
}
export const enqueue = (root: string, e: Parameters<typeof enqueueCtx>[1], d = new Date()) => enqueueCtx(openWiki(root), e, d);

/** Closes entry `n`: appends a `done` / `dismissed` entry that references it. */
export async function closeCtx(w: Wiki, n: number, status: "done" | "dismissed", d = new Date()) {
  const item = queueItems(w.queue().entries).find((i) => i.n === n);
  if (!item) throw new Error(`queue entry not found: #${n}`);
  if (item.status !== "open") throw new Error(`queue entry #${n} is already ${item.status}`);
  const { kind, title, reason, pages, sources } = item;
  return appendEntry(w, { kind, title, reason, pages, sources, status, ref: item.at }, d);
}
export const closeEntry = (root: string, n: number, status: "done" | "dismissed", d = new Date()) => closeCtx(openWiki(root), n, status, d);
