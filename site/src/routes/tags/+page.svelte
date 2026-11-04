<script lang="ts">
	import { Badge } from "#lib/components/ui/badge/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { fold } from "#lib/fold.js";
	import { toTag } from "#lib/links.js";

	let { data } = $props();
	let q = $state("");
	// filtre insensible à la casse et aux accents ; sans saisie, tous les tags
	const shown = $derived(data.tags.filter((t) => fold(t.tag).includes(fold(q.trim().replace(/^#/, "")))));
</script>

<svelte:head><title>Tags · Second cerveau</title></svelte:head>

<h1 class="text-3xl font-semibold tracking-tight">Tags</h1>
<div class="mt-4 max-w-sm">
	<label for="filtre-tags" class="sr-only">Filtrer les tags</label>
	<Input id="filtre-tags" type="search" placeholder="Filtrer les tags…" autocomplete="off" bind:value={q} />
</div>
<p class="text-muted-foreground mt-2 text-sm" role="status">{shown.length === data.tags.length ? `${data.tags.length} tags` : `${shown.length} sur ${data.tags.length} tags`}</p>
<ul class="touch-gap mt-4 flex flex-wrap gap-2">
	{#each shown as t (t.slug)}
		<li><Badge href={toTag(t.slug)} variant="secondary" class="h-7 px-3 text-sm">#{t.tag} <span class="text-muted-foreground">{t.count}</span></Badge></li>
	{:else}
		<li class="text-muted-foreground text-sm">Aucun tag ne correspond à « {q.trim()} ».</li>
	{/each}
</ul>
