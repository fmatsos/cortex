<script lang="ts">
	import type { Snippet } from "svelte";

	// Two-state button chip (aria-pressed): log type filter, tag sort. Text at 14 px, enlarged touch area.
	let { pressed, onclick, describedby, children }: { pressed: boolean; onclick: () => void; describedby?: string; children: Snippet } = $props();
</script>

<button type="button" class="chip touch-target" aria-pressed={pressed} aria-describedby={describedby} {onclick}>{@render children()}</button>

<style>
	.chip {
		display: inline-flex;
		min-height: 2rem;
		align-items: center;
		gap: 0.375rem;
		border-radius: 9999px;
		border: 1px solid var(--border);
		background: var(--card);
		padding-inline: 0.75rem;
		font-size: 0.875rem;
		line-height: 1.25rem;
	}
	.chip:hover {
		background: var(--muted);
	}
	.chip:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.chip[aria-pressed="true"] {
		background: var(--secondary);
		border-color: var(--foreground);
		font-weight: 600;
	}
</style>
