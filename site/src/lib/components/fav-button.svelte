<script lang="ts">
	import { Button } from "#lib/components/ui/button/index.js";
	import { favs } from "#lib/favs.svelte.js";

	let { id }: { id: string } = $props();
	const on = $derived(favs.has(id));
</script>

<Button variant="outline" size="sm" aria-pressed={on} onclick={() => favs.toggle(id)} title="Favoris propres à ce navigateur">
	<svg viewBox="0 0 24 24" class="size-4" fill={on ? "currentColor" : "none"} stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg>
	{on ? "Retirer des favoris" : "Mettre en favori"}
</Button>
