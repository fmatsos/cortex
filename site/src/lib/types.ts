/** Contrat entre `cli/src/export.ts` (qui écrit data.json, graph.json, search-index.json) et le site (qui les affiche). */
export type Link = { id: string; title: string; type: string };
export type SourceRef = { id: string; title: string; url?: string; page?: Link };
export type Note = { n: number; id: string; refs: number; html: string }; // refs : occurrences de la note dans le texte
export type TocItem = { level: 2 | 3; id: string; text: string };
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
  md: string; // Markdown source de la page, chemins raw/ remplacés par l'URL d'origine
  sources: SourceRef[];
  notes: Note[];
  toc: TocItem[]; // titres h2/h3 du corps, avec leur ancre
  backlinks: Link[];
  related: (Link & { reasons: string[] })[];
};
/** Une entrée du journal : `html` = texte en ligne ; `sources` = ids raw non nommés dans le texte (avec la page Source du wiki qui les cite, s'il y en a une). */
export type LogEntryData = { at: string; kind: string; html: string; pages: Link[]; sources: { id: string; page?: Link }[] };
export type SiteData = {
  pages: PageData[];
  tags: { tag: string; slug: string; ids: string[] }[];
  log: LogEntryData[]; // plus récente d'abord
};
export type GraphData = {
  nodes: { id: string; title: string; description: string; type: string; tags: string[]; degree: number }[];
  links: { source: string; target: string }[];
};
export type SearchDoc = { id: string; title: string; description: string; type: string; tags: string[]; status: string; verified: boolean; needsReview?: boolean; text: string };
export type SearchIndex = { docs: SearchDoc[]; terms: Record<string, number[]>; vocab: string[] };
