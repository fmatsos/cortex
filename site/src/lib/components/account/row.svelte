<script lang="ts">
	import type { Snippet } from "svelte";

	// A row of an account list: the title and its meta line on the left, the actions on the right (below on a narrow screen).
	let { title, meta, actions }: { title: string; meta: Snippet; actions: Snippet } = $props();
</script>

<li class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
	<div class="min-w-0">
		<p class="font-medium break-words">{title}</p>
		<p class="text-muted-foreground mt-0.5 text-sm tabular-nums">{@render meta()}</p>
	</div>
	<div class="flex shrink-0 flex-wrap gap-2">{@render actions()}</div>
</li>
