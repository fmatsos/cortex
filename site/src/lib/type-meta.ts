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
