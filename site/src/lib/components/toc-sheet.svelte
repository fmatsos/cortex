<script lang="ts">
	import { onMount } from "svelte";
	import Icon from "#lib/components/icon.svelte";
	import Toc from "#lib/components/toc.svelte";
	import type { TocItem } from "#lib/types.js";

	// Commande « Sommaire » des petits écrans (UI19) : un bouton flottant, présent pendant toute la lecture, qui nomme la
	// section courante et ouvre le sommaire dans un panneau. Panneau natif (`popover`) : Échap, clic extérieur et retour
	// du focus au bouton sont gérés par le navigateur. Sans l'API popover, rien n'est affiché (le sommaire latéral existe
	// dès lg, et les ancres restent suivies par les notes).
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
		class="bg-card text-foreground hover:bg-muted border-input fixed right-3 bottom-3 z-30 inline-flex h-11 max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border px-4 text-sm font-medium shadow-md lg:hidden print:hidden"
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
	/* panneau en bas d'écran ; `display` n'est posé qu'à l'ouverture (sinon il écraserait le masquage natif) */
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
