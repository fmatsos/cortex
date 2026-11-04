<script lang="ts">
	import { Badge } from "#lib/components/ui/badge/index.js";
	import Icon from "#lib/components/icon.svelte";
	import { kindColor, kindDescription, kindIcon, kindLabel } from "#lib/type-meta.js";

	// French label (technical identifiers stay in the data); `title` gives the short explanation.
	let { kind }: { kind: string } = $props();
</script>

<!-- type tint as a light background; the text keeps the theme color and the icon the type's (contrasts measured by theme.test.ts) -->
<Badge variant="outline" title={kindDescription(kind) || undefined} style="background: color-mix(in oklch, {kindColor(kind)} 14%, transparent); border-color: color-mix(in oklch, {kindColor(kind)} 45%, transparent)">
	<Icon name={kindIcon(kind)} size={16} style="color: {kindColor(kind)}" />
	{kindLabel(kind)}
</Badge>
