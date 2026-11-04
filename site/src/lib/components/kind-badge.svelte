<script lang="ts">
	import { Badge } from "#lib/components/ui/badge/index.js";
	import Icon from "#lib/components/icon.svelte";
	import { kindColor, kindDescription, kindIcon, kindLabel } from "#lib/type-meta.js";

	// Libellé français (les identifiants techniques restent dans les données) ; `title` donne l'explication courte.
	let { kind }: { kind: string } = $props();
</script>

<!-- teinte du type en fond léger ; le texte garde la couleur du thème et l'icône celle du type (contrastes mesurés par theme.test.ts) -->
<Badge variant="outline" title={kindDescription(kind) || undefined} style="background: color-mix(in oklch, {kindColor(kind)} 14%, transparent); border-color: color-mix(in oklch, {kindColor(kind)} 45%, transparent)">
	<Icon name={kindIcon(kind)} size={16} style="color: {kindColor(kind)}" />
	{kindLabel(kind)}
</Badge>
