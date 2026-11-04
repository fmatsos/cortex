<script lang="ts">
	import { onMount } from "svelte";
	import { afterNavigate, goto } from "$app/navigation";
	import FilterChips from "#lib/components/filter-chips.svelte";
	import SearchBox from "#lib/components/search-box.svelte";
	import { favs } from "#lib/favs.svelte.js";
	import TypeBadge from "#lib/components/type-badge.svelte";
	import { toPage, toRoute } from "#lib/links.js";
	import { parseQuery, wantsFav } from "#lib/query.js";
	import { type Engine, loadEngine, search } from "#lib/search-client.js";

	const STEP = 50; // résultats affichés par tranche
	// page prérendue vide : la requête (?q=) ne se lit que dans le navigateur
	let q = $state("");
	let engine = $state<Engine>();
	let failed = $state(false);
	let ready = $state(false);
	let limit = $state(STEP);
	const res = $derived(engine ? search(engine, q, favs.has, limit) : { hits: [], total: 0 });
	const noFav = $derived(wantsFav(parseQuery(q)) && !favs.ids.length);

	const load = () => { failed = false; loadEngine().then((e) => (engine = e), () => (failed = true)); };
	onMount(load);
	// l'URL fait foi : à l'arrivée, après un envoi depuis l'en-tête, avec précédent / suivant
	afterNavigate((nav) => {
		const p = nav.to?.url.searchParams.get("q") ?? "";
		if (p !== q.trim()) q = p;
		ready = true;
	});
	// la saisie met l'URL à jour sur place (sans entrée d'historique)
	$effect(() => {
		const t = q.trim();
		limit = STEP;
		if (!ready || (new URLSearchParams(location.search).get("q") ?? "") === t) return;
		void goto(t ? `${toRoute("/search")}?q=${encodeURIComponent(t)}` : toRoute("/search"), { shallow: true, replace: true, keepFocus: true, noScroll: true });
	});
</script>

<svelte:head><title>Recherche · Second cerveau</title></svelte:head>

<h1 class="text-3xl font-semibold tracking-tight">Recherche</h1>
<SearchBox bind:value={q} live class="mt-4 max-w-xl" />
<FilterChips bind:value={q} class="mt-2" />
<p class="text-muted-foreground mt-2 text-xs">Filtres : <code>#tag</code> <code>type:concept</code> <code>status:draft</code> <code>is:fav</code> <code>is:unverified</code> · <code>"phrase exacte"</code> · <code>-mot</code> <code>-#tag</code> pour exclure.</p>

<div class="mt-6">
	<div role="status" class="text-muted-foreground text-sm">
		{#if !q.trim()}
			<!-- rien à afficher -->
		{:else if failed}
			Index de recherche indisponible.
			<button type="button" class="text-foreground underline underline-offset-4" onclick={load}>Réessayer</button>
		{:else if !engine}
			Chargement de l'index…
		{:else if res.total}
			{res.total > res.hits.length ? `${res.hits.length} sur ${res.total}` : res.total} résultat{res.total > 1 ? "s" : ""}
		{/if}
	</div>
	<ul class="divide-border divide-y">
		{#each res.hits as h (h.doc.id)}
			<li class="py-4">
				<div class="flex flex-wrap items-center gap-2">
					<a href={toPage(h.doc.id)} class="text-link font-medium underline-offset-4 hover:underline">{@html h.title}</a>
					<TypeBadge type={h.doc.type} />
				</div>
				<p class="text-muted-foreground mt-1 text-sm">{@html h.description}</p>
				{#if h.snippet}<p class="mt-1 text-sm">{@html h.snippet}</p>{/if}
			</li>
		{/each}
	</ul>
	{#if res.total > res.hits.length}
		<button type="button" class="hover:bg-muted mt-4 rounded-md border px-3 py-1.5 text-sm" onclick={() => (limit += STEP)}>Afficher davantage ({res.hits.length} sur {res.total})</button>
	{/if}
	{#if q.trim() && engine && !res.total}
		<p class="text-muted-foreground py-8">
			{noFav ? "Aucun favori : ajoutez-en avec l'étoile ★ d'une page." : `Aucun résultat pour « ${q.trim()} ».`}
			<button type="button" class="text-foreground underline underline-offset-4" onclick={() => (q = "")}>Effacer la recherche</button>
		</p>
	{/if}
</div>
