import type { IconName } from "#lib/icons.js";
import { t } from "#lib/i18n/index.js";

/** OKF page types: labels, color CSS variable and icon (home, badges, legend and graph). */
export const TYPES = [
	{ type: "Concept", get plural() { return t("type.Concept.plural"); }, color: "--type-concept", icon: "concept" },
	{ type: "Entity", get plural() { return t("type.Entity.plural"); }, color: "--type-entity", icon: "entity" },
	{ type: "Synthesis", get plural() { return t("type.Synthesis.plural"); }, color: "--type-synthesis", icon: "synthesis" },
	{ type: "Source", get plural() { return t("type.Source.plural"); }, color: "--type-source", icon: "source" },
] as const satisfies readonly { type: string; plural: string; color: string; icon: IconName }[];

const TYPE_KEYS: Record<string, "type.Concept" | "type.Entity" | "type.Synthesis" | "type.Source"> = { Concept: "type.Concept", Entity: "type.Entity", Synthesis: "type.Synthesis", Source: "type.Source" };
export const typeLabel = (type: string) => (TYPE_KEYS[type] ? t(TYPE_KEYS[type]) : type);
/** Plural label of a page type (home sections, facets). */
export const typePlural = (type: string) => TYPES.find((x) => x.type === type)?.plural ?? type;
export const typeColor = (type: string) => `var(${TYPES.find((x) => x.type === type)?.color ?? "--type-other"})`;
/** Icon of a page type; an unknown type falls back to the leaf. */
export const typeIcon = (type: string): IconName => TYPES.find((x) => x.type === type)?.icon ?? "source";

export const STATUS_LABEL: Record<string, string> = { get draft() { return t("status.draft"); }, get stable() { return t("status.stable"); }, get deprecated() { return t("status.deprecated"); } };
/** Status of a page: icon and badge variant. Stable stays discreet; draft and deprecated draw attention. */
export const STATUS_META = {
	stable: { get label() { return t("status.stable"); }, icon: "stable", variant: "stable" },
	draft: { get label() { return t("status.draft"); }, icon: "draft", variant: "caution" },
	deprecated: { get label() { return t("status.deprecated"); }, icon: "deprecated", variant: "destructive" },
} as const satisfies Record<string, { label: string; icon: IconName; variant: string }>;
export const statusMeta = (s: string) => (STATUS_META as Record<string, (typeof STATUS_META)[keyof typeof STATUS_META]>)[s];

/**
 * Log entry types (wiki/log.jsonl). The technical identifier (`kind`) stays that of the data;
 * `label` and `description` are those of the display, in the site language: they describe the operation without knowing the CLI.
 */
export const KINDS = [
	{ kind: "add", get label() { return t("kind.add"); }, get description() { return t("kind.add.description"); }, color: "--kind-add", icon: "kind-add" },
	{ kind: "ingest", get label() { return t("kind.ingest"); }, get description() { return t("kind.ingest.description"); }, color: "--kind-ingest", icon: "kind-ingest" },
	{ kind: "query", get label() { return t("kind.query"); }, get description() { return t("kind.query.description"); }, color: "--kind-query", icon: "kind-query" },
	{ kind: "lint", get label() { return t("kind.lint"); }, get description() { return t("kind.lint.description"); }, color: "--kind-lint", icon: "kind-lint" },
	{ kind: "update", get label() { return t("kind.update"); }, get description() { return t("kind.update.description"); }, color: "--kind-update", icon: "kind-update" },
] as const satisfies readonly { kind: string; label: string; description: string; color: string; icon: IconName }[];
export const kindLabel = (k: string) => KINDS.find((x) => x.kind === k)?.label ?? k;
export const kindDescription = (k: string) => KINDS.find((x) => x.kind === k)?.description ?? "";
export const kindColor = (k: string) => `var(${KINDS.find((x) => x.kind === k)?.color ?? "--type-other"})`;
/** Icon of a log entry type; an unknown type falls back to the note. */
export const kindIcon = (k: string): IconName => KINDS.find((x) => x.kind === k)?.icon ?? "note";
