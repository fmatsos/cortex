<script lang="ts">
	import type { Snippet } from "svelte";

	// A block of a space's settings: a heading and its content on a surface; `danger` outlines it in the destructive colour.
	let { title, danger = false, aside, children }: { title: string; danger?: boolean; aside?: Snippet; children: Snippet } = $props();
	const uid = $props.id();
</script>

<section aria-labelledby="{uid}-h" class="bg-card shadow-surface border p-4 sm:p-6 {danger ? 'border-destructive' : 'border-border'}">
	<h2 id="{uid}-h" class="mb-4 flex flex-wrap items-center gap-3 text-lg font-semibold tracking-tight {danger ? 'text-destructive' : ''}">{title}{@render aside?.()}</h2>
	{@render children()}
</section>
