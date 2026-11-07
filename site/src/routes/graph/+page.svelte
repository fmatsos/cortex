<script lang="ts">
	import GraphView from "#lib/components/graph-view.svelte";
	import { t as tr } from "#lib/i18n/index.js";
</script>

<svelte:head><title>{tr("nav.graph")} · Cortex</title></svelte:head>

<h1 class="mb-4 text-3xl font-semibold tracking-tight">{tr("nav.graph")}</h1>
<GraphView />
