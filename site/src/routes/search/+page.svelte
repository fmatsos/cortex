<script lang="ts">
	import { onMount, tick, untrack } from "svelte";
	import { afterNavigate, goto } from "$app/navigation";
	import FilterChips from "#lib/components/filter-chips.svelte";
	import Icon from "#lib/components/icon.svelte";
	import ResultRow from "#lib/components/result-row.svelte";
	import SearchBox from "#lib/components/search-box.svelte";
	import SearchScope from "#lib/components/search-scope.svelte";
	import SearchFacets from "#lib/components/search-facets.svelte";
	import { favs } from "#lib/favs.svelte.js";
	import { fold } from "#lib/fold.js";
	import { toPage, toRoute } from "#lib/links.js";
	import { activeValues, diagnose, IS_VALUES, localizeQuery, parseQuery, removeToken, token, valueWords, wantsFav, withPassage } from "#lib/query.js";
	import { type Engine, facetCounts, facetsOf, highlight, loadEngine, rank as localRank, search as run } from "#lib/search-client.js";
	import { cachedHybrid, cachedJudged, hybrid, judged, probe, rows as serverRows, sections, worthAsking, type Hybrid, type Judged, type Row } from "#lib/server-search.js";
	import type { SearchDoc } from "#lib/types.js";
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

	// The server (`cortex serve`): on a validated search only, its hybrid results take the top of the list as soon as they come, then the
	// judge's ranking groups them. The server ranks at most SERVER_LIMIT pages and has no total: the local matches it did not return
	// follow, in the site's own order, so that no match is ever lost. Static site (no /api/search): none of this exists, the local
	// results are the answer.
	type Server = { q: string; res: Hybrid; phase: "judging" | "judged" | "plain"; judged?: Judged };
	let server = $state<Server>();
	const srv = $derived(server && server.q === text && engine ? server : undefined);
	const srvRows = $derived(srv ? serverRows(engine!, parsed, srv.res, favs.has) : []);
	const onServer = $derived(!!srv && srvRows.length > 0);
	const srvIds = $derived(new Set(srvRows.map((r) => r.doc.id)));
	// the local matches the server's list does not hold: their exact total, and the slice displayed (`limit`)
	const res = $derived(engine ? run(engine, q, favs.has, limit, onServer ? srvIds : undefined) : { hits: [], total: 0 });
	const restDocs = $derived(engine && onServer ? localRank(engine, parsed, favs.has).map((r) => r.doc).filter((d) => !srvIds.has(d.id)) : []);
	const grouped = $derived(onServer && srv?.phase === "judged" ? sections(srvRows) : undefined);
	const judging = $derived(!!srv && srv.phase === "judging");
	const total = $derived(onServer ? srvRows.length + res.total : res.total);
	const localFacets = $derived(engine ? facetCounts(engine, q, favs.has) : undefined);
	// the counters follow the displayed results (the server's rows and the rest); type and status, which a click replaces, keep the alternatives' counts while their operator is active
	const facets = $derived.by(() => {
		if (!engine || !onServer || !localFacets) return localFacets;
		const f = facetsOf([...srvRows.map((r) => r.doc), ...restDocs], favs.has);
		return { ...f, type: activeValues(parsed, "type").size ? localFacets.type : f.type, status: activeValues(parsed, "status").size ? localFacets.status : f.status };
	});

	type View = { doc: SearchDoc; titleHtml: string; descriptionHtml: string; snippetHtml: string; note?: string };
	const viewOf = (r: Row): View => {
		const extract = r.hit.match === "filter" ? "" : r.hit.extract.length > 320 ? `${r.hit.extract.slice(0, 320)} …` : r.hit.extract;
		return { doc: r.doc, titleHtml: highlight(r.doc.title, parsed), descriptionHtml: highlight(r.doc.description, parsed), snippetHtml: extract && extract !== r.doc.description ? highlight(extract, parsed) : "", note: r.hit.match === "semantic" ? t("search.match.semantic") : undefined };
	};
	// The folded groups ("Other results", "Other matches"): open by default only when nothing else would be visible; the visitor's own
	// toggle wins over the default, and a new search forgets it.
	let otherOpen = $state<boolean>();
	let moreOpen = $state<boolean>();
	const top = $derived(!!grouped && grouped.retained.length + grouped.related.length > 0);
	const isOtherOpen = $derived(otherOpen ?? !top);
	const isMoreOpen = $derived(moreOpen ?? (!grouped || (!top && !grouped.other.length)));

	// Focus follows the page and the action, not the element: the ranking replaces the list (local, then hybrid, then groups), which
	// destroys the focused link or star. Where focus was is remembered by page id and action, and restored once the new list is drawn,
	// unfolding the group that now holds the page when needed.
	type Spot = { id: string; action: string };
	let results = $state<HTMLElement | null>(null);
	let spot: Spot | undefined;
	const spotOf = (el: Element | null): Spot | undefined => {
		const row = el?.closest<HTMLElement>("[data-page]");
		return row ? { id: row.dataset.page!, action: el!.closest<HTMLElement>("[data-row-action]")?.dataset.rowAction ?? "open" } : undefined;
	};
	const onFocusIn = (e: FocusEvent) => { spot = spotOf(e.target as Element); };
	// focus that leaves the results for good forgets the spot; an element that was merely removed (the list changed) keeps it
	const onFocusOut = (e: FocusEvent) => {
		const el = e.target as Element;
		setTimeout(() => { if (el.isConnected && !results?.contains(document.activeElement)) spot = undefined; });
	};
	const find = (w: Spot) => results?.querySelector<HTMLElement>(`[data-page="${CSS.escape(w.id)}"] [data-row-action="${w.action}"]`) ?? undefined;
	async function restoreFocus(w: Spot) {
		let el = find(w);
		if (!el) return;
		const closed = el.closest<HTMLDetailsElement>("details:not([open])");
		if (closed) {
			if (closed.dataset.group === "more") moreOpen = true; else otherOpen = true;
			await tick();
			el = find(w);
		}
		el?.focus();
	}
	$effect(() => {
		void [srvRows, grouped, res.hits];
		const w = spot, a = document.activeElement;
		if (w && results && (!a || a === document.body)) untrack(() => void restoreFocus(w));
	});

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
		if (url?.searchParams.has("q") || nav.type === "popstate") {
			if (p !== search.q.trim()) search.q = p;
			// arriving with ?q=, a link, back / forward: a validated search. The in-place update of the URL while typing is not.
			if (!(nav.type === "goto" && nav.from?.route.id === nav.to?.route.id)) search.validated = p.trim();
		}
		ready = true;
	});

	// A validated search goes to the server (when it has the API): the hybrid results at once, and the judge's ranking in parallel.
	// Changing the query cancels both (the cleanup aborts the requests, and an answer for another query is never displayed). The
	// caches of server-search.ts answer a query seen again without asking twice.
	$effect(() => {
		const v = search.validated.trim();
		server = undefined;
		otherOpen = moreOpen = undefined;
		if (!v || !worthAsking(v)) return;
		const ctl = new AbortController();
		let final = false;
		const apply = (s: Server) => { if (!ctl.signal.aborted) server = s; };
		void untrack(async () => {
			try {
				if (!(await probe()) || ctl.signal.aborted) return;
				const done = cachedJudged(v);
				if (done) return apply({ q: v, res: done, phase: done.judged ? "judged" : "plain", judged: done });
				const early = cachedHybrid(v);
				if (early) apply({ q: v, res: early, phase: "judging" });
				const hyb = early ? Promise.resolve() : hybrid(v, ctl.signal).then((r) => { if (!final) apply({ q: v, res: r, phase: "judging" }); }, () => {});
				try {
					const j = await judged(v, ctl.signal);
					final = true;
					apply({ q: v, res: j, phase: j.judged ? "judged" : "plain", judged: j });
				} catch {
					// busy twice, a failing judge or the network: the plain hybrid display, without a message
					await hyb;
					final = true;
					if (server?.q === v) apply({ ...server, phase: "plain" });
				}
			} catch { /* offline: the local results stay */ }
		});
		return () => ctl.abort();
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
		const msg = !text ? "" : failed ? t("search.indexUnavailable") : !engine ? t("search.loadingIndex") : total ? `${t("search.results", { count: total })}.` : `${t("search.noResults")}.`;
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
	const fix = (raws: string[]) => search.apply(raws.reduce(removeToken, search.q));
</script>

<svelte:head><title>{t("nav.search")} · Cortex</title></svelte:head>

<h1 class="text-3xl font-semibold tracking-tight">{t("nav.search")}</h1>
<SearchBox variant="main" live class="mt-4" />
<SearchScope />
<FilterChips bind:value={() => search.q, (v) => search.apply(v)} class="mt-3" />


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

	<section aria-labelledby="pages-h" class="min-w-0">
		<h2 id="pages-h" class="sr-only">{t("search.resultsLabel")}</h2>
		<!-- visible counter (not announced on every keystroke); the announcement is in the status region below -->
		<p class="text-muted-foreground min-h-6 text-sm">
			{#if !text}
				{#if facets}{t("search.inWiki", { count: facets.total })}{/if}
			{:else if failed}
				<Icon name="error" size={16} class="inline" /> {t("search.indexUnavailable")}
				<button type="button" class="text-foreground inline-flex min-h-6 items-center gap-1 underline underline-offset-4" onclick={load}><Icon name="retry" size={16} />{t("common.retry")}</button>
			{:else if !engine}
				{t("search.loadingIndex")}
			{:else if onServer}
				{t("search.results", { count: total })}
			{:else if res.total}
				{res.total > res.hits.length ? t("search.resultsPartial", { shown: res.hits.length, count: res.total }) : t("search.results", { count: res.total })}
			{:else}
				{t("search.noResults")}
			{/if}
		</p>
		<p class="sr-only" role="status">{announced}</p>
		<!-- the judge's ranking: polite and discreet, never a blocking state; the region stays in the page so that its changes are announced -->
		<p role="status" aria-live="polite" class="text-muted-foreground text-sm" data-ranking={judging ? "busy" : srv?.phase === "judged" ? "done" : undefined}>
			{#if judging}
				<span class="mt-1 flex items-center gap-2"><span class="bg-muted-foreground size-2 shrink-0 motion-safe:animate-pulse" aria-hidden="true"></span>{t("search.ranking")}</span>
			{:else if grouped}
				<span class="sr-only">{t("search.rankedDone", { retained: grouped.retained.length, related: grouped.related.length })}</span>
				{#if srv?.judged?.model}<span class="mt-1 block">{t("search.ranked", { model: srv.judged.model })}</span>{/if}
			{:else if srv?.judged?.reason === "unavailable"}
				<span class="mt-1 block">{t("search.rankingUnavailable")}</span>
			{/if}
		</p>

		{#if onServer && res.total > 0}
			<p class="text-muted-foreground mt-1 text-sm" data-rank-scope>{t("search.rankScope", { count: srvRows.length })}</p>
		{/if}

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
			{#snippet item(v: View, href: string)}
				<li class="py-4" data-page={v.doc.id}>
					<ResultRow doc={v.doc} {href} titleHtml={v.titleHtml} descriptionHtml={v.descriptionHtml} snippetHtml={v.snippetHtml} note={v.note} showFav onopen={() => search.remember(q)} />
				</li>
			{/snippet}
			{#snippet list(rs: Row[], label?: string)}
				<ul class="divide-border divide-y" aria-label={label}>
					{#each rs as r (r.doc.id)}{@render item(viewOf(r), withPassage(toPage(r.doc.id), q))}{/each}
				</ul>
			{/snippet}
			{#snippet localItem(h: { doc: SearchDoc; title: string; description: string; snippet: string })}
				{@render item({ doc: h.doc, titleHtml: h.title, descriptionHtml: h.description, snippetHtml: h.snippet }, withPassage(toPage(h.doc.id), q))}
			{/snippet}
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div class="mt-2" aria-busy={judging} bind:this={results} onclick={onRowClick} onfocusin={onFocusIn} onfocusout={onFocusOut}>
				{#if grouped}
					{#if grouped.retained.length}
						<section aria-labelledby="g-retained" class="mb-6">
							<h3 id="g-retained" class="text-lg font-semibold">{t("search.group.retained")} <span class="text-muted-foreground text-base font-normal tabular-nums">{grouped.retained.length}</span></h3>
							{@render list(grouped.retained)}
						</section>
					{/if}
					{#if grouped.related.length}
						<section aria-labelledby="g-related" class="mb-6">
							<h3 id="g-related" class="text-lg font-semibold">{t("search.group.related")} <span class="text-muted-foreground text-base font-normal tabular-nums">{grouped.related.length}</span></h3>
							{@render list(grouped.related)}
						</section>
					{/if}
					{#if !top}<p class="text-muted-foreground mb-3 text-[0.9375rem]">{t("search.group.noTop")}</p>{/if}
					{#if grouped.other.length}
						<!-- the rest is folded, never hidden for good: a disclosure with its count -->
						<details open={isOtherOpen} ontoggle={(e) => { const o = e.currentTarget.open; if (o !== isOtherOpen) otherOpen = o; }} class="group rounded-lg border px-3" data-group="other">
							<summary class="focus-visible:ring-ring/50 flex min-h-11 cursor-pointer items-center gap-2 text-base font-semibold focus-visible:ring-3">{t("search.group.other", { count: grouped.other.length })}<Icon name="chevron-down" size={16} class="text-muted-foreground ml-auto motion-safe:transition-transform group-open:rotate-180" /></summary>
							{@render list(grouped.other)}
						</details>
					{/if}
				{:else if onServer}
					<ul class="divide-border divide-y">
						{#each srvRows as r (r.doc.id)}{@render item(viewOf(r), withPassage(toPage(r.doc.id), q))}{/each}
					</ul>
				{:else}
					<ul class="divide-border divide-y">
						{#each res.hits as h (h.doc.id)}{@render localItem(h)}{/each}
					</ul>
				{/if}
				{#if onServer && res.total > 0}
					<!-- local matches beyond the server's ranked list (it returns at most SERVER_LIMIT pages and no total) -->
					<details open={isMoreOpen} ontoggle={(e) => { const o = e.currentTarget.open; if (o !== isMoreOpen) moreOpen = o; }} class="group mt-4 rounded-lg border px-3" data-group="more">
						<summary class="focus-visible:ring-ring/50 flex min-h-11 cursor-pointer items-center gap-2 text-base font-semibold focus-visible:ring-3">{t("search.group.more", { count: res.total })}<Icon name="chevron-down" size={16} class="text-muted-foreground ml-auto motion-safe:transition-transform group-open:rotate-180" /></summary>
						<ul class="divide-border divide-y">
							{#each res.hits as h (h.doc.id)}{@render localItem(h)}{/each}
						</ul>
						{#if res.total > res.hits.length}
							<button type="button" class="hover:bg-muted focus-visible:ring-ring/50 mt-3 mb-3 min-h-9 rounded-md border px-3 py-1.5 text-sm focus-visible:ring-3 pointer-coarse:min-h-11" onclick={() => (limit += STEP)}>{t("search.showMore", { shown: res.hits.length, total: res.total })}</button>
						{/if}
					</details>
				{/if}
			</div>
			{#if !onServer && res.total > res.hits.length}
				<button type="button" class="hover:bg-muted focus-visible:ring-ring/50 mt-4 min-h-9 rounded-md border px-3 py-1.5 text-sm focus-visible:ring-3 pointer-coarse:min-h-11" onclick={() => (limit += STEP)}>{t("search.showMore", { shown: res.hits.length, total: res.total })}</button>
			{/if}
			{#if engine && !total && !issues.length}
				<div class="py-6">
					<p class="font-medium">{noFav ? t("search.noFavsYet") : t("search.noMatch")}</p>
					<p class="text-muted-foreground mt-1 text-[0.9375rem]">
						{#if noFav}{t("search.noFavsYet.help")}
						{:else}{t("search.noMatch.help")}{/if}
					</p>
					<button type="button" class="hover:bg-muted focus-visible:ring-ring/50 mt-3 inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm focus-visible:ring-3 pointer-coarse:min-h-11" onclick={() => search.apply("")}><Icon name="clear" size={16} />{t("search.clear")}</button>
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
								<li><a href={urlOf(localizeQuery(ex.q))} class="hover:bg-muted focus-visible:ring-ring/50 flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 focus-visible:ring-3"><code class="text-link font-sans">{localizeQuery(ex.q)}</code><span class="text-muted-foreground text-sm">{t(ex.hint)}</span></a></li>
							{/each}
						</ul>
					</section>
				{/if}
				<section aria-labelledby="s-collections">
					<h2 id="s-collections" class="text-lg font-semibold">{t("search.collections")}</h2>
					<ul class="mt-2 flex flex-wrap gap-2">
						{#each data.seed.types.filter((x) => x.count) as ty (ty.type)}
							<li><a href={urlOf(token("type", ty.type))} class="hover:bg-muted focus-visible:ring-ring/50 inline-flex min-h-11 items-center gap-2 border px-4 text-sm focus-visible:ring-3"><Icon name={typeIcon(ty.type)} size={16} />{typePlural(ty.type)} <span class="text-muted-foreground">{ty.count}</span></a></li>
						{/each}
					</ul>
				</section>
				{#if data.seed.tags.length}
					<section aria-labelledby="s-tags">
						<h2 id="s-tags" class="text-lg font-semibold">{t("search.frequentTags")}</h2>
						<ul class="mt-2 flex flex-wrap gap-2">
							{#each data.seed.tags as tg (tg.tag)}
								<li><a href={urlOf(`#${tg.tag}`)} class="hover:bg-muted bg-secondary text-secondary-foreground focus-visible:ring-ring/50 inline-flex min-h-9 items-center gap-1.5 border px-3 text-sm focus-visible:ring-3 pointer-coarse:min-h-11">#{tg.tag} <span class="text-muted-foreground">{tg.count}</span></a></li>
							{/each}
						</ul>
					</section>
				{/if}
				<section aria-labelledby="s-syntax">
					<h2 id="s-syntax" class="text-lg font-semibold">{t("search.operators")}</h2>
					<ul class="mt-2 space-y-2 text-[0.9375rem]">
						<li class="flex items-center gap-3"><Icon name="operator-tag" size={20} class="text-muted-foreground" /><code class="font-sans">#tag</code> <span class="text-muted-foreground">{t("search.or")}</span> <code class="font-sans">tag:{t("search.operators.name")}</code></li>
						<li class="flex items-center gap-3"><Icon name="operator-type" size={20} class="text-muted-foreground" /><code class="font-sans">{token("type", "Concept")}</code> <span class="text-muted-foreground">{valueWords("type")}</span></li>
						<li class="flex items-center gap-3"><Icon name="operator-status" size={20} class="text-muted-foreground" /><code class="font-sans">{token("status", "deprecated")}</code> {#each IS_VALUES as v (v)}<code class="font-sans">{token("is", v)}</code> {/each}</li>
						<li class="flex items-center gap-3"><Icon name="operator-phrase" size={20} class="text-muted-foreground" /><code class="font-sans">"{t("search.operators.phrase")}"</code></li>
						<li class="flex items-center gap-3"><Icon name="operator-exclude" size={20} class="text-muted-foreground" /><code class="font-sans">-{t("search.operators.word")}</code> <code class="font-sans">-#tag</code> <span class="text-muted-foreground">{t("search.operators.exclude")}</span></li>
						<li class="flex flex-wrap items-center gap-3"><Icon name="search" size={20} class="text-muted-foreground" /><code class="font-sans">(#a {t("query.word.or")} #b) {token("status", "deprecated")}</code> <code class="font-sans">-(…)</code> <span class="text-muted-foreground">{t("search.operators.or")}</span></li>
					</ul>
					<p class="text-muted-foreground mt-3 text-sm">{t("search.operators.help")}</p>
				</section>
			</div>
		{/if}
	</section>
</div>
