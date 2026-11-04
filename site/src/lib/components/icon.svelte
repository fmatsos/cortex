<script lang="ts">
	import { ICONS, strokeFor, type IconName } from "#lib/icons.js";
	import { cn } from "#lib/utils.js";

	// The project's icon pack (see lib/icons.ts). Decorative by default (aria-hidden); with `label`, the icon carries
	// its own accessible name (role="img"). A button preferably keeps its visible text: the icon accompanies it.
	// `filled`: reserved for the active star.
	let { name, size = 20, label, filled = false, class: className, style }: { name: IconName; size?: number; label?: string; filled?: boolean; class?: string; style?: string } = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill={filled ? "currentColor" : "none"}
	stroke="currentColor"
	stroke-width={strokeFor(size)}
	stroke-linecap="round"
	stroke-linejoin="round"
	focusable="false"
	role={label ? "img" : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : "true"}
	class={cn("shrink-0", className)}
	{style}
>{@html ICONS[name]}</svg>
