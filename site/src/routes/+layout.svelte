<script lang="ts">
	import { features } from "#lib/features.js";
	import "../app.css";
	import { onMount } from "svelte";
	import { afterNavigate } from "$app/navigation";
	import { page } from "$app/state";
	import { favs } from "#lib/favs.svelte.js";
	import { search } from "#lib/search-state.svelte.js";
	import { parseQuery, token, wantsFav } from "#lib/query.js";
	import { theme } from "#lib/theme.svelte.js";
	import { lang } from "#lib/lang.svelte.js";
	import { intlLocale, t } from "#lib/i18n/index.js";
	import Icon from "#lib/components/icon.svelte";
	import CortexMark from "#lib/components/cortex-mark.svelte";
	import CortexWordmark from "#lib/components/cortex-wordmark.svelte";
	import SearchBox from "#lib/components/search-box.svelte";
	import OfflineStatus from "#lib/components/offline-status.svelte";
	import ThemeSwitch from "#lib/components/theme-switch.svelte";
	import LangSwitch from "#lib/components/lang-switch.svelte";
	import { toRoute } from "#lib/links.js";
	import { ensureSymbols } from "#lib/icons.js";
	import AssistantPanel from "#lib/components/assistant/assistant-panel.svelte";
	import AssistantAvatar from "#lib/components/assistant/assistant-avatar.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { assistant } from "#lib/assistant.svelte.js";

	let { children, data } = $props();
	const f = $derived(data.footer);
	const fmtDate = (d: string) => {
		const at = new Date(d);
		return t("footer.dateTime", { date: at.toLocaleDateString(intlLocale(), { day: "numeric", month: "long", year: "numeric" }), time: at.toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" }) });
	};
	let header = $state<HTMLElement | null>(null);

	// favorites, search history, theme and language: specific to this browser (localStorage)
	onMount(() => { theme.init(); lang.init(); search.init(); assistant.probe(); return favs.init(); });

	// Real height of the sticky header → offset of anchors and of the skip link (never two assumed heights)
	$effect(() => {
		if (!header) return;
		const el = header, root = document.documentElement;
		const set = () => root.style.setProperty("--anchor-offset", `${Math.ceil(el.getBoundingClientRect().height) + 8}px`);
		set();
		const ro = new ResizeObserver(set);
		ro.observe(el);
		return () => { ro.disconnect(); root.style.removeProperty("--anchor-offset"); };
	});

	// Ctrl+K and "/": focus on the visible search field (the page's one when it has a large one, otherwise the header's)
	function globalKeys(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		const typing = /^(input|textarea|select)$/i.test(target?.tagName ?? "") || target?.isContentEditable;
		if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey)) {
			e.preventDefault();
			search.focus();
		}
		// Ctrl+I (Cmd+I): the assistant, also from a text field
		else if (assistant.api && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "i") {
			e.preventDefault();
			assistant.setOpen(!assistant.open);
		}
	}
	// the home page starts again from an empty search; /search/ resumes its own from the URL
	// and the icon sprite gets the symbols of HTML injected with {@html} (exported callouts): the build-time scan only
	// covers the document the visitor landed on, not the pages reached by client navigation (also fires on the first
	// load, which covers the 404 shell)
	afterNavigate((nav) => { if (nav.to?.route.id === "/") search.q = ""; ensureSymbols(); });

	const nav = [
		["/search", "search", "nav.search"],
		["/graph", "graph", "nav.graph"],
		["/tags", "tags", "nav.tags"],
		["/log", "journal", "nav.log"],
	] as const;
	// active section: the route id also works at prerender (the relative URL cannot be compared)
	const current = (route: string) => page.route.id === route || page.route.id?.startsWith(`${route}/`);
	// "Favorites" = the search filtered on `is:fav` (same view everywhere); the shared query only exists in the browser
	const onFavs = $derived(page.route.id === "/search" && wantsFav(parseQuery(search.q)));
	// the home page and /search/ carry their own large field: no second field in the header
	const pageSearch = $derived(page.route.id === "/" || page.route.id === "/search");
</script>

<svelte:window onkeydown={globalKeys} />

{#key lang.current}
<a href="#main-content" class="bg-background focus:border-ring sr-only z-50 rounded-md border px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">{t("layout.skip")}</a>

<!-- DOM order = visual order (mark, navigation, search, theme) at all widths: tabbing follows the eye -->
<header bind:this={header} class="bg-header text-header-foreground border-header-border @container sticky top-0 z-40 border-b">
	<!-- breakpoints on the header's own width (@container): beside the docked assistant it is narrower than the viewport -->
	<!-- relative: anchor of the header search panel, which spans the whole header width -->
	<div class="relative mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 @5xl:px-8 @5xl:flex-nowrap @5xl:gap-x-6">
		<a href={toRoute("/")} class="inline-flex items-center gap-2 py-1 font-semibold tracking-tight" aria-current={page.route.id === "/" ? "page" : undefined}><CortexMark size={24} /><CortexWordmark /></a>
		<nav aria-label={t("nav.label")} class="flex items-center text-sm">
			{#each nav as [route, icon, label]}
				{@const here = current(route) && !(route === "/search" && onFavs)}
				<a href={toRoute(route)} aria-current={here ? "page" : undefined} class="nav-link"><Icon name={icon} size={20} /><span class="sr-only @xl:not-sr-only">{t(label)}</span></a>
			{/each}
			<a href="{toRoute('/search')}?q={encodeURIComponent(token('is', 'fav'))}" aria-current={onFavs ? "page" : undefined} class="nav-link"><Icon name="favorites" size={20} /><span class="sr-only @xl:not-sr-only">{t("favs.title")}</span></a>
		</nav>
		<div class="flex flex-wrap items-center gap-2 @5xl:flex-nowrap {pageSearch ? 'ml-auto' : 'basis-full @5xl:ml-auto @5xl:basis-auto @5xl:flex-1'}">
			{#if !pageSearch}<SearchBox wide class="min-w-0 flex-[1_1_12rem] @5xl:flex-1 @5xl:ml-auto @5xl:max-w-xl" />{/if}
			{#if assistant.api}
				<!-- label from the header's own width (@container): beside the docked panel the header has less room than the viewport
				     says; narrow, only the avatar stays and the label stays as the accessible name -->
				<Button id="assistant-toggle" variant="outline" class="gap-2 px-2 @6xl:px-3 [&_svg:not([class*='size-'])]:size-5" aria-expanded={assistant.open} aria-controls="assistant-panel" aria-keyshortcuts="Control+I Meta+I" title="{t('assistant.title')} (Ctrl I)"
					onclick={() => assistant.setOpen(!assistant.open)}>
					<AssistantAvatar state={assistant.pending ? "pending" : "idle"} size={20} /><span class="sr-only @6xl:not-sr-only">{t("assistant.title")}</span>
				</Button>
			{/if}
			<!-- preferences: apart from the search and the assistant by a rule, or on a line of their own when the header is narrow -->
			<div class="flex flex-wrap items-center gap-2">
				{#if assistant.api}<span class="bg-border mr-1 hidden h-5 w-px shrink-0 @xl:block" aria-hidden="true"></span>{/if}
				<ThemeSwitch />
				<LangSwitch />
			</div>
		</div>
	</div>
</header>

<main id="main-content" tabindex="-1" class="anchor-target mx-auto w-full max-w-7xl flex-1 px-4 py-8 lg:px-8 outline-none">
	{@render children()}
</main>

<footer class="text-muted-foreground border-t text-sm print:hidden">
	<div class="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
		<p>
			<a href={toRoute("/")} class="text-foreground font-semibold tracking-tight">Cortex</a>
			{#if f}<span aria-hidden="true">&nbsp;·&nbsp;</span>{t("footer.generated")} <time datetime={f.generatedAt}>{fmtDate(f.generatedAt)}</time>{/if}
			<span aria-hidden="true">&nbsp;·&nbsp;</span><a href={toRoute("/design-system")} class="hover:text-foreground">{t("footer.designSystem")}</a>
		</p>
		<!-- the layout data is absent on the static 404 fallback (no __data.json): the stats are skipped there -->
		{#if f}<ul class="flex flex-wrap gap-x-4 gap-y-1" aria-label={t("footer.stats")}>
			<li><a href="{toRoute('/search')}?q=" class="hover:text-foreground">{t("footer.pages", { count: f.pages })}</a>
				<span class="text-xs">({t("footer.concepts", { count: f.concepts })}, {t("footer.entities", { count: f.entities })}, {t("footer.syntheses", { count: f.syntheses })}, {t("footer.sources", { count: f.sources })})</span></li>
			<li><a href={toRoute("/graph")} class="hover:text-foreground">{t("footer.links", { count: f.links })}</a></li>
			<li><a href={toRoute("/tags")} class="hover:text-foreground">{t("footer.tags", { count: f.tags })}</a></li>
			{#if features.review}<li><a href="{toRoute('/search')}?q={encodeURIComponent(token('is', 'verified'))}" class="hover:text-foreground">{t("footer.reviewed", { verified: f.verified, pages: f.pages })}</a></li>{/if}
			<li><a href={toRoute("/log")} class="hover:text-foreground">{t("footer.log", { count: f.log })}</a></li>
		</ul>{/if}
	</div>
</footer>

<OfflineStatus />
{#if assistant.api}<AssistantPanel />{/if}
{/key}
<style>
	.nav-link {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--muted-foreground);
		text-underline-offset: 4px;
		padding: 0.5rem 0.55rem;
		border-radius: var(--radius-md);
		/* reserved on every link so the current one only changes colour: no layout shift */
		border-bottom: 2px solid transparent;
	}
	.nav-link:hover {
		color: var(--foreground);
		text-decoration: underline;
	}
	.nav-link[aria-current="page"] {
		color: var(--foreground);
		font-weight: 600;
		text-decoration: underline;
		border-bottom-color: var(--primary);
	}
	@media (pointer: coarse) {
		.nav-link {
			min-height: 2.75rem;
			min-width: 2.75rem;
			justify-content: center;
		}
	}
</style>
