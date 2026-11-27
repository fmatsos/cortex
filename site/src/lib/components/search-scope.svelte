<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import { labelOf, spaces } from "#lib/spaces.svelte.js";
	import { t } from "#lib/i18n/index.js";

	// Where a search looks. The site searches its own space only: the scope is said, not chosen (the server has no search across
	// spaces for the site).
	const info = $derived(spaces.available ? spaces.info : undefined);
</script>

{#if info}
	<p class="text-muted-foreground mt-2 flex flex-wrap items-center gap-1.5 text-sm"><Icon name="space" size={16} />{t("spaces.search.scope")} <strong class="text-foreground font-semibold">{labelOf(info)}</strong></p>
{/if}
