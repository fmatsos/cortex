<script lang="ts">
	import { features } from "#lib/features.js";
	import "../app.css";
	import { onMount } from "svelte";
	import { afterNavigate } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import type { Footer } from "#lib/types.js";
	import { favs } from "#lib/favs.svelte.js";
	import { search } from "#lib/search-state.svelte.js";
	import { parseQuery, token, wantsFav } from "#lib/query.js";
	import { theme } from "#lib/theme.svelte.js";
	import { lang } from "#lib/lang.svelte.js";
	import { intlLocale, t } from "#lib/i18n/index.js";
	import Icon from "#lib/components/icon.svelte";
	import CortexWordmark from "#lib/components/cortex-wordmark.svelte";
	import SearchBox from "#lib/components/search-box.svelte";
	import SiteNav, { type NavItem } from "#lib/components/site-nav.svelte";
	import PreferencesMenu from "#lib/components/preferences-menu.svelte";
	import { toRoute } from "#lib/links.js";
	import { toPaths, toMaintenance } from "#lib/path-links.js";
	import { ensureSymbols } from "#lib/icons.js";
	import AssistantPanel from "#lib/components/assistant/assistant-panel.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { assistant } from "#lib/assistant.svelte.js";
	import { account } from "#lib/account.svelte.js";
	import { registerConversationActions } from "#lib/assistant-session.js";
	import { registerJourneyActions } from "#lib/journeys.js";
	import AuthNotice from "#lib/components/auth-notice.svelte";
	import BuildStatus from "#lib/components/build-status.svelte";
	import SpaceSwitcher from "#lib/components/space-switcher.svelte";
	import SpaceContext from "#lib/components/space-context.svelte";
	import { spaces } from "#lib/spaces.svelte.js";

	let { children } = $props();
	// what the account page can do with a saved conversation (resume in the panel, export) and journey (export): before its first render
	registerConversationActions();
	registerJourneyActions();
	// export date and figures: read from `footer.json` once the page is shown, not written into every page (see routes/footer.json).
	// Absent while loading and on failure (offline with no copy, static 404 fallback): the footer then only keeps its links.
	let f = $state<Footer>();
	const fmtDate = (d: string) => {
		const at = new Date(d);
		return t("footer.dateTime", { date: at.toLocaleDateString(intlLocale(), { day: "numeric", month: "long", year: "numeric" }), time: at.toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" }) });
	};
	let header = $state<HTMLElement | null>(null);

	// favorites, search history, theme and language: specific to this browser (localStorage); an account, when the server has
	// one, then keeps theme, language and favorites (account.init reads the stores, so it comes after them)
	onMount(() => {
		theme.init(); lang.init(); search.init(); assistant.probe(); const stop = favs.init(); void account.init().then(() => spaces.load());
		fetch(resolve("/footer.json")).then((r) => (r.ok ? r.json() : undefined)).then((v: Footer | undefined) => { f = v; }, () => {});
		return stop;
	});

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
	// and the return of a sign-in that failed (`?auth=`) is read once the router is up, announced and cleared from the URL
	afterNavigate((nav) => { if (nav.to?.route.id === "/") search.q = ""; ensureSymbols(); account.takeNotice(); });

	// active section: the route id also works at prerender (the relative URL cannot be compared)
	const current = (route: string) => page.route.id === route || !!page.route.id?.startsWith(`${route}/`);
	// "Favorites" = the search filtered on `is:fav` (same view everywhere); the shared query only exists in the browser
	const onFavs = $derived(page.route.id === "/search" && wantsFav(parseQuery(search.q)));
	// the home page and /search/ carry their own large field: no second field in the header
	const pageSearch = $derived(page.route.id === "/" || page.route.id === "/search");
	// Main navigation: to add a destination, add one entry here (site-nav.svelte lays it out wide and in the narrow "Menu")
	const nav = $derived<NavItem[]>([
		{ href: toRoute("/search"), icon: "search", label: "nav.search", here: current("/search") && !onFavs },
		{ href: toRoute("/graph"), icon: "graph", label: "nav.graph", here: current("/graph") },
		{ href: toRoute("/tags"), icon: "tags", label: "nav.tags", here: current("/tags") },
		{ href: toRoute("/log"), icon: "journal", label: "nav.log", here: current("/log") },
		// optional destinations: review only when it is turned on, paths only when the wiki has some (footer.json, once loaded)
		...(features.review ? [{ href: toRoute("/review"), icon: "needs-review", label: "nav.review", here: current("/review") } satisfies NavItem] : []),
		{ href: toRoute("/changes"), icon: "recent", label: "nav.changes", here: current("/changes") },
		...(f?.paths ? [{ href: toPaths(), icon: "journey", label: "nav.paths", here: current("/paths") } satisfies NavItem] : []),
		{ href: `${toRoute("/search")}?q=${encodeURIComponent(token("is", "fav"))}`, icon: "favorites", label: "favs.title", here: onFavs },
	]);
</script>

<svelte:window onkeydown={globalKeys} />

{#key lang.current}
<a href="#main-content" class="bg-background focus:border-ring sr-only z-50 rounded-md border px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">{t("layout.skip")}</a>

<!-- DOM order = visual order (mark, navigation, search, assistant, preferences) at all widths: tabbing follows the eye -->
<header bind:this={header} class="bg-header text-header-foreground border-header-border @container sticky top-0 z-40 border-b">
	<!-- breakpoints on the header's own width (@container): beside the docked assistant it is narrower than the viewport -->
	<!-- relative: anchor of the header search panel, which spans the whole header width -->
	<div class="relative mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 @5xl:px-8 @7xl:flex-nowrap @7xl:gap-x-6">
		<!-- a rebuild of the site (cortex serve only): a dot hung beside the mark while it runs (out of the flow: the row never wraps
		     differently), a reload offer under it when it ends -->
		<div class="relative inline-flex">
			<a href={toRoute("/")} class="inline-flex items-center gap-2 py-1 font-semibold tracking-tight" aria-current={page.route.id === "/" ? "page" : undefined}><CortexWordmark /></a>
			<BuildStatus />
		</div>
		<SpaceSwitcher />
		<SiteNav items={nav} />
		<!-- search | assistant | preferences. Narrow: a row of its own below the mark and the navigation; wide: the search takes the room left -->
		<div class="flex items-center gap-2 {pageSearch ? 'ml-auto' : 'basis-full @7xl:ml-auto @7xl:basis-auto @7xl:flex-1'}">
			{#if !pageSearch}<SearchBox wide class="min-w-0 flex-1 @7xl:ml-auto @7xl:max-w-xl" />{/if}
			{#if assistant.api}
				<!-- label from the header's own width (@container): beside the docked panel the header has less room than the viewport
				     says; narrow, only the icon stays and the label stays as the accessible name -->
				<Button id="assistant-toggle" variant="outline" class="gap-2 px-2 @6xl:px-3 [&_svg:not([class*='size-'])]:size-5" aria-expanded={assistant.open} aria-controls="assistant-panel" aria-keyshortcuts="Control+I Meta+I" aria-busy={assistant.pending || undefined} title="{t('assistant.title')} (Ctrl I)"
					onclick={() => assistant.setOpen(!assistant.open)}>
					<Icon name="assistant" size={20} class={assistant.pending ? "motion-safe:animate-pulse" : ""} /><span class="sr-only @6xl:not-sr-only">{t("assistant.title")}</span>
				</Button>
			{/if}
			<PreferencesMenu />
			<!-- help: right after the account / preferences button, same size and label rule; a link (the help page), so it is marked as the current page there -->
			<Button href={toRoute("/help")} variant="outline" class="aria-[current=page]:bg-muted gap-2 px-2 @6xl:px-3 [&_svg:not([class*='size-'])]:size-5" aria-current={current("/help") ? "page" : undefined} title={t("help.label")}>
				<Icon name="help" size={20} /><span class="sr-only @6xl:not-sr-only">{t("help.label")}</span>
			</Button>
		</div>
	</div>
</header>

<SpaceContext />
<AuthNotice />

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
			{#if f.paths}<li><a href={toPaths()} class="hover:text-foreground">{t("footer.paths")}</a></li>{/if}
			<li><a href={toMaintenance()} class="hover:text-foreground">{t("footer.maintenance")}</a></li>
		</ul>{/if}
	</div>
</footer>

{#if assistant.api}<AssistantPanel />{/if}
{/key}
