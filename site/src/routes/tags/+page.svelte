<script lang="ts">
	import { tick } from "svelte";
	import { afterNavigate, goto } from "$app/navigation";
	import ChipButton from "#lib/components/chip-button.svelte";
	import Icon from "#lib/components/icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { toRoute, toTag } from "#lib/links.js";
	import { filterTags, readTagsParams, sortTags, TAG_SORTS, tagsQuery, type TagSort } from "#lib/tags-view.js";
	import { t as tr } from "#lib/i18n/index.js";

	let { data } = $props();
	// Filter and sort are authoritative in the URL (?q=…&sort=alpha): the prerendered page knows none of them, they are read in the browser.
	let q = $state("");
	let sort = $state<TagSort>("freq");
	let ready = $state(false);
	let input = $state<HTMLInputElement | null>(null);
	const shown = $derived(sortTags(filterTags(data.tags, q), sort));
	const sentence = $derived(TAG_SORTS.find((s) => s.sort === sort)?.sentence);

	const clear = async () => {
		q = "";
		await tick();
		input?.focus(); // the button disappears: focus returns to the field
	};

	afterNavigate((nav) => {
		const p = readTagsParams(nav.to?.url.searchParams ?? new URLSearchParams());
		if (p.q !== q.trim()) q = p.q;
		sort = p.sort;
		ready = true;
	});
	const query = $derived(tagsQuery(q, sort));
	$effect(() => {
		if (!ready || location.search === query) return;
		void goto(`${toRoute("/tags")}${query}`, { shallow: true, replace: true, keepFocus: true, noScroll: true });
	});
</script>

<svelte:head><title>{tr("nav.tags")} · Cortex</title></svelte:head>

<h1 class="text-3xl font-semibold tracking-tight">{tr("nav.tags")}</h1>
<div class="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
	<div class="w-full max-w-sm">
		<label for="tags-filter" class="mb-1 block text-sm font-medium">{tr("tags.filter")}</label>
		<Input id="tags-filter" bind:ref={input} type="search" placeholder={tr("tags.filter.placeholder")} autocomplete="off" bind:value={q} />
	</div>
	<div role="group" aria-labelledby="tags-sort">
		<span id="tags-sort" class="mb-1 block text-sm font-medium">{tr("tags.sortBy")}</span>
		<div class="touch-gap flex flex-wrap gap-2">
			{#each TAG_SORTS as s (s.sort)}
				<ChipButton pressed={sort === s.sort} onclick={() => (sort = s.sort)}>{s.label}</ChipButton>
			{/each}
		</div>
	</div>
</div>
<p class="text-muted-foreground mt-3 text-sm" role="status">{shown.length === data.tags.length ? tr("tags.count", { count: data.tags.length }) : tr("tags.countOf", { shown: shown.length, count: data.tags.length })}, {tr("tags.sorted", { how: sentence ?? "" })}</p>
<!-- rows, not a cloud: one tag per line, the count in its own column so the figures line up whatever the length of the name -->
<ul class="border-border mt-4 max-w-2xl divide-y border-y">
	{#each shown as t (t.slug)}
		<li>
			<a href={toTag(t.tag)} class="hover:bg-muted focus-visible:outline-ring grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-2 py-2 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2">
				<span class="text-link [overflow-wrap:anywhere]">#{t.tag}</span>
				<span class="text-muted-foreground min-w-[3ch] text-right tabular-nums"><span aria-hidden="true">{t.count}</span><span class="sr-only">{tr("tags.pages", { count: t.count })}</span></span>
			</a>
		</li>
	{:else}
		<li class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-3 text-sm">
			{tr("tags.noMatch", { q: q.trim() })}
			<Button variant="outline" size="sm" onclick={clear}>
				<Icon name="clear" size={16} />
				{tr("tags.clearFilter")}
			</Button>
		</li>
	{/each}
</ul>
