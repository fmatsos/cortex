<script lang="ts">
	import { chips, parseQuery, removeToken } from "#lib/query.js";

	// Les filtres actifs de la requête, en puces retirables (retirer une puce retire tous ses jetons de la saisie).
	let { value = $bindable(""), class: className = "" } = $props();
	const list = $derived(chips(parseQuery(value)));
	const drop = (raws: string[]) => (value = raws.reduce(removeToken, value));
</script>

{#if list.length}
	<ul class="touch-gap flex flex-wrap gap-1.5 {className}" aria-label="Filtres actifs">
		{#each list as c (c.label)}
			<li>
				<!-- mousedown : le champ de recherche garde le focus -->
				<button type="button" class="touch-target bg-secondary text-secondary-foreground hover:bg-muted focus-visible:ring-ring/50 inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs focus-visible:ring-3" aria-label="Retirer le filtre {c.label}" onmousedown={(e) => { e.preventDefault(); drop(c.raws); }} onclick={() => drop(c.raws)}>
					{c.label} <span aria-hidden="true">×</span>
				</button>
			</li>
		{/each}
	</ul>
{/if}
