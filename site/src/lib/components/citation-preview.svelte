<script lang="ts">
	import { onMount, tick } from "svelte";
	import Icon from "#lib/components/icon.svelte";
	import { toPage } from "#lib/links.js";
	import { domainOf } from "#lib/article.js";
	import type { Note, SourceRef } from "#lib/types.js";
	import { t as tr } from "#lib/i18n/index.js";

	// Citation preview (UX19): a click or Enter on a footnote call opens, in place, the note's detail, the wiki Source
	// page and the original document, without leaving the reading. Footnotes remain the fallback
	// ("Aller à la note", and every footnote call works as before if the popover API is missing or JavaScript is off).
	// Native panel (`popover`): Escape and outside click close it and return focus to the footnote call; on mobile it
	// docks at the bottom of the screen.
	let supported = $state(false);
	let box = $state<HTMLElement>();
	let note = $state<Note>();
	let source = $state<SourceRef>();
	let pos = $state("");
	onMount(() => { supported = "popover" in HTMLElement.prototype; });

	/** Opens the preview below (or above) the footnote call; returns `false` if the API is not available (the link then follows its course). */
	export function show(el: HTMLElement, n: Note, s: SourceRef | undefined): boolean {
		if (!supported || !box) return false;
		note = n; source = s;
		const r = el.getBoundingClientRect(), w = Math.min(384, innerWidth - 16);
		const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
		pos = innerHeight - r.bottom < 260 && r.top > 260 ? `left:${left}px;bottom:${innerHeight - r.top + 6}px;top:auto` : `left:${left}px;top:${r.bottom + 6}px`;
		if (box.matches(":popover-open")) box.hidePopover();
		box.showPopover();
		void tick().then(() => box?.focus()); // focus enters the window; Tab then reaches Close and the links
		return true;
	}
	const close = () => box?.hidePopover();
	// scrolling the page moves the preview away from its note: close it
	const onscroll = () => { if (box?.matches(":popover-open")) close(); };
</script>

<svelte:window {onscroll} />

{#if supported}
	<div bind:this={box} popover="auto" role="dialog" tabindex="-1" aria-labelledby="cp-title" class="cp bg-popover text-popover-foreground" style={pos}>
		{#if note}
			<div class="flex items-start justify-between gap-2">
				<h2 id="cp-title" class="flex items-center gap-2 text-base font-semibold">
					<Icon name="citation" size={20} />
					<span>{tr("cite.note", { n: note.n })}{source ? ` · ${source.title}` : ""}</span>
				</h2>
				<button type="button" onclick={close} aria-label={tr("cite.close")} class="touch-target hover:bg-muted -mt-1 -mr-1 inline-flex size-9 shrink-0 items-center justify-center rounded-md">
					<Icon name="clear" size={20} />
				</button>
			</div>
			{#if note.html}
				<div class="note mt-2 text-sm">{@html note.html}</div>
			{:else if !source}
				<p class="text-muted-foreground mt-2 text-sm">{tr("cite.noSource", { id: note.id })}</p>
			{:else}
				<p class="text-muted-foreground mt-2 text-sm">{tr("cite.noDetail")}</p>
			{/if}
			<ul class="mt-3 flex flex-col gap-1 text-sm">
				{#if source?.page}
					<li><a href={toPage(source.page.id)} class="text-link inline-flex items-center gap-1.5 underline underline-offset-3" onclick={close}><Icon name="source" size={16} />{tr("cite.sourcePage", { title: source.page.title })}</a></li>
				{/if}
				{#if source?.url}
					<li>
						<a href={source.url} rel="noopener noreferrer" class="text-link inline-flex items-center gap-1.5 underline underline-offset-3">
							<Icon name="external-link" size={16} />{tr("cite.readOriginal")}{#if domainOf(source.url)}&nbsp;({domainOf(source.url)}){/if}<span class="sr-only"> — {tr("common.externalLink")}</span>
						</a>
					</li>
				{/if}
				<li>
					<a href="#fn-{note.id}" class="text-link inline-flex items-center gap-1.5 underline underline-offset-3" onclick={close}>
						<Icon name="backlink" size={16} />{tr("cite.goToNote")}
					</a>
				</li>
			</ul>
		{/if}
	</div>
{/if}

<style>
	/* window anchored near the footnote call (position set inline); at the bottom of the screen on mobile.
	   `display` is only set on opening (otherwise it would override the native hiding). */
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
