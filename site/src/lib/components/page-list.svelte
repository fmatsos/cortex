<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import ResultRow from "#lib/components/result-row.svelte";
	import { toPage } from "#lib/links.js";
	import { TYPES, typeColor, typeIcon, typeLabel } from "#lib/type-meta.js";

	/**
	 * Liste de pages (accueil, tags, favoris) avec la ligne commune ResultRow : type, titre, état de confiance, description.
	 * `filter` : filtre par type (quand la liste en mélange plusieurs), utile sur une page de tag ; faux pour une liste déjà d'un seul type.
	 */
	type P = { id: string; type: string; title: string; description: string; status: string; verified?: boolean; needsReview?: boolean; partial?: boolean };
	let { pages, filter = true, showFav = false }: { pages: P[]; filter?: boolean; showFav?: boolean } = $props();

	let only = $state("");
	const types = $derived(TYPES.map((t) => t.type).filter((t) => pages.some((p) => p.type === t)));
	const shown = $derived(only ? pages.filter((p) => p.type === only) : pages);
</script>

{#if filter && types.length > 1}
	<div class="touch-gap mt-3 mb-1 flex flex-wrap gap-2" role="group" aria-label="Filtrer par type">
		{#each types as t (t)}
			<button
				type="button"
				aria-pressed={only === t}
				onclick={() => (only = only === t ? "" : t)}
				class="touch-target hover:bg-muted aria-pressed:bg-accent aria-pressed:text-accent-foreground aria-pressed:border-foreground/40 focus-visible:ring-ring/50 inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-sm focus-visible:ring-3"
			>
				<Icon name={typeIcon(t)} size={16} style="color: {typeColor(t)}" />
				{typeLabel(t)} <span class="text-muted-foreground">{pages.filter((p) => p.type === t).length}</span>
			</button>
		{/each}
	</div>
	<p class="sr-only" role="status">{only ? `${shown.length} page${shown.length > 1 ? "s" : ""} de type ${typeLabel(only)}` : `${pages.length} pages`}</p>
{/if}

<ul class="divide-border divide-y">
	{#each shown as p (p.id)}
		<li class="py-3.5"><ResultRow doc={p} href={toPage(p.id)} {showFav} /></li>
	{/each}
</ul>
