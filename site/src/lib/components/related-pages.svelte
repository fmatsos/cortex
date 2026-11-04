<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import type { RelatedEntry } from "#lib/article.js";
	import { toPage } from "#lib/links.js";
	import { typeIcon } from "#lib/type-meta.js";
	import type { Link } from "#lib/types.js";

	// Colonne latérale de navigation : les pages qui citent celle-ci (rétroliens), puis les pages à explorer ensuite.
	// Une destination n'apparaît qu'une fois ; chaque page liée porte ses motifs en courtes puces à icône.
	let { backlinks, related }: { backlinks: Link[]; related: RelatedEntry[] } = $props();

	const SHOWN = 5; // ponytail: seuil fixe ; au-delà, « Afficher tout »
	let allBack = $state(false), allRel = $state(false);
	const back = $derived(allBack ? backlinks : backlinks.slice(0, SHOWN));
	const rel = $derived(allRel ? related : related.slice(0, SHOWN));
</script>

{#snippet title(l: Link)}
	<a href={toPage(l.id)} class="text-link flex items-start gap-1.5 underline-offset-3 hover:underline">
		<Icon name={typeIcon(l.type)} size={16} class="text-muted-foreground mt-0.5 shrink-0" />
		<span class="min-w-0">{l.title}</span>
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
	<section aria-labelledby="h-back">
		<h2 id="h-back" class="mb-2 flex items-center gap-2 font-semibold" title="Pages qui citent celle-ci">
			<Icon name="backlink" size={20} />Rétroliens <span class="text-muted-foreground font-normal">{backlinks.length}</span>
		</h2>
		<ul class="space-y-1.5">
			{#each back as l (l.id)}<li>{@render title(l)}</li>{/each}
		</ul>
		{@render more(backlinks.length, allBack, () => (allBack = !allBack))}
	</section>
{/if}
{#if related.length}
	<section aria-labelledby="h-rel">
		<h2 id="h-rel" class="mb-2 flex items-center gap-2 font-semibold">
			<Icon name="related" size={20} />Pages liées <span class="text-muted-foreground font-normal">{related.length}</span>
		</h2>
		<ul class="space-y-2.5">
			{#each rel as l (l.id)}
				<li>
					{@render title(l)}
					{#if l.why.length}
						<ul class="text-muted-foreground mt-0.5 ml-[1.375rem] flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs" aria-label="Pourquoi">
							{#each l.why as w (w.label)}
								<li class="inline-flex items-center gap-1" title={w.detail}>
									<Icon name={w.icon} size={14} />{w.label}{#if w.detail}<span class="sr-only"> : {w.detail}</span>{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
		{@render more(related.length, allRel, () => (allRel = !allRel))}
	</section>
{/if}
