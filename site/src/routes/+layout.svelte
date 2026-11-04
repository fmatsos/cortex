<script lang="ts">
	import "../app.css";
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import { favs } from "#lib/favs.svelte.js";
	import { theme } from "#lib/theme.svelte.js";
	import SearchBox from "#lib/components/search-box.svelte";
	import ThemeSwitch from "#lib/components/theme-switch.svelte";
	import { toRoute } from "#lib/links.js";

	let { children } = $props();
	onMount(() => { theme.init(); return favs.init(); }); // favoris et thème : propres à ce navigateur (localStorage)

	const nav = [
		["/graph", "Graphe"],
		["/tags", "Tags"],
		["/log", "Journal"],
	] as const;
	// rubrique active : l'identifiant de route marche aussi au prérendu (l'URL relative ne se compare pas)
	const current = (route: string) => page.route.id === route || page.route.id?.startsWith(`${route}/`);
	// « Favoris » = la recherche filtrée `is:fav` ; la requête n'est lisible que dans le navigateur
	let onFavs = $state(false);
	$effect(() => { onFavs = page.route.id === "/search" && /(^|\s)is:fav/i.test(page.url.searchParams.get("q") ?? ""); });
</script>

<a href="#contenu-principal" class="bg-background focus:border-ring sr-only z-50 rounded-md border px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Aller au contenu</a>

<header class="bg-background/90 sticky top-0 z-40 border-b backdrop-blur">
	<div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
		<a href={toRoute("/")} class="font-semibold tracking-tight" aria-current={page.route.id === "/" ? "page" : undefined}>Second cerveau</a>
		<nav aria-label="Navigation principale" class="flex flex-wrap gap-x-4 text-sm pointer-coarse:gap-x-5">
			{#each nav as [route, label]}
				<a href={toRoute(route)} aria-current={current(route) ? "page" : undefined} class="nav-link">{label}</a>
			{/each}
			<a href="{toRoute('/search')}?q=is%3Afav" aria-current={onFavs ? "page" : undefined} class="nav-link">Favoris</a>
		</nav>
		<ThemeSwitch class="sm:order-last" />
		<SearchBox global class="order-last w-full sm:order-none sm:ml-auto sm:w-72" />
	</div>
</header>

<main id="contenu-principal" class="mx-auto max-w-6xl px-4 py-8">
	{@render children()}
</main>

<style>
	.nav-link {
		color: var(--muted-foreground);
		text-underline-offset: 4px;
		padding-block: 0.25rem;
	}
	.nav-link:hover {
		color: var(--foreground);
		text-decoration: underline;
	}
	.nav-link[aria-current="page"] {
		color: var(--foreground);
		font-weight: 600;
		text-decoration: underline;
	}
	@media (pointer: coarse) {
		.nav-link {
			padding-block: 0.7rem;
		}
	}
</style>
