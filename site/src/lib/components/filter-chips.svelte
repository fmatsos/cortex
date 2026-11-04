<script lang="ts">
	import { parseQuery, removeToken } from "#lib/query.js";

	// Les filtres actifs de la requête, en puces retirables (retirer une puce retire son jeton de la saisie).
	let { value = $bindable(""), class: className = "" } = $props();
	const chips = $derived.by(() => {
		const p = parseQuery(value);
		return [
			...p.ops.map((o) => ({ raw: o.raw, label: `${o.neg ? "sans " : ""}${o.key === "tag" ? "#" : `${o.key}:`}${o.value}` })),
			...p.phrases.map((x) => ({ raw: x.raw, label: `« ${x.text} »` })),
			...p.exclude.map((x) => ({ raw: x.raw, label: `sans ${x.text}` })),
		];
	});
</script>

{#if chips.length}
	<ul class="flex flex-wrap gap-1.5 {className}" aria-label="Filtres actifs">
		{#each chips as c (c.raw)}
			<li>
				<!-- mousedown : le champ de recherche garde le focus -->
				<button type="button" class="bg-secondary text-secondary-foreground hover:bg-muted focus-visible:ring-ring/50 inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs focus-visible:ring-3" aria-label="Retirer le filtre {c.label}" onmousedown={(e) => { e.preventDefault(); value = removeToken(value, c.raw); }} onclick={() => (value = removeToken(value, c.raw))}>
					{c.label} <span aria-hidden="true">×</span>
				</button>
			</li>
		{/each}
	</ul>
{/if}
