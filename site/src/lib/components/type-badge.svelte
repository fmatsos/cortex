<script lang="ts">
	import { Badge } from "#lib/components/ui/badge/index.js";
	import Icon from "#lib/components/icon.svelte";
	import { typeColor, typeIcon, typeLabel } from "#lib/type-meta.js";

	// The icon tells the type by its shape, the type color reinforces it (never color alone); the label remains the accessible name.
	let { type }: { type: string } = $props();
</script>

<Badge variant="outline">
	<Icon name={typeIcon(type)} size={16} style="color: {typeColor(type)}" />
	{typeLabel(type)}
</Badge>
