<script lang="ts">
	import { Badge } from "#lib/components/ui/badge/index.js";
	import Icon from "#lib/components/icon.svelte";
	import { STATUS_LABEL, statusMeta } from "#lib/type-meta.js";

	// Status of a page (draft | stable | deprecated). Stable stays discreet; draft and deprecated are the most prominent.
	// Text and icon always together: the state never relies on color alone.
	let { status }: { status: string } = $props();
	const meta = $derived(statusMeta(status));
</script>

<Badge variant={meta?.variant ?? "secondary"}>
	{#if meta}<Icon name={meta.icon} size={16} />{/if}
	{STATUS_LABEL[status] ?? status}
</Badge>
