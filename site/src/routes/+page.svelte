<script lang="ts">
	import PageList from "#lib/components/page-list.svelte";
	import { favs } from "#lib/favs.svelte.js";
	import { toRoute } from "#lib/links.js";
	import { TYPES, typeColor } from "#lib/type-meta.js";

	let { data } = $props();
</script>

<svelte:head><title>Second cerveau</title></svelte:head>

<h1 class="text-3xl font-semibold tracking-tight">Second cerveau</h1>
<p class="text-muted-foreground mt-2">
	{data.pages.length} pages, {data.nbTags} tags.
	<a href={toRoute("/graph")} class="text-link underline underline-offset-4">Voir le graphe des liens</a>.
</p>

{#if favs.ids.length}
	<section id="favoris" aria-labelledby="h-favoris" class="mt-8">
		<h2 id="h-favoris" class="text-xl font-semibold">★ Favoris <span class="text-muted-foreground text-sm font-normal">(propres à ce navigateur)</span></h2>
		<PageList pages={data.pages.filter((p) => favs.has(p.id))} />
	</section>
{/if}

<div class="mt-8 grid gap-10 lg:grid-cols-2">
	{#each TYPES as t (t.type)}
		{@const pages = data.pages.filter((p) => p.type === t.type)}
		{#if pages.length}
			<section aria-labelledby="h-{t.type}">
				<h2 id="h-{t.type}" class="flex items-center gap-2 text-xl font-semibold">
					<span class="inline-block size-3 rounded-full" style:background={typeColor(t.type)} aria-hidden="true"></span>
					{t.plural} <span class="text-muted-foreground text-sm font-normal">({pages.length})</span>
				</h2>
				<PageList {pages} />
			</section>
		{/if}
	{/each}
</div>
