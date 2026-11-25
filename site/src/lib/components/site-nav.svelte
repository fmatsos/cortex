<script lang="ts" module>
	import type { IconName } from "#lib/icons.js";

	/** One destination of the main navigation. `label` is an i18n key (the component translates it, so a language change relabels it). */
	export type NavItem = { href: string; icon: IconName; label: string; here: boolean };
</script>

<script lang="ts">
	import { afterNavigate } from "$app/navigation";
	import Icon from "#lib/components/icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { t } from "#lib/i18n/index.js";

	// The header's main navigation. Wide header (@4xl, the header's own width): one row of links, icon and visible text.
	// Narrower: the same links in a panel under the header that a "Menu" button (visible text, not an icon alone) opens: a
	// disclosure, not an ARIA menu, since these are plain links. Escape and a click or focus outside close it and the
	// focus goes back to the button; following a link closes it. One list in the DOM, so there is nothing to keep in sync.
	// Adding a destination = one more entry in the `items` the layout passes.
	let { items }: { items: NavItem[] } = $props();
	const uid = $props.id();
	let open = $state(false);
	let nav = $state<HTMLElement | null>(null);
	let button = $state<HTMLButtonElement | null>(null);

	afterNavigate(() => { open = false; });

	function close(refocus = false) {
		if (!open) return;
		open = false;
		if (refocus) button?.focus();
	}
</script>

<svelte:window
	onpointerdown={(e) => { if (open && !nav?.contains(e.target as Node)) close(); }}
	onkeydown={(e) => { if (open && e.key === "Escape") { e.preventDefault(); close(true); } }}
/>

<nav bind:this={nav} aria-label={t("nav.label")} class="site-nav ml-auto text-sm @4xl:ml-0" onfocusout={(e) => { if (!nav?.contains(e.relatedTarget as Node | null)) close(); }}>
	<Button bind:ref={button} variant="outline" class="site-nav-toggle gap-1.5 px-3" aria-expanded={open} aria-controls="{uid}-list" onclick={() => (open = !open)}>
		{t("nav.menu")}<Icon name="chevron-down" size={16} class="motion-safe:transition-transform {open ? 'rotate-180' : ''}" />
	</Button>
	<ul id="{uid}-list" class="site-nav-list bg-header border-header-border shadow-overlay" class:open>
		{#each items as item (item.href)}
			<li><a href={item.href} aria-current={item.here ? "page" : undefined} class="nav-link" onclick={() => (open = false)}><Icon name={item.icon} size={20} />{t(item.label)}</a></li>
		{/each}
	</ul>
</nav>

<style>
	/* narrow: the list is a panel anchored to the header's inner row (the nearest positioned ancestor), below both rows */
	.site-nav-list {
		display: none;
		position: absolute;
		inset-inline: 0;
		top: 100%;
		z-index: 1;
		border-width: 0 0 1px;
		padding: 0.25rem 1rem 0.5rem;
	}
	.site-nav-list.open {
		display: block;
	}
	.nav-link {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 2.75rem;
		color: var(--muted-foreground);
		text-underline-offset: 4px;
		padding: 0.5rem 0.55rem;
		/* reserved on every link so the current one only changes colour: no layout shift */
		border-left: 2px solid transparent;
	}
	.nav-link:hover {
		color: var(--foreground);
		text-decoration: underline;
	}
	.nav-link[aria-current="page"] {
		color: var(--foreground);
		font-weight: 600;
		text-decoration: none; /* the 2px bar is the only mark of the current link */
		border-left-color: var(--primary);
	}
	@container (min-width: 56rem) {
		.site-nav :global(.site-nav-toggle) {
			display: none;
		}
		.site-nav-list,
		.site-nav-list.open {
			position: static;
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			padding: 0;
			border-width: 0;
			background: none;
			box-shadow: none;
		}
		.nav-link {
			display: inline-flex;
			gap: 0.4rem;
			min-height: 0;
			border-left: 0;
			border-bottom: 2px solid transparent;
			border-radius: var(--radius-md);
			padding-inline: 0.4rem; /* eight destinations: the row has to fit beside the search field */
		}
		.nav-link[aria-current="page"] {
			border-bottom-color: var(--primary);
		}
	}
	/* one line with the search field and the labelled assistant and preferences buttons (@7xl): the links keep their text, not their icon */
	@container (min-width: 80rem) {
		.site-nav-list :global(svg) {
			display: none;
		}
	}
	@media (pointer: coarse) {
		@container (min-width: 56rem) {
			.nav-link {
				min-height: 2.75rem;
				min-width: 2.75rem;
				justify-content: center;
			}
		}
	}
</style>
