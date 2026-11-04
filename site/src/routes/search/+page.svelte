<script lang="ts">
	import { onMount } from "svelte";
	import { replaceState } from "$app/navigation";
	import FilterChips from "#lib/components/filter-chips.svelte";
	import SearchBox from "#lib/components/search-box.svelte";
	import { favs } from "#lib/favs.svelte.js";
	import TypeBadge from "#lib/components/type-badge.svelte";
	import { toPage } from "#lib/links.js";
	import { type Engine, loadEngine, search } from "#lib/search-client.js";

	// page prérendue vide : la requête (?q=) ne se lit que dans le navigateur
	let q = $state("");
	let engine = $state<Engine>();
	let ready = $state(false);
	const hits = $derived(engine ? search(engine, q, favs.has, 50) : []);

	onMount(async () => {
		q = new URLSearchParams(location.search).get("q") ?? "";
		ready = true;
		engine = await loadEngine();
	});
	$effect(() => {
		if (!ready) return;
		try { replaceState(q.trim() ? `?q=${encodeURIComponent(q.trim())}` : location.pathname, {}); } catch { /* routeur pas encore prêt */ }
	});
</script>

<svelte:head><title>Recherche · Second cerveau</title></svelte:head>

<h1 class="text-3xl font-semibold tracking-tight">Recherche</h1>
<SearchBox bind:value={q} live class="mt-4 max-w-xl" />
<FilterChips bind:value={q} class="mt-2" />
<p class="text-muted-foreground mt-2 text-xs">Filtres : <code>#tag</code> <code>type:concept</code> <code>status:draft</code> <code>is:fav</code> <code>is:unverified</code> · <code>"phrase exacte"</code> · <code>-mot</code> <code>-#tag</code> pour exclure.</p>

<div class="mt-6" aria-live="polite">
	{#if q.trim() && engine}
		<p class="text-muted-foreground text-sm">{hits.length} résultat{hits.length > 1 ? "s" : ""}</p>
	{/if}
	<ul class="divide-border divide-y">
		{#each hits as h (h.doc.id)}
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
	{#if q.trim() && engine && !hits.length}<p class="text-muted-foreground py-8">Aucun résultat pour « {q} ».</p>{/if}
</div>
