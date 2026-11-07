<script lang="ts">
	import { onMount, tick } from "svelte";
	import { afterNavigate, goto } from "$app/navigation";
	import FilterChips from "#lib/components/filter-chips.svelte";
	import Icon from "#lib/components/icon.svelte";
	import ResultRow from "#lib/components/result-row.svelte";
	import SearchBox from "#lib/components/search-box.svelte";
	import SearchFacets from "#lib/components/search-facets.svelte";
	import { favs } from "#lib/favs.svelte.js";
	import { fold } from "#lib/fold.js";
	import { toPage, toRoute } from "#lib/links.js";
	import { diagnose, IS_VALUES, localizeQuery, parseQuery, removeToken, token, valueWords, wantsFav, withPassage } from "#lib/query.js";
	import { type Engine, facetCounts, loadEngine, search as run } from "#lib/search-client.js";
	import { search } from "#lib/search-state.svelte.js";
	import { typeIcon, typePlural } from "#lib/type-meta.js";
	import { t } from "#lib/i18n/index.js";

	let { data } = $props();
	const STEP = 50; // results displayed per slice
	// prerendered page empty: the query (?q=) is only read in the browser; afterwards the shared state (search.q) is authoritative for the screen
	let engine = $state<Engine>();
	let failed = $state(false);
	let ready = $state(false);
	let limit = $state(STEP);
	let filtersOpen = $state(false);
	let undoBtn = $state<HTMLButtonElement | null>(null);

	const q = $derived(search.q);
	const text = $derived(q.trim());
	const parsed = $derived(parseQuery(q));
	const res = $derived(engine ? run(engine, q, favs.has, limit) : { hits: [], total: 0 });
	const facets = $derived(engine ? facetCounts(engine, q, favs.has) : undefined);
	const tagSet = $derived(engine ? new Set(engine.docs.flatMap((d) => d.tags.map(fold))) : undefined);
	const issues = $derived(diagnose(parsed, tagSet));
	const noFav = $derived(wantsFav(parsed) && !favs.ids.length);
	const nOps = $derived(parsed.ops.length);
	const urlOf = (query: string) => `${toRoute("/search")}?q=${encodeURIComponent(query)}`;
	const titleOf = (id: string) => engine?.docs.find((d) => d.id === id)?.title ?? t("search.thePage");

	const load = () => { failed = false; loadEngine().then((e) => (engine = e), () => (failed = true)); };
	onMount(load);
	// Filters: on large screens they are always expanded (left column), on small screens in a collapsible block
	onMount(() => {
		const mq = matchMedia("(min-width: 1024px)");
		const sync = () => { if (mq.matches) filtersOpen = true; };
		sync();
		mq.addEventListener("change", sync);
		return () => mq.removeEventListener("change", sync);
	});
	// the URL is authoritative when arriving on a link with ?q= and with back / forward; an arrival without ?q= keeps the current query
	afterNavigate((nav) => {
		const url = nav.to?.url;
		const p = url?.searchParams.get("q") ?? "";
		if (url?.searchParams.has("q") || nav.type === "popstate") { if (p !== search.q.trim()) search.q = p; }
		ready = true;
	});
	// typing updates the URL in place (without a history entry)
	$effect(() => {
		const v = search.q.trim();
		limit = STEP;
		if (!ready || (new URLSearchParams(location.search).get("q") ?? "") === v) return;
		void goto(v ? urlOf(v) : toRoute("/search"), { shallow: true, replace: true, keepFocus: true, noScroll: true });
	});

	// Announcement for screen readers: number of results (zero included), only at the end of typing
	let announced = $state("");
	$effect(() => {
		const msg = !text ? "" : failed ? t("search.indexUnavailable") : !engine ? t("search.loadingIndex") : res.total ? `${t("search.results", { count: res.total })}.` : `${t("search.noResults")}.`;
		const id = setTimeout(() => (announced = msg), 500);
		return () => clearTimeout(id);
	});

	// removing a favorite from the favorites view makes the row disappear: focus moves to "Undo"
	const onRowClick = async (e: MouseEvent) => {
		const btn = (e.target as Element).closest("button[aria-pressed]");
		if (!btn) return;
		await tick();
		if (!btn.isConnected && favs.removed) undoBtn?.focus();
	};
	const fix = (raws: string[]) => { search.q = raws.reduce(removeToken, search.q); };
</script>

<svelte:head><title>{t("nav.search")} · Cortex</title></svelte:head>

<h1 class="text-3xl font-semibold tracking-tight">{t("nav.search")}</h1>
<SearchBox variant="main" live class="mt-4" />
<FilterChips bind:value={search.q} class="mt-3" />

<div class="mt-6 grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
	<aside aria-label={t("search.filters.label")}>
		<details bind:open={filtersOpen} class="rounded-lg border px-3 py-1 lg:border-0 lg:p-0">
			<summary class="flex min-h-11 items-center gap-2 text-sm font-semibold lg:hidden">
				<Icon name="filter" size={20} />{t("palette.filters")}{nOps ? ` (${t("search.filters.active", { count: nOps })})` : ""}
			</summary>
			{#if facets}
				<SearchFacets {facets} class="pb-3 lg:pb-0" />
			{:else}
				<p class="text-muted-foreground py-2 text-sm">{failed ? t("search.filters.unavailable") : t("search.filters.loading")}</p>
			{/if}
		</details>
	</aside>

	<section aria-label={t("search.resultsLabel")} class="min-w-0">
		<!-- visible counter (not announced on every keystroke); the announcement is in the status region below -->
		<p class="text-muted-foreground min-h-6 text-sm">
			{#if !text}
				{#if facets}{t("search.inWiki", { count: facets.total })}{/if}
			{:else if failed}
				<Icon name="error" size={16} class="inline" /> {t("search.indexUnavailable")}
				<button type="button" class="text-foreground inline-flex min-h-6 items-center gap-1 underline underline-offset-4" onclick={load}><Icon name="retry" size={16} />{t("common.retry")}</button>
			{:else if !engine}
				{t("search.loadingIndex")}
			{:else if res.total}
				{res.total > res.hits.length ? t("search.resultsPartial", { shown: res.hits.length, count: res.total }) : t("search.results", { count: res.total })}
			{:else}
				{t("search.noResults")}
			{/if}
		</p>
		<p class="sr-only" role="status">{announced}</p>

		{#each issues as issue (issue.text)}
			<div class="bg-warning-background text-warning-foreground mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm">
				<Icon name="warning" size={20} />
				<span class="min-w-48 flex-1">{issue.text}</span>
				<button type="button" class="hover:bg-warning-foreground/10 focus-visible:ring-ring/50 inline-flex min-h-8 items-center gap-1 rounded-md border border-current px-2.5 focus-visible:ring-3 pointer-coarse:min-h-11" onclick={() => fix(issue.raws)}>{issue.fix}</button>
			</div>
		{/each}

		{#if favs.removed}
			<p class="bg-muted mt-3 flex flex-wrap items-center gap-x-3 rounded-md border px-3 py-2 text-sm" role="status">
				{t("favs.removed", { title: titleOf(favs.removed) })}
				<button type="button" bind:this={undoBtn} class="text-foreground focus-visible:ring-ring/50 inline-flex min-h-8 items-center gap-1 rounded-md underline underline-offset-4 focus-visible:ring-3 pointer-coarse:min-h-11" onclick={() => favs.undo()}>{t("common.undo")}</button>
				<button type="button" class="text-muted-foreground hover:text-foreground ml-auto inline-flex min-h-8 min-w-8 items-center justify-center rounded-md pointer-coarse:min-h-11 pointer-coarse:min-w-11" aria-label={t("common.closeMessage")} onclick={() => favs.dismissUndo()}><Icon name="clear" size={16} /></button>
			</p>
		{/if}
		{#if !favs.persisted}
			<p class="bg-warning-background text-warning-foreground mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-sm" role="status"><Icon name="warning" size={20} />{t("favs.notPersisted")}</p>
		{/if}

		{#if text}
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
			<ul class="divide-border mt-2 divide-y" onclick={onRowClick}>
				{#each res.hits as h (h.doc.id)}
					<li class="py-4">
						<ResultRow doc={h.doc} href={withPassage(toPage(h.doc.id), q)} titleHtml={h.title} descriptionHtml={h.description} snippetHtml={h.snippet} showFav onopen={() => search.remember(q)} />
					</li>
				{/each}
			</ul>
			{#if res.total > res.hits.length}
				<button type="button" class="hover:bg-muted focus-visible:ring-ring/50 mt-4 min-h-9 rounded-md border px-3 py-1.5 text-sm focus-visible:ring-3 pointer-coarse:min-h-11" onclick={() => (limit += STEP)}>{t("search.showMore", { shown: res.hits.length, total: res.total })}</button>
			{/if}
			{#if engine && !res.total && !issues.length}
				<div class="py-6">
					<p class="font-medium">{noFav ? t("search.noFavsYet") : t("search.noMatch")}</p>
					<p class="text-muted-foreground mt-1 text-[0.9375rem]">
						{#if noFav}{t("search.noFavsYet.help")}
						{:else}{t("search.noMatch.help")}{/if}
					</p>
					<button type="button" class="hover:bg-muted focus-visible:ring-ring/50 mt-3 inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm focus-visible:ring-3 pointer-coarse:min-h-11" onclick={() => (search.q = "")}><Icon name="clear" size={16} />{t("search.clear")}</button>
				</div>
			{/if}
		{:else}
			<!-- empty search: what it takes to start (examples that give results on this wiki, frequent tags, collections, syntax) -->
			<div class="space-y-8 pt-2">
				{#if data.seed.examples.length}
					<section aria-labelledby="s-examples">
						<h2 id="s-examples" class="text-lg font-semibold">{t("search.try")}</h2>
						<ul class="mt-2 grid gap-2 sm:grid-cols-2">
							{#each data.seed.examples as ex (ex.q)}
								<li><a href={urlOf(localizeQuery(ex.q))} class="hover:bg-muted focus-visible:ring-ring/50 flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 focus-visible:ring-3"><code class="text-link">{localizeQuery(ex.q)}</code><span class="text-muted-foreground text-sm">{t(ex.hint)}</span></a></li>
							{/each}
						</ul>
					</section>
				{/if}
				<section aria-labelledby="s-collections">
					<h2 id="s-collections" class="text-lg font-semibold">{t("search.collections")}</h2>
					<ul class="mt-2 flex flex-wrap gap-2">
						{#each data.seed.types.filter((x) => x.count) as ty (ty.type)}
							<li><a href={urlOf(token("type", ty.type))} class="hover:bg-muted focus-visible:ring-ring/50 inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm focus-visible:ring-3"><Icon name={typeIcon(ty.type)} size={16} />{typePlural(ty.type)} <span class="text-muted-foreground">{ty.count}</span></a></li>
						{/each}
					</ul>
				</section>
				{#if data.seed.tags.length}
					<section aria-labelledby="s-tags">
						<h2 id="s-tags" class="text-lg font-semibold">{t("search.frequentTags")}</h2>
						<ul class="mt-2 flex flex-wrap gap-2">
							{#each data.seed.tags as tg (tg.tag)}
								<li><a href={urlOf(`#${tg.tag}`)} class="hover:bg-muted bg-secondary text-secondary-foreground focus-visible:ring-ring/50 inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm focus-visible:ring-3 pointer-coarse:min-h-11">#{tg.tag} <span class="text-muted-foreground">{tg.count}</span></a></li>
							{/each}
						</ul>
					</section>
				{/if}
				<section aria-labelledby="s-syntax">
					<h2 id="s-syntax" class="text-lg font-semibold">{t("search.operators")}</h2>
					<ul class="mt-2 space-y-2 text-[0.9375rem]">
						<li class="flex items-center gap-3"><Icon name="operator-tag" size={20} class="text-muted-foreground" /><code>#tag</code> <span class="text-muted-foreground">{t("search.or")}</span> <code>tag:{t("search.operators.name")}</code></li>
						<li class="flex items-center gap-3"><Icon name="operator-type" size={20} class="text-muted-foreground" /><code>{token("type", "Concept")}</code> <span class="text-muted-foreground">{valueWords("type")}</span></li>
						<li class="flex items-center gap-3"><Icon name="operator-status" size={20} class="text-muted-foreground" /><code>{token("status", "draft")}</code> {#each IS_VALUES as v (v)}<code>{token("is", v)}</code> {/each}</li>
						<li class="flex items-center gap-3"><Icon name="operator-phrase" size={20} class="text-muted-foreground" /><code>"{t("search.operators.phrase")}"</code></li>
						<li class="flex items-center gap-3"><Icon name="operator-exclude" size={20} class="text-muted-foreground" /><code>-{t("search.operators.word")}</code> <code>-#tag</code> <span class="text-muted-foreground">{t("search.operators.exclude")}</span></li>
					</ul>
					<p class="text-muted-foreground mt-3 text-sm">{t("search.operators.help")}</p>
				</section>
			</div>
		{/if}
	</section>
</div>
