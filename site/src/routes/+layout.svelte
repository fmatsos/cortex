<script lang="ts">
	import "../app.css";
	import { onMount } from "svelte";
	import { afterNavigate } from "$app/navigation";
	import { page } from "$app/state";
	import { favs } from "#lib/favs.svelte.js";
	import { search } from "#lib/search-state.svelte.js";
	import { theme } from "#lib/theme.svelte.js";
	import Icon from "#lib/components/icon.svelte";
	import SearchBox from "#lib/components/search-box.svelte";
	import OfflineStatus from "#lib/components/offline-status.svelte";
	import ThemeSwitch from "#lib/components/theme-switch.svelte";
	import { toRoute } from "#lib/links.js";

	let { children } = $props();
	let header = $state<HTMLElement | null>(null);

	// favoris, historique de recherche et thème : propres à ce navigateur (localStorage)
	onMount(() => { theme.init(); search.init(); return favs.init(); });

	// Hauteur réelle de l'en-tête collant → décalage des ancres et du lien d'évitement (jamais deux hauteurs supposées)
	$effect(() => {
		if (!header) return;
		const el = header, root = document.documentElement;
		const set = () => root.style.setProperty("--anchor-offset", `${Math.ceil(el.getBoundingClientRect().height) + 8}px`);
		set();
		const ro = new ResizeObserver(set);
		ro.observe(el);
		return () => { ro.disconnect(); root.style.removeProperty("--anchor-offset"); };
	});

	// Ctrl+K et « / » : focus sur le champ de recherche visible (celui de la page quand elle en a un grand, sinon celui de l'en-tête)
	function globalKeys(e: KeyboardEvent) {
		const t = e.target as HTMLElement | null;
		const typing = /^(input|textarea|select)$/i.test(t?.tagName ?? "") || t?.isContentEditable;
		if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey)) {
			e.preventDefault();
			search.focus();
		}
	}
	// l'accueil repart d'une recherche vide ; /search/ reprend la sienne dans l'URL
	afterNavigate((nav) => { if (nav.to?.route.id === "/") search.q = ""; });

	const nav = [
		["/search", "search", "Recherche"],
		["/graph", "graph", "Graphe"],
		["/tags", "tags", "Tags"],
		["/log", "journal", "Journal"],
	] as const;
	// rubrique active : l'identifiant de route marche aussi au prérendu (l'URL relative ne se compare pas)
	const current = (route: string) => page.route.id === route || page.route.id?.startsWith(`${route}/`);
	// « Favoris » = la recherche filtrée `is:fav` (même vue partout) ; la requête partagée n'existe que dans le navigateur
	const onFavs = $derived(page.route.id === "/search" && /(^|\s)is:fav/i.test(search.q));
	// l'accueil et /search/ portent leur propre grand champ : pas de second champ dans l'en-tête
	const pageSearch = $derived(page.route.id === "/" || page.route.id === "/search");
</script>

<svelte:window onkeydown={globalKeys} />

<a href="#contenu-principal" class="bg-background focus:border-ring sr-only z-50 rounded-md border px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Aller au contenu</a>

<!-- ordre du DOM = ordre visuel (marque, navigation, recherche, thème) à toutes les largeurs : la tabulation suit l'œil -->
<header bind:this={header} class="bg-background/90 sticky top-0 z-40 border-b backdrop-blur">
	<div class="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 lg:px-8 lg:flex-nowrap lg:gap-x-6">
		<a href={toRoute("/")} class="py-1 font-semibold tracking-tight" aria-current={page.route.id === "/" ? "page" : undefined}>Second cerveau</a>
		<nav aria-label="Navigation principale" class="flex items-center text-sm">
			{#each nav as [route, icon, label]}
				{@const here = current(route) && !(route === "/search" && onFavs)}
				<a href={toRoute(route)} aria-current={here ? "page" : undefined} class="nav-link"><Icon name={icon} size={20} /><span class="sr-only sm:not-sr-only">{label}</span></a>
			{/each}
			<a href="{toRoute('/search')}?q=is%3Afav" aria-current={onFavs ? "page" : undefined} class="nav-link"><Icon name="favorites" size={20} /><span class="sr-only sm:not-sr-only">Favoris</span></a>
		</nav>
		<div class="flex items-center gap-2 {pageSearch ? 'ml-auto' : 'basis-full lg:ml-auto lg:basis-auto lg:flex-1'}">
			{#if !pageSearch}<SearchBox class="min-w-0 flex-1 lg:ml-auto lg:max-w-xl" />{/if}
			<ThemeSwitch />
		</div>
	</div>
</header>

<main id="contenu-principal" tabindex="-1" class="anchor-target mx-auto max-w-7xl px-4 py-8 lg:px-8 outline-none">
	{@render children()}
</main>

<OfflineStatus />
<style>
	.nav-link {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--muted-foreground);
		text-underline-offset: 4px;
		padding: 0.5rem 0.55rem;
		border-radius: var(--radius-md);
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
			min-height: 2.75rem;
			min-width: 2.75rem;
			justify-content: center;
		}
	}
</style>
