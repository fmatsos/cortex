<script lang="ts">
	import { onMount } from "svelte";
	import Icon from "#lib/components/icon.svelte";
	import KindBadge from "#lib/components/kind-badge.svelte";
	import CortexMark from "#lib/components/cortex-mark.svelte";
	import CortexWordmark from "#lib/components/cortex-wordmark.svelte";
	import PageList from "#lib/components/page-list.svelte";
	import SearchBox from "#lib/components/search-box.svelte";
	import { favs } from "#lib/favs.svelte.js";
	import { toPage, toRoute, toTag } from "#lib/links.js";
	import { dayShort } from "#lib/log-view.js";
	import type { IconName } from "#lib/icons.js";
	import { type Engine, loadEngine } from "#lib/search-client.js";
	import { search } from "#lib/search-state.svelte.js";
	import { typeColor, typeIcon, typePlural } from "#lib/type-meta.js";
	import { t } from "#lib/i18n/index.js";

	let { data } = $props();
	const FACTS = 3;
	const FAVS_SHOWN = 6;
	const urlOf = (q: string) => `${toRoute("/search")}?q=${encodeURIComponent(q)}`;

	// Favorites are specific to this browser: they are found in the search index (loaded only if there are any)
	let engine = $state<Engine>();
	$effect(() => { if (favs.ids.length && !engine) loadEngine().then((e) => (engine = e), () => {}); });
	// daily picks: the export day in the prerendered page, today's once in the browser (they change without a rebuild)
	let today = $state<number>();
	onMount(() => { today = Math.floor(Date.now() / 864e5); });
	const day = $derived(today ?? Math.floor(Date.parse(data.footer.generatedAt) / 864e5));
	const featured = $derived(data.featured.length ? data.featured[day % data.featured.length] : undefined);
	const facts = $derived.by(() => {
		const pool = data.facts.filter((f) => f.id !== featured?.id);
		const start = pool.length ? (day * FACTS) % pool.length : 0;
		return [...pool.slice(start), ...pool.slice(0, start)].slice(0, FACTS);
	});
	const favDocs = $derived(engine ? engine.docs.filter((d) => favs.has(d.id)).sort((a, b) => a.title.localeCompare(b.title, "fr")) : []);
</script>

<svelte:head><title>Cortex</title></svelte:head>

<!-- search is the entry point: a large field, examples that give results, recent searches -->
<section aria-labelledby="h-home" class="mx-auto max-w-3xl pt-2 pb-6 sm:pt-8">
	<div class="flex items-end gap-3">
		<CortexMark size={72} />
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

<!-- encyclopedia-style front page: kinds of pages, then featured, news, did you know, central pages, portals -->
<ul class="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t("home.types")}>
	{#each data.seed.types.filter((x) => x.count) as x (x.type)}
		<li><a href={urlOf(`type:${x.type.toLowerCase()}`)} class="hover:bg-muted bg-card focus-visible:ring-ring/50 flex min-h-11 items-center gap-2 rounded-lg border px-3 focus-visible:ring-3">
			<Icon name={typeIcon(x.type)} size={20} style="color: {typeColor(x.type)}" />{typePlural(x.type)}<span class="text-muted-foreground ml-auto text-sm">{x.count}</span>
		</a></li>
	{/each}
</ul>

{#snippet head(id: string, icon: IconName, label: string)}
	<h2 {id} class="flex items-center gap-2 text-lg font-semibold"><Icon name={icon} size={20} class="text-muted-foreground" />{label}</h2>
{/snippet}

<div class="mt-6 grid gap-6 lg:grid-cols-[3fr_2fr]">
	{#if featured}
		<section aria-labelledby="h-featured" class="bg-muted/40 rounded-lg border p-4">
			{@render head("h-featured", "star", t("home.featured"))}
			<a href={toPage(featured.id)} class="text-link link-content mt-3 flex items-center gap-2 text-2xl font-semibold tracking-tight underline-offset-4 hover:underline">
				<Icon name={typeIcon(featured.type)} size={24} style="color: {typeColor(featured.type)}" />{featured.title}
			</a>
			<p class="mt-2">{featured.description}</p>
			<p class="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
				{#each featured.tags as tag (tag)}<span>#{tag}</span>{/each}
				<span>{t("home.links", { count: featured.links })}</span>
				<a href={toPage(featured.id)} class="text-link link-content ml-auto inline-flex min-h-9 items-center gap-1 underline-offset-4 hover:underline">{t("home.featured.read")}<Icon name="chevron-down" size={16} class="-rotate-90" /></a>
			</p>
		</section>
	{/if}

	{#if data.news.length}
		<section aria-labelledby="h-news" class="rounded-lg border p-4">
			{@render head("h-news", "journal", t("home.news"))}
			<ul class="mt-3 space-y-3">
				{#each data.news as e (e.id)}
					<li class="text-sm">
						<a href="{toRoute('/log')}#{e.id}" class="text-muted-foreground flex items-center gap-2 hover:underline"><KindBadge kind={e.kind} /><time datetime={e.at}>{dayShort(e.at.slice(0, 10))}</time></a>
						{#if e.pages.length}
							<span class="mt-1 block">{#each e.pages as l, i (l.id)}{#if i}, {/if}<a href={toPage(l.id)} class="text-link link-content underline-offset-4 hover:underline">{l.title}</a>{/each}</span>
						{/if}
					</li>
				{/each}
			</ul>
			<a href={toRoute("/log")} class="text-link link-content mt-3 inline-flex min-h-9 items-center gap-1 text-sm underline-offset-4 hover:underline">{t("home.news.all")}<Icon name="chevron-down" size={16} class="-rotate-90" /></a>
		</section>
	{/if}

	{#if facts.length}
		<section aria-labelledby="h-facts" class="rounded-lg border p-4">
			{@render head("h-facts", "note", t("home.facts"))}
			<ul class="mt-3 list-disc space-y-2 pl-5">
				{#each facts as f (f.id)}
					<li><a href={toPage(f.id)} class="text-link link-content font-medium underline-offset-4 hover:underline">{f.title}</a>{t("common.colon")}{f.description}</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if data.hubs.length}
		<section aria-labelledby="h-hubs" class="rounded-lg border p-4">
			{@render head("h-hubs", "graph", t("home.hubs"))}
			<ul class="mt-3">
				{#each data.hubs as h (h.id)}
					<li><a href={toPage(h.id)} class="hover:bg-muted flex min-h-9 items-center gap-2 rounded-md px-1 pointer-coarse:min-h-11">
						<Icon name={typeIcon(h.type)} size={16} style="color: {typeColor(h.type)}" /><span class="text-link min-w-0 truncate">{h.title}</span>
						<span class="text-muted-foreground ml-auto shrink-0 text-sm">{t("home.links", { count: h.links })}</span>
					</a></li>
				{/each}
			</ul>
			<a href={toRoute("/graph")} class="text-link link-content mt-2 inline-flex min-h-9 items-center gap-1 text-sm underline-offset-4 hover:underline">{t("home.hubs.graph")}<Icon name="chevron-down" size={16} class="-rotate-90" /></a>
		</section>
	{/if}
</div>

{#if data.seed.tags.length}
	<section aria-labelledby="h-portals" class="mt-6 rounded-lg border p-4">
		{@render head("h-portals", "tags", t("home.portals"))}
		<ul class="touch-gap mt-3 flex flex-wrap gap-2">
			{#each data.seed.tags as tg (tg.slug)}
				<li><a href={toTag(tg.slug)} class="hover:bg-muted bg-card focus-visible:ring-ring/50 inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm focus-visible:ring-3 pointer-coarse:min-h-11">#{tg.tag}<span class="text-muted-foreground">{tg.count}</span></a></li>
			{/each}
		</ul>
		<a href={toRoute("/tags")} class="text-link link-content mt-3 inline-flex min-h-9 items-center gap-1 text-sm underline-offset-4 hover:underline">{t("home.portals.all")}<Icon name="chevron-down" size={16} class="-rotate-90" /></a>
	</section>
{/if}
