import type { IconName } from "#lib/icons.js";

/** OKF page types: labels, color CSS variable and icon (home, badges, legend and graph). */
export const TYPES = [
	{ type: "Concept", plural: "Concepts", color: "--type-concept", icon: "concept" },
	{ type: "Entity", plural: "Entités", color: "--type-entity", icon: "entity" },
	{ type: "Synthesis", plural: "Synthèses", color: "--type-synthesis", icon: "synthesis" },
	{ type: "Source", plural: "Sources", color: "--type-source", icon: "source" },
] as const satisfies readonly { type: string; plural: string; color: string; icon: IconName }[];

const FR: Record<string, string> = { Concept: "Concept", Entity: "Entité", Synthesis: "Synthèse", Source: "Source" };
export const typeLabel = (t: string) => FR[t] ?? t;
export const typeColor = (t: string) => `var(${TYPES.find((x) => x.type === t)?.color ?? "--type-autre"})`;
/** Icon of a page type; an unknown type falls back to the leaf. */
export const typeIcon = (t: string): IconName => TYPES.find((x) => x.type === t)?.icon ?? "source";

export const STATUS_LABEL: Record<string, string> = { draft: "brouillon", stable: "stable", deprecated: "déprécié" };
/** Status of a page: icon and badge variant. Stable stays discreet; draft and deprecated draw attention. */
export const STATUS_META = {
	stable: { label: "stable", icon: "stable", variant: "stable" },
	draft: { label: "brouillon", icon: "draft", variant: "caution" },
	deprecated: { label: "déprécié", icon: "deprecated", variant: "destructive" },
} as const satisfies Record<string, { label: string; icon: IconName; variant: string }>;
export const statusMeta = (s: string) => (STATUS_META as Record<string, (typeof STATUS_META)[keyof typeof STATUS_META]>)[s];

/**
 * Log entry types (wiki/log.jsonl). The technical identifier (`kind`) stays that of the data;
 * `label` and `description` are those of the display, in French: they describe the operation without knowing the CLI.
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
/** Icon of a log entry type; an unknown type falls back to the note. */
export const kindIcon = (k: string): IconName => KINDS.find((x) => x.kind === k)?.icon ?? "note";
