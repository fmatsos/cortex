<script lang="ts">
	import { onMount, tick } from "svelte";
	import Icon from "#lib/components/icon.svelte";
	import { toPage } from "#lib/links.js";
	import { domainOf } from "#lib/article.js";
	import type { Note, SourceRef } from "#lib/types.js";

	// Aperçu d'une citation (UX19) : un clic ou Entrée sur un appel de note ouvre, sur place, la précision de la note, la page
	// Source du wiki et le document original, sans quitter la lecture. Les notes de bas de page restent la solution de repli
	// (« Aller à la note », et tout appel de note fonctionne comme avant si l'API popover manque ou si JavaScript est coupé).
	// Panneau natif (`popover`) : Échap et clic extérieur le ferment et rendent le focus à l'appel de note ; sur mobile il se
	// range en bas de l'écran.
	let supported = $state(false);
	let box = $state<HTMLElement>();
	let note = $state<Note>();
	let source = $state<SourceRef>();
	let pos = $state("");
	onMount(() => { supported = "popover" in HTMLElement.prototype; });

	/** Ouvre l'aperçu sous (ou au-dessus de) l'appel de note ; renvoie `false` si l'API n'est pas disponible (le lien suit alors son cours). */
	export function show(el: HTMLElement, n: Note, s: SourceRef | undefined): boolean {
		if (!supported || !box) return false;
		note = n; source = s;
		const r = el.getBoundingClientRect(), w = Math.min(384, innerWidth - 16);
		const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
		pos = innerHeight - r.bottom < 260 && r.top > 260 ? `left:${left}px;bottom:${innerHeight - r.top + 6}px;top:auto` : `left:${left}px;top:${r.bottom + 6}px`;
		if (box.matches(":popover-open")) box.hidePopover();
		box.showPopover();
		void tick().then(() => box?.focus()); // le focus entre dans la fenêtre ; Tab atteint ensuite Fermer et les liens
		return true;
	}
	const close = () => box?.hidePopover();
	// un défilement de la page éloigne l'aperçu de sa note : on le referme
	const onscroll = () => { if (box?.matches(":popover-open")) close(); };
</script>

<svelte:window {onscroll} />

{#if supported}
	<div bind:this={box} popover="auto" role="dialog" tabindex="-1" aria-labelledby="cp-title" class="cp bg-popover text-popover-foreground" style={pos}>
		{#if note}
			<div class="flex items-start justify-between gap-2">
				<h2 id="cp-title" class="flex items-center gap-2 text-base font-semibold">
					<Icon name="citation" size={20} />
					<span>Note {note.n}{source ? ` · ${source.title}` : ""}</span>
				</h2>
				<button type="button" onclick={close} aria-label="Fermer l'aperçu de la note" class="touch-target hover:bg-muted -mt-1 -mr-1 inline-flex size-9 shrink-0 items-center justify-center rounded-md">
					<Icon name="clear" size={20} />
				</button>
			</div>
			{#if note.html}
				<div class="note mt-2 text-sm">{@html note.html}</div>
			{:else if !source}
				<p class="text-muted-foreground mt-2 text-sm">Source sans entrée dans sources[] ({note.id}).</p>
			{:else}
				<p class="text-muted-foreground mt-2 text-sm">Aucune précision (section, page, repère) pour cette note.</p>
			{/if}
			<ul class="mt-3 flex flex-col gap-1 text-sm">
				{#if source?.page}
					<li><a href={toPage(source.page.id)} class="text-link inline-flex items-center gap-1.5 underline underline-offset-3" onclick={close}><Icon name="source" size={16} />Page Source : {source.page.title}</a></li>
				{/if}
				{#if source?.url}
					<li>
						<a href={source.url} rel="noopener noreferrer" class="text-link inline-flex items-center gap-1.5 underline underline-offset-3">
							<Icon name="external-link" size={16} />Lire l'original{#if domainOf(source.url)}&nbsp;({domainOf(source.url)}){/if}<span class="sr-only"> — lien externe</span>
						</a>
					</li>
				{/if}
				<li>
					<a href="#fn-{note.id}" class="text-link inline-flex items-center gap-1.5 underline underline-offset-3" onclick={close}>
						<Icon name="backlink" size={16} />Aller à la note en bas de page
					</a>
				</li>
			</ul>
		{/if}
	</div>
{/if}

<style>
	/* fenêtre ancrée près de l'appel de note (position posée en ligne) ; en bas d'écran sur mobile.
	   `display` n'est posé qu'à l'ouverture (sinon il écraserait le masquage natif). */
	.cp {
		margin: 0;
		inset: auto;
		width: min(24rem, calc(100vw - 1rem));
		max-height: 60dvh;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 0.9rem 1rem;
		box-shadow: 0 8px 24px color-mix(in oklch, var(--foreground) 22%, transparent);
	}
	.cp:popover-open {
		display: block;
	}
	.cp:focus {
		outline: none;
	}
	@media (max-width: 639px) {
		.cp {
			inset: auto 0 0 0 !important;
			width: 100%;
			border-width: 1px 0 0;
			border-radius: var(--radius-xl) var(--radius-xl) 0 0;
		}
		.cp::backdrop {
			background: color-mix(in oklch, var(--foreground) 30%, transparent);
		}
	}
	.note :global(a) {
		color: var(--link);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	@media print {
		.cp {
			display: none !important;
		}
	}
</style>
