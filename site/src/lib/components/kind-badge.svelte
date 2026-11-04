<script lang="ts">
	import { Badge } from "#lib/components/ui/badge/index.js";
	import { kindColor, kindLabel } from "#lib/type-meta.js";

	let { kind }: { kind: string } = $props();
</script>

<!-- teinte du type en fond léger ; le texte garde la couleur du thème (contraste assuré en clair et en sombre) -->
<Badge variant="outline" class="gap-1.5" style="background: color-mix(in oklch, {kindColor(kind)} 14%, transparent); border-color: color-mix(in oklch, {kindColor(kind)} 45%, transparent)">
	<span class="inline-block size-2 rounded-full" style:background={kindColor(kind)} aria-hidden="true"></span>
	{kindLabel(kind)}
</Badge>
