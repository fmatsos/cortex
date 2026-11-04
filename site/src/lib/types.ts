/** Contrat entre `cli/src/export.ts` (qui écrit data.json, graph.json, search-index.json) et le site (qui les affiche). */
export type Link = { id: string; title: string; type: string };
export type SourceRef = { id: string; title: string; url?: string; page?: Link };
export type Note = { n: number; id: string; html: string };
export type PageData = {
  id: string; // « concepts/context-rot »
  type: string; // Concept | Entity | Synthesis | Source
  title: string;
  description: string;
  tags: string[];
  status: string; // draft | stable | deprecated
  verified?: { by: string; at: string };
  generated?: { by: string; at: string };
  stale_after?: string;
  needsReview: boolean; // generated.at postérieur à verified.at
  html: string;
  sources: SourceRef[];
  notes: Note[];
  backlinks: Link[];
  related: (Link & { reasons: string[] })[];
};
export type SiteData = {
  pages: PageData[];
  tags: { tag: string; slug: string; ids: string[] }[];
  log: string; // HTML
};
export type GraphData = {
  nodes: { id: string; title: string; type: string; tags: string[]; degree: number }[];
  links: { source: string; target: string }[];
};
export type SearchDoc = { id: string; title: string; description: string; type: string; tags: string[]; status: string; verified: boolean; text: string };
export type SearchIndex = { docs: SearchDoc[]; index: unknown; vocab: string[] };
