<script lang="ts">
	import { Badge } from "#lib/components/ui/badge/index.js";
	import { toTag } from "#lib/links.js";

	let { data } = $props();
</script>

<svelte:head><title>Tags · Second cerveau</title></svelte:head>

<h1 class="text-3xl font-semibold tracking-tight">Tags</h1>
<ul class="mt-6 flex flex-wrap gap-2">
	{#each data.tags as t (t.slug)}
		<li><Badge href={toTag(t.slug)} variant="secondary" class="h-7 px-3 text-sm">#{t.tag} <span class="text-muted-foreground">{t.count}</span></Badge></li>
	{/each}
</ul>
