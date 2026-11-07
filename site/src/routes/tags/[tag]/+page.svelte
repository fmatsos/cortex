<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import PageList from "#lib/components/page-list.svelte";
	import { toRoute } from "#lib/links.js";
	import { t as tr } from "#lib/i18n/index.js";

	let { data } = $props();
</script>

<svelte:head><title>#{data.tag} · Cortex</title></svelte:head>

<p class="text-sm">
	<a href={toRoute("/tags")} class="text-link touch-target focus-visible:ring-ring/50 -ml-1 inline-flex min-h-6 items-center gap-1.5 rounded-md px-1 underline underline-offset-4 focus-visible:ring-3">
		<Icon name="back" size={16} />
		{tr("tags.all")}
	</a>
</p>
<h1 class="mt-2 flex items-center gap-2 text-3xl font-semibold tracking-tight">
	<Icon name="tags" size={28} class="text-muted-foreground" />
	#{data.tag}
</h1>
<p class="text-muted-foreground mt-1 text-sm">{tr("common.pages", { count: data.pages.length })}</p>
<div class="mt-4"><PageList pages={data.pages} /></div>
