<script lang="ts">
	import { Badge } from "#lib/components/ui/badge/index.js";
	import Icon from "#lib/components/icon.svelte";
	import { typeColor, typeIcon, typeLabel } from "#lib/type-meta.js";

	// L'icône dit le type par sa forme, la couleur du type la renforce (jamais la couleur seule) ; le libellé reste le nom accessible.
	let { type }: { type: string } = $props();
</script>

<Badge variant="outline">
	<Icon name={typeIcon(type)} size={16} style="color: {typeColor(type)}" />
	{typeLabel(type)}
</Badge>
