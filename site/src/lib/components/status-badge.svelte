<script lang="ts">
	import { Badge } from "#lib/components/ui/badge/index.js";
	import Icon from "#lib/components/icon.svelte";
	import { STATUS_LABEL, statusMeta } from "#lib/type-meta.js";

	// Statut d'une page (draft | stable | deprecated). Stable reste discret ; brouillon et déprécié sont les plus saillants.
	// Texte et icône toujours ensemble : l'état ne repose jamais sur la couleur seule.
	let { status }: { status: string } = $props();
	const meta = $derived(statusMeta(status));
</script>

<Badge variant={meta?.variant ?? "secondary"}>
	{#if meta}<Icon name={meta.icon} size={16} />{/if}
	{STATUS_LABEL[status] ?? status}
</Badge>
