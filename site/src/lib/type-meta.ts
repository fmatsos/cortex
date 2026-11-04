import type { IconName } from "#lib/icons.js";

/** Types de pages OKF : libellés, variable CSS de couleur et icône (accueil, badges, légende et graphe). */
export const TYPES = [
	{ type: "Concept", plural: "Concepts", color: "--type-concept", icon: "concept" },
	{ type: "Entity", plural: "Entités", color: "--type-entity", icon: "entity" },
	{ type: "Synthesis", plural: "Synthèses", color: "--type-synthesis", icon: "synthesis" },
	{ type: "Source", plural: "Sources", color: "--type-source", icon: "source" },
] as const satisfies readonly { type: string; plural: string; color: string; icon: IconName }[];

const FR: Record<string, string> = { Concept: "Concept", Entity: "Entité", Synthesis: "Synthèse", Source: "Source" };
export const typeLabel = (t: string) => FR[t] ?? t;
export const typeColor = (t: string) => `var(${TYPES.find((x) => x.type === t)?.color ?? "--type-autre"})`;
/** Icône d'un type de page ; un type inconnu retombe sur la feuille. */
export const typeIcon = (t: string): IconName => TYPES.find((x) => x.type === t)?.icon ?? "source";

export const STATUS_LABEL: Record<string, string> = { draft: "brouillon", stable: "stable", deprecated: "déprécié" };
/** Statut d'une page : icône et variante de badge. Stable reste discret ; brouillon et déprécié attirent l'attention. */
export const STATUS_META = {
	stable: { label: "stable", icon: "stable", variant: "stable" },
	draft: { label: "brouillon", icon: "draft", variant: "caution" },
	deprecated: { label: "déprécié", icon: "deprecated", variant: "destructive" },
} as const satisfies Record<string, { label: string; icon: IconName; variant: string }>;
export const statusMeta = (s: string) => (STATUS_META as Record<string, (typeof STATUS_META)[keyof typeof STATUS_META]>)[s];

/**
 * Types d'entrée du journal (wiki/log.jsonl). L'identifiant technique (`kind`) reste celui des données ;
 * `label` et `description` sont ceux de l'affichage, en français : ils décrivent l'opération sans connaître le CLI.
 */
export const KINDS = [
	{ kind: "add", label: "Ajout", description: "Une source a été ajoutée au dossier raw, en attente de compilation.", color: "--kind-add", icon: "kind-add" },
	{ kind: "ingest", label: "Compilation", description: "Une source a été lue et compilée en pages du wiki (création ou mise à jour).", color: "--kind-ingest", icon: "kind-ingest" },
	{ kind: "query", label: "Question", description: "Une question posée au wiki, parfois rangée en synthèse.", color: "--kind-query", icon: "kind-query" },
	{ kind: "lint", label: "Contrôle", description: "Un contrôle de cohérence du wiki : liens, sources, contradictions.", color: "--kind-lint", icon: "kind-lint" },
	{ kind: "update", label: "Mise à jour", description: "Une modification ou une correction apportée à des pages existantes.", color: "--kind-update", icon: "kind-update" },
] as const satisfies readonly { kind: string; label: string; description: string; color: string; icon: IconName }[];
export const kindLabel = (k: string) => KINDS.find((x) => x.kind === k)?.label ?? k;
export const kindDescription = (k: string) => KINDS.find((x) => x.kind === k)?.description ?? "";
export const kindColor = (k: string) => `var(${KINDS.find((x) => x.kind === k)?.color ?? "--type-autre"})`;
/** Icône d'un type d'entrée du journal ; un type inconnu retombe sur la note. */
export const kindIcon = (k: string): IconName => KINDS.find((x) => x.kind === k)?.icon ?? "note";
