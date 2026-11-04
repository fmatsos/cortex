<script lang="ts">
	import { tick } from "svelte";
	import { afterNavigate, goto } from "$app/navigation";
	import ChipButton from "#lib/components/chip-button.svelte";
	import Icon from "#lib/components/icon.svelte";
	import { Badge } from "#lib/components/ui/badge/index.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { toRoute, toTag } from "#lib/links.js";
	import { filterTags, readTagsParams, sortTags, TAG_SORTS, tagsQuery, type TagSort } from "#lib/tags-view.js";

	let { data } = $props();
	// Filtre et tri font foi dans l'URL (?q=…&tri=alpha) : la page prérendue n'en connaît aucun, ils se lisent dans le navigateur.
	let q = $state("");
	let sort = $state<TagSort>("freq");
	let ready = $state(false);
	let input = $state<HTMLInputElement | null>(null);
	const shown = $derived(sortTags(filterTags(data.tags, q), sort));
	const sentence = $derived(TAG_SORTS.find((s) => s.sort === sort)?.sentence);

	const clear = async () => {
		q = "";
		await tick();
		input?.focus(); // le bouton disparaît : le focus revient dans le champ
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

<svelte:head><title>Tags · Second cerveau</title></svelte:head>

<h1 class="text-3xl font-semibold tracking-tight">Tags</h1>
<div class="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
	<div class="w-full max-w-sm">
		<label for="filtre-tags" class="mb-1 block text-sm font-medium">Filtrer les tags</label>
		<Input id="filtre-tags" bind:ref={input} type="search" placeholder="Filtrer les tags…" autocomplete="off" bind:value={q} />
	</div>
	<div role="group" aria-labelledby="tri-tags">
		<span id="tri-tags" class="mb-1 block text-sm font-medium">Trier par</span>
		<div class="touch-gap flex flex-wrap gap-2">
			{#each TAG_SORTS as s (s.sort)}
				<ChipButton pressed={sort === s.sort} onclick={() => (sort = s.sort)}>{s.label}</ChipButton>
			{/each}
		</div>
	</div>
</div>
<p class="text-muted-foreground mt-3 text-sm" role="status">{shown.length === data.tags.length ? `${data.tags.length} tags` : `${shown.length} sur ${data.tags.length} tags`}, triés {sentence}</p>
<ul class="touch-gap mt-4 flex flex-wrap gap-2">
	{#each shown as t (t.slug)}
		<li><Badge href={toTag(t.slug)} variant="secondary" class="h-7 px-3 text-sm">#{t.tag} <span class="text-muted-foreground">{t.count}</span></Badge></li>
	{:else}
		<li class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
			Aucun tag ne correspond à « {q.trim()} ».
			<Button variant="outline" size="sm" onclick={clear}>
				<Icon name="clear" size={16} />
				Effacer le filtre
			</Button>
		</li>
	{/each}
</ul>
