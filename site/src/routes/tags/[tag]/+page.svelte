<script lang="ts">
	import PageList from "#lib/components/page-list.svelte";
	import { toRoute } from "#lib/links.js";

	let { data } = $props();
</script>

<svelte:head><title>#{data.tag} · Second cerveau</title></svelte:head>

<p class="text-sm"><a href={toRoute("/tags")} class="text-link underline underline-offset-4">← Tous les tags</a></p>
<h1 class="mt-2 text-3xl font-semibold tracking-tight">#{data.tag}</h1>
<p class="text-muted-foreground mt-1">{data.pages.length} page{data.pages.length > 1 ? "s" : ""}</p>
<div class="mt-4"><PageList pages={data.pages} /></div>
