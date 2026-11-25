<script lang="ts">
	import { ICON_NAMES, ICONS, symbolId } from "#lib/icons.js";

	// The one sprite of the icon pack: a `<symbol>` per name, mounted once per document by the root layout (outside the
	// language `{#key}`, so it also exists on the 404 and error pages). Prerendering writes it into every exported page.
	// Zero-size and out of flow, never `display: none`: some browsers then fail to resolve `<use href="#...">`.
	// The stroke contract (width, caps, joins, fill) is on each instance (`icon.svelte`), not here.
</script>

<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden">
	{#each ICON_NAMES as name (name)}
		<symbol id={symbolId(name)} viewBox="0 0 24 24">{@html ICONS[name]}</symbol>
	{/each}
</svg>
