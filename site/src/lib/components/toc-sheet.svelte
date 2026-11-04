<script lang="ts">
	import { onMount } from "svelte";
	import Icon from "#lib/components/icon.svelte";
	import Toc from "#lib/components/toc.svelte";
	import type { TocItem } from "#lib/types.js";

	// "Sommaire" command for small screens (UI19): a floating button, present throughout the reading, that names the
	// current section and opens the table of contents in a panel. Native panel (`popover`): Escape, outside click and focus
	// return to the button are handled by the browser. Without the popover API, nothing is shown (the side table of contents exists
	// from lg, and the anchors are still followed by the notes).
	let { items, current = "" }: { items: TocItem[]; current?: string } = $props();
	let supported = $state(false);
	let sheet = $state<HTMLElement>();
	onMount(() => { supported = "popover" in HTMLElement.prototype; });
	const now = $derived(items.find((i) => i.id === current)?.text);
</script>

{#if supported}
	<button
		type="button"
		popovertarget="toc-sheet"
		class="bg-card text-foreground hover:bg-muted border-input fixed right-3 bottom-3 z-30 inline-flex h-11 max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border px-4 text-sm font-medium shadow-md print:hidden"
	>
		<Icon name="toc" size={20} />
		<span>Sommaire</span>
		{#if now}<span class="text-muted-foreground min-w-0 truncate font-normal">· {now}</span>{/if}
	</button>

	<div id="toc-sheet" popover="auto" bind:this={sheet} aria-labelledby="toc-sheet-title" class="toc-sheet bg-popover text-popover-foreground">
		<div class="mb-2 flex items-center justify-between gap-2">
			<h2 id="toc-sheet-title" class="text-base font-semibold">Sommaire</h2>
			<button type="button" popovertarget="toc-sheet" popovertargetaction="hide" aria-label="Fermer le sommaire" class="touch-target hover:bg-muted inline-flex size-9 items-center justify-center rounded-md">
				<Icon name="clear" size={20} />
			</button>
		</div>
		<nav aria-labelledby="toc-sheet-title"><Toc {items} {current} onnavigate={() => sheet?.hidePopover()} /></nav>
	</div>
{/if}

<style>
	/* panel at the bottom of the screen; `display` is only set on opening (otherwise it would override the native hiding) */
	.toc-sheet {
		margin: 0;
		inset: auto 0 0 0;
		width: 100%;
		max-height: 70dvh;
		overflow-y: auto;
		border: 0;
		border-top: 1px solid var(--border);
		border-radius: var(--radius-xl) var(--radius-xl) 0 0;
		padding: 1rem 1rem 1.25rem;
		box-shadow: 0 -8px 24px color-mix(in oklch, var(--foreground) 18%, transparent);
	}
	.toc-sheet:popover-open {
		display: block;
	}
	.toc-sheet::backdrop {
		background: color-mix(in oklch, var(--foreground) 35%, transparent);
	}
	@media print {
		.toc-sheet {
			display: none !important;
		}
	}
</style>
