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
	import { typeColor, typeIcon, typePlural } from "#lib/type-meta.js";
	import { t } from "#lib/i18n/index.js";

	let { data } = $props();
	const FAVS_SHOWN = 6;
	const urlOf = (q: string) => `${toRoute("/search")}?q=${encodeURIComponent(q)}`;

	// Favorites are specific to this browser: they are found in the search index (loaded only if there are any)
	let engine = $state<Engine>();
	$effect(() => { if (favs.ids.length && !engine) loadEngine().then((e) => (engine = e), () => {}); });
	const favDocs = $derived(engine ? engine.docs.filter((d) => favs.has(d.id)).sort((a, b) => a.title.localeCompare(b.title, "fr")) : []);
</script>

<svelte:head><title>Cortex</title></svelte:head>

<!-- search is the entry point: a large field, examples that give results, recent searches -->
<section aria-labelledby="h-home" class="mx-auto max-w-3xl pt-2 pb-6 sm:pt-8">
	<div class="flex items-end gap-3">
		<CortexMark size={112} animated />
		<div class="min-w-0 pb-2">
			<h1 id="h-home" class="flex flex-wrap items-baseline gap-x-3 text-3xl font-semibold tracking-tight"><CortexWordmark /><span class="text-muted-foreground relative -top-[0.1125rem] text-sm leading-tight font-normal tracking-normal">{t("home.tagline")}</span></h1>
			<p class="text-muted-foreground mt-2">
				{t("home.intro", { pages: data.seed.total, tags: data.seed.nbTags })}
				<a href={toRoute("/graph")} class="text-link link-content underline underline-offset-4">{t("home.intro.graph")}</a>.
			</p>
		</div>
	</div>
	<SearchBox variant="main" class="mt-5" />
	{#if data.seed.examples.length}
		<ul class="touch-gap mt-4 flex flex-wrap items-center gap-2" aria-label={t("home.examples")}>
			<li class="text-muted-foreground text-sm" aria-hidden="true">{t("home.try")}</li>
			{#each data.seed.examples as ex (ex.q)}
				<li><a href={urlOf(ex.q)} title={t(ex.hint)} class="hover:bg-muted bg-card focus-visible:ring-ring/50 inline-flex min-h-8 items-center rounded-full border px-3 text-sm focus-visible:ring-3 pointer-coarse:min-h-11"><code>{ex.q}</code><span class="sr-only">{t("common.colon")}{t(ex.hint)}</span></a></li>
			{/each}
		</ul>
	{/if}
	{#if search.recent.length}
		<section aria-labelledby="h-recent" class="mt-5">
			<div class="flex items-center gap-3">
				<h2 id="h-recent" class="text-muted-foreground flex items-center gap-1.5 text-sm font-semibold"><Icon name="recent" size={16} />{t("home.recent")}</h2>
				<button type="button" class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-sm underline underline-offset-4 focus-visible:ring-3 pointer-coarse:min-h-11" onclick={() => search.forget()}>{t("home.recent.clear")}</button>
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
	<section id="favorites" aria-labelledby="h-favorites" class="mt-6">
		<h2 id="h-favorites" class="anchor-target flex items-center gap-2 text-xl font-semibold"><Icon name="favorites" size={24} class="text-favorite" />{t("favs.title")} <span class="text-muted-foreground text-sm font-normal">{t("favs.count", { count: favs.ids.length })}</span></h2>
		{#if engine}
			<PageList pages={favDocs.slice(0, FAVS_SHOWN)} filter={false} showFav />
			{#if favDocs.length > FAVS_SHOWN}
				<a href={urlOf("is:fav")} class="text-link link-content mt-2 inline-flex min-h-9 items-center underline underline-offset-4">{t("favs.seeAll", { count: favDocs.length })}</a>
			{/if}
		{:else}
			<p class="text-muted-foreground mt-2 text-sm">{t("favs.loading")}</p>
		{/if}
		{#if !favs.persisted}<p class="text-warning-foreground mt-2 text-sm" role="status">{t("favs.notPersisted")}</p>{/if}
	</section>
{/if}

<!-- preview bounded per collection, whatever the size of the wiki; the full view is the filtered search (in slices) -->
<div class="mt-10 grid gap-6 lg:grid-cols-2 2xl:grid-cols-4">
	{#each data.collections as c (c.type)}
		<section aria-labelledby="h-{c.type}" class="bg-muted/40 rounded-lg border p-4">
			<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
				<h2 id="h-{c.type}" class="anchor-target flex items-center gap-2 text-xl font-semibold">
					<Icon name={typeIcon(c.type)} size={24} style="color: {typeColor(c.type)}" />
					{typePlural(c.type)} <span class="text-muted-foreground text-sm font-normal">({c.count})</span>
				</h2>
				{#if c.count > c.preview.length}
					<a href={urlOf(`type:${c.type.toLowerCase()}`)} aria-label={t("home.seeAll.label", { what: typePlural(c.type).toLowerCase(), count: c.count })} class="text-link link-content inline-flex min-h-9 items-center gap-1 text-sm underline-offset-4 hover:underline pointer-coarse:min-h-11">{t("home.seeAll")}<Icon name="chevron-down" size={16} class="-rotate-90" /></a>
				{/if}
			</div>
			<PageList pages={c.preview} filter={false} showType={false} />
		</section>
	{/each}
</div>

