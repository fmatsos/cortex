/** Contract between `src/export.ts` (which writes data.json, graph.json, search-index.json) and the site (which displays them). */
export type Link = { id: string; title: string; type: string };
export type SourceRef = { id: string; title: string; url?: string; page?: Link; partial?: true }; // partial: partial extraction of the raw source (paywall)
export type Note = { n: number; id: string; refs: number; html: string }; // refs: occurrences of the note in the text
/** Why a page is related to another: outgoing link, incoming link, shared raw source (`value` = its resource path), shared tag (`value` = the tag). */
export type RelatedReason = { kind: "out" | "in" | "source" | "tag" | "semantic"; value?: string };
export type TocItem = { level: 2 | 3; id: string; text: string };
export type PageData = {
  id: string; // "concepts/context-rot"
  type: string; // Concept | Entity | Synthesis | Source
  title: string;
  description: string;
  tags: string[];
  status: string; // draft | stable | deprecated
  verified?: { by: string; at: string };
  generated?: { by: string; at: string };
  stale_after?: string;
  needsReview: boolean; // generated.at later than verified.at
  partial: boolean; // partial content: Source page whose raw source is a partial extraction, or warning callout for partial content
  html: string;
  md: string; // Source Markdown of the page, raw/ paths replaced by the original URL
  sources: SourceRef[];
  notes: Note[];
  toc: TocItem[]; // h2/h3 headings of the body, with their anchor
  backlinks: Link[];
  related: (Link & { reasons: RelatedReason[] })[];
};
/** A log entry: `search` = all the displayed text (type, text, page titles, ids and Source pages), folded (no accents, lowercase) for a local search by `fold(query)`; `html` = inline text; `sources` = raw ids not named in the text (with the wiki Source page that cites them, if there is one). */
export type LogEntryData = { at: string; kind: string; html: string; pages: Link[]; sources: { id: string; page?: Link }[]; search: string };
/** A queue entry (wiki/queue.jsonl): `html` = reason as inline text; `proposal` = rendered Markdown; `closedAt` = when a done/dismissed entry was closed. */
export type QueueEntryData = { n: number; at: string; kind: string; title: string; html: string; pages: Link[]; sources: { id: string; page?: Link }[]; proposal?: string; status: "open" | "done" | "dismissed"; closedAt?: string };
export type SiteData = {
  locale: "en" | "fr"; // UI language of the export (cortex.json `language`)
  pages: PageData[];
  tags: { tag: string; slug: string; ids: string[] }[];
  log: LogEntryData[]; // most recent first
  queue: QueueEntryData[]; // open entries first (by kind, oldest first), then the closed ones (most recent number first)
};
export type GraphData = {
  nodes: { id: string; title: string; description: string; type: string; tags: string[]; degree: number }[];
  links: { source: string; target: string; mutual?: true }[]; // directed: source = page that contains the link; mutual: links in both directions (a single link, never two)
};
export type SearchDoc = { id: string; title: string; description: string; type: string; tags: string[]; status: string; verified: boolean; needsReview?: boolean; partial?: boolean; text: string };
export type SearchIndex = { docs: SearchDoc[]; terms: Record<string, number[]>; vocab: string[] };
