<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import CortexMark from "#lib/components/cortex-mark.svelte";
	import CortexWordmark from "#lib/components/cortex-wordmark.svelte";
	import PageList from "#lib/components/page-list.svelte";
	import SearchBox from "#lib/components/search-box.svelte";
	import { favs } from "#lib/favs.svelte.js";
	import { toRoute } from "#lib/links.js";
	import { type Engine, loadEngine } from "#lib/search-client.js";
	import { search } from "#lib/search-state.svelte.js";
	import { typeColor, typeIcon } from "#lib/type-meta.js";

	let { data } = $props();
	const FAVS_SHOWN = 6;
	const urlOf = (q: string) => `${toRoute("/search")}?q=${encodeURIComponent(q)}`;

	// Les favoris sont propres à ce navigateur : on les retrouve dans l'index de recherche (chargé seulement s'il y en a)
	let engine = $state<Engine>();
	$effect(() => { if (favs.ids.length && !engine) loadEngine().then((e) => (engine = e), () => {}); });
	const favDocs = $derived(engine ? engine.docs.filter((d) => favs.has(d.id)).sort((a, b) => a.title.localeCompare(b.title, "fr")) : []);
</script>

<svelte:head><title>Cortex</title></svelte:head>

<!-- la recherche est la porte d'entrée : un grand champ, des exemples qui donnent des résultats, les recherches récentes -->
<section aria-labelledby="h-accueil" class="mx-auto max-w-3xl pt-2 pb-6 sm:pt-8">
	<h1 id="h-accueil" class="flex items-center gap-3 text-3xl font-semibold tracking-tight"><CortexMark size={44} animated class="text-primary" /><CortexWordmark /></h1>
	<p class="text-muted-foreground mt-2">
		{data.seed.total} pages et {data.seed.nbTags} tags à parcourir, ou
		<a href={toRoute("/graph")} class="text-link link-content underline underline-offset-4">le graphe des liens</a>.
	</p>
	<SearchBox variant="main" class="mt-5" />
	{#if data.seed.examples.length}
		<ul class="touch-gap mt-4 flex flex-wrap items-center gap-2" aria-label="Exemples de recherches">
			<li class="text-muted-foreground text-sm" aria-hidden="true">Essayer :</li>
			{#each data.seed.examples as ex (ex.q)}
				<li><a href={urlOf(ex.q)} title={ex.hint} class="hover:bg-muted bg-card focus-visible:ring-ring/50 inline-flex min-h-8 items-center rounded-full border px-3 text-sm focus-visible:ring-3 pointer-coarse:min-h-11"><code>{ex.q}</code><span class="sr-only"> : {ex.hint}</span></a></li>
			{/each}
		</ul>
	{/if}
	{#if search.recent.length}
		<section aria-labelledby="h-recents" class="mt-5">
			<div class="flex items-center gap-3">
				<h2 id="h-recents" class="text-muted-foreground flex items-center gap-1.5 text-sm font-semibold"><Icon name="recent" size={16} />Recherches récentes</h2>
				<button type="button" class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-sm underline underline-offset-4 focus-visible:ring-3 pointer-coarse:min-h-11" onclick={() => search.forget()}>Effacer l'historique</button>
			</div>
			<ul class="touch-gap mt-1.5 flex flex-wrap gap-2">
				{#each search.recent as r (r)}
					<li><a href={urlOf(r)} class="hover:bg-muted focus-visible:ring-ring/50 inline-flex min-h-8 items-center rounded-md border px-2.5 text-sm focus-visible:ring-3 pointer-coarse:min-h-11">{r}</a></li>
				{/each}
			</ul>
		</section>
	{/if}
</section>

{#if favs.ids.length}
	<section id="favoris" aria-labelledby="h-favoris" class="mt-6">
		<h2 id="h-favoris" class="anchor-target flex items-center gap-2 text-xl font-semibold"><Icon name="favorites" size={24} class="text-favorite" />Favoris <span class="text-muted-foreground text-sm font-normal">({favs.ids.length}, propres à ce navigateur)</span></h2>
		{#if engine}
			<PageList pages={favDocs.slice(0, FAVS_SHOWN)} filter={false} showFav />
			{#if favDocs.length > FAVS_SHOWN}
				<a href={urlOf("is:fav")} class="text-link link-content mt-2 inline-flex min-h-9 items-center underline underline-offset-4">Voir tous mes favoris ({favDocs.length})</a>
			{/if}
		{:else}
			<p class="text-muted-foreground mt-2 text-sm">Chargement des favoris…</p>
		{/if}
		{#if !favs.persisted}<p class="text-warning-foreground mt-2 text-sm" role="status">Favoris conservés pour cette session seulement : le navigateur refuse de les enregistrer.</p>{/if}
	</section>
{/if}

<!-- aperçu borné par collection, quelle que soit la taille du wiki ; la vue complète est la recherche filtrée (par tranches) -->
<div class="mt-10 grid gap-6 lg:grid-cols-2 2xl:grid-cols-4">
	{#each data.collections as c (c.type)}
		<section aria-labelledby="h-{c.type}" class="bg-muted/40 rounded-lg border p-4">
			<h2 id="h-{c.type}" class="anchor-target flex items-center gap-2 text-xl font-semibold">
				<Icon name={typeIcon(c.type)} size={24} style="color: {typeColor(c.type)}" />
				{c.plural} <span class="text-muted-foreground text-sm font-normal">({c.count})</span>
			</h2>
			<PageList pages={c.preview} filter={false} showType={false} />
			{#if c.count > c.preview.length}
				<a href={urlOf(`type:${c.type.toLowerCase()}`)} class="text-link link-content mt-2 inline-flex min-h-9 items-center gap-1 underline underline-offset-4 pointer-coarse:min-h-11">Voir tout : {c.plural.toLowerCase()} ({c.count})</a>
			{/if}
		</section>
	{/each}
</div>

