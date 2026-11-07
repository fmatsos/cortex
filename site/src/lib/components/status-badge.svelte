<script lang="ts">
	import TrustIcon from "#lib/components/trust-icon.svelte";
	import { STATUS_LABEL, statusMeta } from "#lib/type-meta.js";

	// Status of a page (draft | stable | deprecated): secondary info, a small icon; stable shows nothing.
	let { status }: { status: string } = $props();
	const meta = $derived(statusMeta(status));
</script>

{#if meta && status !== "stable"}<TrustIcon icon={meta.icon} label={STATUS_LABEL[status] ?? status} />{/if}
