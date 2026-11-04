<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import type { RelatedEntry } from "#lib/article.js";
	import { toPage } from "#lib/links.js";
	import type { Link } from "#lib/types.js";

	// Colonne latérale de navigation : les pages qui citent celle-ci (rétroliens), puis les pages à explorer ensuite.
	// Une destination n'apparaît qu'une fois (une page déjà en rétrolien n'est pas répétée dans les pages liées), et la
	// raison de chaque page liée est écrite dans la ligne, jamais cachée dans un `title`.
	let { backlinks, related }: { backlinks: Link[]; related: RelatedEntry[] } = $props();
</script>

{#if backlinks.length}
	<section aria-labelledby="h-back">
		<h2 id="h-back" class="mb-2 flex items-center gap-2 font-semibold"><Icon name="backlink" size={20} />Rétroliens ({backlinks.length})</h2>
		<p class="text-muted-foreground mb-2 text-sm">Pages qui citent celle-ci.</p>
		<ul class="space-y-1.5">
			{#each backlinks as l (l.id)}<li><a href={toPage(l.id)} class="text-link underline underline-offset-3">{l.title}</a></li>{/each}
		</ul>
	</section>
{/if}
{#if related.length}
	<section aria-labelledby="h-rel">
		<h2 id="h-rel" class="mb-2 flex items-center gap-2 font-semibold"><Icon name="related" size={20} />Pages liées</h2>
		<ul class="space-y-2.5">
			{#each related as l (l.id)}
				<li>
					<a href={toPage(l.id)} class="text-link underline underline-offset-3">{l.title}</a>
					{#if l.why.length}<p class="text-muted-foreground text-sm">{l.why.join(" · ")}</p>{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}
