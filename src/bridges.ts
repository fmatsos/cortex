import type { Wiki } from "./context";
import type { Page } from "./doc";
import { linkGraph } from "./lib";
import { LIMITS } from "./limits";
import { enqueueCtx, queueItems, type QueueEntry } from "./queue";
import { collator } from "./text";

// Step 7bis of the pipeline (docs/PIPELINE.md §4.8): a source that touches pages of two groups of linked pages that had
// no link between them is a bridge: a synthesis is worth writing. Deterministic, no model call.

/** A connected component of the link graph: its pages (path order), and the page of highest degree with its title. */
export type Component = { pages: string[]; hub: string; title: string };
export type Bridge = { title: string; reason: string; pages: string[] };

const GROUPED = new Set(["Concept", "Entity", "Synthesis"]);

/** Connected components (undirected links) of the Concept / Entity / Synthesis pages; Source pages are not nodes, so they join nothing. */
export function components(pages: Page[]): Component[] {
  const nodes = pages.filter((p) => GROUPED.has(p.fm.type as string)), { links, backlinks } = linkGraph(nodes);
  const adj = new Map(nodes.map((p) => [p.path, new Set([...links.get(p.path)!, ...backlinks.get(p.path)!])]));
  const title = new Map(nodes.map((p) => [p.path, String(p.fm.title ?? p.path)]));
  const seen = new Set<string>(), out: Component[] = [];
  for (const start of [...adj.keys()].sort()) {
    if (seen.has(start)) continue;
    const members: string[] = [], todo = [start];
    seen.add(start);
    for (let p; (p = todo.pop()) !== undefined;) {
      members.push(p);
      for (const q of adj.get(p)!) if (!seen.has(q)) { seen.add(q); todo.push(q); }
    }
    members.sort();
    const hub = [...members].sort((a, b) => adj.get(b)!.size - adj.get(a)!.size || collator.compare(title.get(a)!, title.get(b)!) || a.localeCompare(b))[0]!;
    out.push({ pages: members, hub, title: title.get(hub)! });
  }
  return out;
}

/**
 * The bridges a source makes: `touched` are the pages it links (created, updated, connected), `before` the components
 * computed before it wrote anything. Two or more groups of at least `pipelineBridgeMinSize` pages among the touched pages
 * → one bridge per pair of groups (by hub title, at most `pipelineBridgeMax`), unless an open entry already links both.
 */
export function findBridges(before: Component[], touched: string[], open: QueueEntry[]): Bridge[] {
  const of = new Map(before.flatMap((c) => c.pages.map((p) => [p, c] as const)));
  const hit = [...new Set(touched.flatMap((p) => of.get(p) ?? []).filter((c) => c.pages.length >= LIMITS.pipelineBridgeMinSize))]
    .sort((a, b) => collator.compare(a.title, b.title) || a.hub.localeCompare(b.hub));
  const covers = (c: Component, e: QueueEntry) => e.pages.some((p) => of.get(p) === c);
  const out: Bridge[] = [];
  for (const [i, a] of hit.entries()) for (const b of hit.slice(i + 1)) {
    if (out.length >= LIMITS.pipelineBridgeMax || open.some((e) => covers(a, e) && covers(b, e))) continue;
    // the touched pages of the two groups, and those of no group worth a bridge (new pages, small groups)
    const mine = touched.filter((p) => { const c = of.get(p); return !c || c === a || c === b || !hit.includes(c); });
    out.push({
      title: `Synthèse : ${a.title} / ${b.title}`,
      reason: `La source relie deux groupes de pages jusque-là sans lien (${a.pages.length} et ${b.pages.length} pages) : une synthèse reste à écrire.`,
      pages: [...new Set([a.hub, b.hub, ...mine])],
    });
  }
  return out;
}

/** Adds the bridges of the source `source` to the queue (`synthesis` entries); returns them. */
export async function detectBridges(w: Wiki, before: Component[], touched: string[], source: string, now: Date): Promise<Bridge[]> {
  const open = queueItems(w.queue().entries).filter((i) => i.kind === "synthesis" && i.status === "open");
  const found = findBridges(before, touched, open);
  for (const b of found) await enqueueCtx(w, { kind: "synthesis", ...b, sources: [source] }, now);
  return found;
}
