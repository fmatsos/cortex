<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import type { RelatedEntry } from "#lib/article.js";
	import { toPage } from "#lib/links.js";
	import type { Link } from "#lib/types.js";

	// Side navigation column: the pages that cite this one (backlinks), then the pages to explore next.
	// A destination appears only once; each related page carries its reasons as short icon chips.
	let { backlinks, related }: { backlinks: Link[]; related: RelatedEntry[] } = $props();

	const SHOWN = 5; // ponytail: fixed threshold; beyond it, "Afficher tout"
	let allBack = $state(false), allRel = $state(false);
	const back = $derived(allBack ? backlinks : backlinks.slice(0, SHOWN));
	const rel = $derived(allRel ? related : related.slice(0, SHOWN));
</script>

{#snippet row(l: Link, why: RelatedEntry["why"] = [])}
	<a href={toPage(l.id)} class="hover:bg-muted focus-visible:ring-ring/50 group -mx-2 flex items-start gap-2 rounded-md px-2 py-1.5 focus-visible:ring-3 focus-visible:outline-none">
		<span class="min-w-0">
			<span class="text-link group-hover:underline underline-offset-3 leading-snug">{l.title}</span>
			<!-- reasons as discreet icons after the title: detail on hover, read in full by screen readers -->
			<!-- only the tag icon is shown; the other reasons are still read by screen readers -->
			{#each why as w (w.label)}
				{#if w.icon === "tags"}
					<span class="text-muted-foreground ml-1 inline-flex translate-y-0.5" title={w.label}>
						<Icon name="tags" size={12} /><span class="sr-only">thème commun : {w.label}</span>
					</span>
				{:else}
					<span class="sr-only">, {w.label}{w.detail ? ` : ${w.detail}` : ""}</span>
				{/if}
			{/each}
		</span>
	</a>
{/snippet}

{#snippet more(n: number, all: boolean, toggle: () => void)}
	{#if n > SHOWN}
		<button type="button" class="text-muted-foreground hover:text-foreground mt-2 inline-flex min-h-6 items-center gap-1 text-sm" aria-expanded={all} onclick={toggle}>
			<Icon name="chevron-down" size={16} class={all ? "rotate-180" : ""} />{all ? "Réduire" : `Afficher les ${n}`}
		</button>
	{/if}
{/snippet}

{#if backlinks.length}
	<section aria-labelledby="h-back" class="bg-muted/50 rounded-lg border p-3">
		<h2 id="h-back" class="mb-2 flex items-center gap-2 font-semibold" title="Pages qui citent celle-ci">
			<Icon name="backlink" size={20} class="text-muted-foreground" />Rétroliens <span class="text-muted-foreground text-sm font-normal">{backlinks.length}</span>
		</h2>
		<ul class="divide-border/60 divide-y">
			{#each back as l (l.id)}<li>{@render row(l)}</li>{/each}
		</ul>
		{@render more(backlinks.length, allBack, () => (allBack = !allBack))}
	</section>
{/if}
{#if related.length}
	<section aria-labelledby="h-rel" class="bg-muted/50 rounded-lg border p-3">
		<h2 id="h-rel" class="mb-2 flex items-center gap-2 font-semibold">
			<Icon name="related" size={20} class="text-muted-foreground" />Pages liées <span class="text-muted-foreground text-sm font-normal">{related.length}</span>
		</h2>
		<ul class="divide-border/60 divide-y">
			{#each rel as l (l.id)}<li>{@render row(l, l.why)}</li>{/each}
		</ul>
		{@render more(related.length, allRel, () => (allRel = !allRel))}
	</section>
{/if}
