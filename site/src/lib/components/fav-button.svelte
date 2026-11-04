<script lang="ts">
	import { Button } from "#lib/components/ui/button/index.js";
	import Icon from "#lib/components/icon.svelte";
	import { favs } from "#lib/favs.svelte.js";

	let { id }: { id: string } = $props();
	const on = $derived(favs.has(id));
</script>

<Button variant="outline" size="sm" aria-pressed={on} onclick={() => favs.toggle(id)} title="Favoris propres à ce navigateur">
	<Icon name="star" size={16} filled={on} class={on ? "text-favorite" : undefined} />
	{on ? "Retirer des favoris" : "Mettre en favori"}
</Button>
