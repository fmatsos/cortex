<script lang="ts">
	import "../app.css";
	import { onMount } from "svelte";
	import { favs } from "#lib/favs.svelte.js";
	import { theme } from "#lib/theme.svelte.js";
	import SearchBox from "#lib/components/search-box.svelte";
	import { toRoute } from "#lib/links.js";

	let { children } = $props();
	onMount(() => { theme.init(); return favs.init(); }); // favoris et thème : propres à ce navigateur (localStorage)
	const nav = [
		["/graph", "Graphe"],
		["/tags", "Tags"],
		["/log", "Journal"],
	] as const;
</script>

<a href="#contenu" class="bg-background focus:border-ring sr-only z-50 rounded-md border px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Aller au contenu</a>

<header class="bg-background/90 sticky top-0 z-40 border-b backdrop-blur">
	<div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
		<a href={toRoute("/")} class="font-semibold tracking-tight">Second cerveau</a>
		<nav aria-label="Navigation principale" class="flex gap-4 text-sm">
			{#each nav as [route, label]}
				<a href={toRoute(route)} class="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline">{label}</a>
			{/each}
		</nav>
		<SearchBox global class="order-last w-full sm:order-none sm:ml-auto sm:w-72" />
	</div>
</header>

<main id="contenu" class="mx-auto max-w-6xl px-4 py-8">
	{@render children()}
</main>
