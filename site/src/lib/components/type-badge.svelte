<script lang="ts">
	import { Badge } from "#lib/components/ui/badge/index.js";
	import { typeColor, typeLabel } from "#lib/type-meta.js";

	let { type }: { type: string } = $props();
</script>

<Badge variant="outline" class="gap-1.5">
	<span class="inline-block size-2 rounded-full" style:background={typeColor(type)} aria-hidden="true"></span>
	{typeLabel(type)}
</Badge>
