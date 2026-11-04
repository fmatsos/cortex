<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import { chips, parseQuery, removeToken } from "#lib/query.js";

	// The active filters of the query, as removable chips (removing a chip removes all its tokens from the input).
	let { value = $bindable(""), class: className = "" } = $props();
	const list = $derived(chips(parseQuery(value)));
	const drop = (raws: string[]) => (value = raws.reduce(removeToken, value));
</script>

{#if list.length}
	<ul class="touch-gap flex flex-wrap gap-1.5 {className}" aria-label="Filtres actifs">
		{#each list as c (c.label)}
			<li>
				<!-- mousedown: the search field keeps focus (the palette stays open); Enter and Space go through click -->
				<button type="button" class="touch-target bg-secondary text-secondary-foreground hover:bg-muted focus-visible:ring-ring/50 inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-sm focus-visible:ring-3" aria-label="Retirer le filtre {c.label}" onmousedown={(e) => { e.preventDefault(); drop(c.raws); }} onclick={() => drop(c.raws)}>
					{c.label} <Icon name="clear" size={16} />
				</button>
			</li>
		{/each}
	</ul>
{/if}
