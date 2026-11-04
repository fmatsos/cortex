<script lang="ts">
	import { Badge } from "#lib/components/ui/badge/index.js";
	import { toPage } from "#lib/links.js";
	import { STATUS_LABEL } from "#lib/type-meta.js";

	let { pages }: { pages: { id: string; title: string; description: string; status: string }[] } = $props();
</script>

<ul class="divide-border divide-y">
	{#each pages as p (p.id)}
		<li class="py-3">
			<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
				<a href={toPage(p.id)} class="text-link font-medium underline-offset-4 hover:underline">{p.title}</a>
				{#if p.status !== "stable"}<Badge variant={p.status === "deprecated" ? "destructive" : "secondary"}>{STATUS_LABEL[p.status] ?? p.status}</Badge>{/if}
			</div>
			<p class="text-muted-foreground mt-0.5 text-sm">{p.description}</p>
		</li>
	{/each}
</ul>
