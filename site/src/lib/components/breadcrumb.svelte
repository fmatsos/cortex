<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import { collectionLabel, collectionQuery } from "#lib/article.js";
	import { toRoute } from "#lib/links.js";

	// Fil d'Ariane d'un article : Accueil → collection du type → page. La collection ouvre la recherche filtrée sur le type
	// (`/search/?q=type:concept`) ; un type inconnu n'a pas de collection et le maillon disparaît.
	let { type, title }: { type: string; title: string } = $props();
	const collection = $derived(collectionQuery(type));
	const link = "inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline touch-target";
</script>

<nav aria-label="Fil d'Ariane" class="mb-3 text-sm">
	<ol class="text-muted-foreground flex flex-wrap items-center gap-x-1 gap-y-1">
		<li><a href={toRoute("/")} class={link}><Icon name="home" size={16} />Accueil</a></li>
		{#if collection}
			<li class="inline-flex items-center gap-1"><Icon name="chevron-down" size={16} class="-rotate-90" /><a href="{toRoute('/search')}{collection}" class={link}>{collectionLabel(type)}</a></li>
		{/if}
		<li class="inline-flex min-w-0 items-center gap-1"><Icon name="chevron-down" size={16} class="-rotate-90" /><span aria-current="page" class="text-foreground min-w-0 font-medium">{title}</span></li>
	</ol>
</nav>
