<script lang="ts">
	import { Badge } from "#lib/components/ui/badge/index.js";
	import type { Content } from "#lib/spaces.svelte.js";
	import { t } from "#lib/i18n/index.js";

	// What a space holds (Resources, Notes), whether it is open or private (when known) and whether it is read-only: the same
	// small labels in the switcher, the context bar, the account table and the settings.
	let { content = [], visibility, readOnly = false, current = false, size = "sm" }: {
		content?: Content[]; visibility?: "open" | "private"; readOnly?: boolean; current?: boolean; size?: "default" | "sm";
	} = $props();
</script>

{#each content as c (c)}<Badge variant="outline" {size}>{t(c === "notes" ? "spaces.content.notes" : "spaces.content.resources")}</Badge>{/each}
{#if visibility}<Badge variant={visibility === "private" ? "secondary" : "outline"} {size}>{t(visibility === "private" ? "spaces.visibility.private" : "spaces.visibility.open")}</Badge>{/if}
{#if readOnly}<Badge variant="caution" {size}>{t("spaces.readOnly")}</Badge>{/if}
{#if current}<Badge variant="secondary" {size}>{t("spaces.current.badge")}</Badge>{/if}
