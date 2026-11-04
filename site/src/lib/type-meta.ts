/** Types de pages OKF : libellés et variable CSS de couleur (accueil, badges, légende et graphe). */
export const TYPES = [
	{ type: "Concept", plural: "Concepts", color: "--type-concept" },
	{ type: "Entity", plural: "Entités", color: "--type-entity" },
	{ type: "Synthesis", plural: "Synthèses", color: "--type-synthesis" },
	{ type: "Source", plural: "Sources", color: "--type-source" },
] as const;

const FR: Record<string, string> = { Concept: "Concept", Entity: "Entité", Synthesis: "Synthèse", Source: "Source" };
export const typeLabel = (t: string) => FR[t] ?? t;
export const typeColor = (t: string) => `var(${TYPES.find((x) => x.type === t)?.color ?? "--type-autre"})`;

export const STATUS_LABEL: Record<string, string> = { draft: "brouillon", stable: "stable", deprecated: "déprécié" };

/** Types d'entrée du journal (wiki/log.jsonl) : libellé et variable CSS de couleur. */
export const KINDS = [
	{ kind: "add", label: "Add", color: "--kind-add" },
	{ kind: "ingest", label: "Ingest", color: "--kind-ingest" },
	{ kind: "query", label: "Query", color: "--kind-query" },
	{ kind: "lint", label: "Lint", color: "--kind-lint" },
	{ kind: "update", label: "Update", color: "--kind-update" },
] as const;
export const kindLabel = (k: string) => KINDS.find((x) => x.kind === k)?.label ?? k;
export const kindColor = (k: string) => `var(${KINDS.find((x) => x.kind === k)?.color ?? "--type-autre"})`;
