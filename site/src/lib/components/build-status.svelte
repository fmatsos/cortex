<script lang="ts">
	import { onMount } from "svelte";
	import { buildStatus } from "#lib/build-status.svelte.js";
	import Icon from "#lib/components/icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { t } from "#lib/i18n/index.js";

	// Is the site being rebuilt (`cortex serve` only: on a static site there is no /api/status and nothing here ever shows).
	// In the header, beside the mark: the header is on every page and always in view, so the indicator can stay as small as a
	// dot; the footer is out of sight on most visits. While a build runs: a slow pulsing dot, its text in a tooltip (hover or focus).
	// When it ends: a small notice under the header with a reload on request, then it goes. The text is read by screen readers
	// once at the start and once at the end, through the live region below (always in the DOM, so its changes are announced).
	// The wrapper is `display: contents`: the dot is hung against the layout's box around the mark (`relative`), out of the flow, and
	// is as wide as the gap that follows (16 px, 24 px on a wide header): it never covers the navigation, and never moves it.
	const onHold = (on: boolean) => () => { buildStatus.hold = on; };
	// Escape closes the tooltip without moving the focus or the pointer (WCAG 1.4.13); it comes back with the next hover or focus
	let dismissed = $state(false);
	onMount(() => buildStatus.start());

	// The notice is in the top layer (`popover="manual"`), as the offline toast: the header is a size container, which would make it
	// the anchor of a fixed element. Under the whole header (`--anchor-offset`, set by the layout), never over the search field of its
	// second row on a phone; horizontally under the mark (`anchor` fills the box around it), kept inside the window.
	let anchor = $state<HTMLElement | null>(null);
	let notice = $state<HTMLElement | null>(null);
	$effect(() => {
		if (!notice || !anchor) return;
		if (!notice.matches(":popover-open")) notice.showPopover();
		const left = anchor.getBoundingClientRect().left, room = document.documentElement.clientWidth - notice.offsetWidth - 8;
		notice.style.left = `${Math.max(8, Math.min(left, room))}px`;
	});
</script>

<span class="contents">
	<span class="sr-only" role="status" aria-live="polite" aria-atomic="true">{buildStatus.announce}</span>
	<span bind:this={anchor} class="pointer-events-none absolute inset-0" aria-hidden="true"></span>

	{#if buildStatus.building}
		<!-- no transform here: it would make a stacking context and the tooltip would stay under the header's second row -->
		<span class="group absolute inset-y-0 left-full z-20 flex items-center" class:dismissed data-build-status="building">
			<button type="button" class="build-dot w-4 @5xl:w-6" aria-label={t("build.updating")}
				onkeydown={(e) => { if (e.key === "Escape") dismissed = true; }} onblur={() => (dismissed = false)} onpointerleave={() => (dismissed = false)}>
				<span class="dot"></span>
			</button>
			<!-- the button's label says it: the tooltip is for the eyes (hover, focus) -->
			<span role="tooltip" aria-hidden="true" class="tip bg-popover text-popover-foreground border-input shadow-overlay border px-2 py-1 text-xs">{t("build.updating")}</span>
		</span>
	{/if}

	{#if buildStatus.updated}
		<div bind:this={notice} popover="manual" role="group" aria-label={t("build.updated")} data-build-status="updated"
			class="notice bg-popover text-popover-foreground border-input shadow-overlay m-0 w-max max-w-[calc(100vw-1rem)] items-center gap-1 overflow-visible border py-0.5 pr-0.5 pl-3 text-sm print:hidden"
			onpointerenter={onHold(true)} onpointerleave={onHold(false)} onfocusin={onHold(true)} onfocusout={onHold(false)}>
			<span>{t("build.updated")}</span>
			<Button variant="ghost" size="sm" class="gap-1.5" onclick={() => buildStatus.reload()}><Icon name="retry" size={16} />{t("build.reload")}</Button>
			<Button variant="ghost" size="icon-sm" aria-label={t("common.close")} onclick={() => buildStatus.dismiss()}><Icon name="clear" size={16} /></Button>
		</div>
	{/if}
</span>

<style>
	.build-dot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 1.5rem;
		padding: 0;
		background: none;
		border: 0;
		cursor: help;
	}
	.build-dot:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
	/* the dot is square, as the rest of the interface; the ocre is the site's signal colour (a build is news, not an alarm) */
	.dot {
		width: 0.5rem;
		height: 0.5rem;
		background: var(--signal);
		animation: build-pulse 2.4s ease-in-out infinite;
	}
	@keyframes build-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.35; }
	}
	@media (prefers-reduced-motion: reduce) {
		.dot { animation: none; }
	}
	.tip {
		position: absolute;
		top: calc(50% + 0.75rem);
		left: 0;
		margin-top: 0.125rem;
		width: max-content;
		z-index: 50;
		display: none;
		pointer-events: auto;
	}
	.group:hover .tip,
	.group:focus-within .tip {
		display: block;
	}
	.group.dismissed .tip {
		display: none;
	}
	/* `inset: auto` over the user agent's centring: left is set by the script, top is just under the header */
	.notice {
		inset: auto;
		top: calc(var(--anchor-offset, 4rem) - 0.25rem);
		left: 0.5rem;
	}
	.notice:popover-open {
		display: flex;
	}
	@media print {
		.build-dot, .tip { display: none; }
	}
</style>
