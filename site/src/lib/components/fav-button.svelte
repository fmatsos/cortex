<script lang="ts">
	import { Button } from "#lib/components/ui/button/index.js";
	import Icon from "#lib/components/icon.svelte";
	import { favs } from "#lib/favs.svelte.js";
	import { t as tr } from "#lib/i18n/index.js";

	let { id }: { id: string } = $props();
	const on = $derived(favs.has(id));
</script>

<Button variant="outline" size="sm" aria-pressed={on} onclick={() => favs.toggle(id)} title={tr("fav.title")}>
	<Icon name="star" size={16} filled={on} class={on ? "text-favorite" : undefined} />
	{on ? tr("fav.remove") : tr("fav.add")}
</Button>
<span role="status" class="text-muted-foreground text-sm">{favs.persisted ? "" : tr("fav.sessionOnly")}</span>
