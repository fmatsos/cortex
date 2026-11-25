<script lang="ts">
	import { ensureSymbol, strokeFor, symbolId, type IconName } from "#lib/icons.js";
	import { cn } from "#lib/utils.js";

	// An instance of the project's icon pack (see lib/icons.ts): a `<use>` of the symbol in the page's sprite, which the
	// build-time hook wrote into the page (only the symbols the page uses), `ensureSymbol` adds this one when it is not
	// there yet (an icon that appears after the first render); the stroke contract stays here, on the instance. Decorative by default
	// (aria-hidden); with `label`, the icon carries its own accessible name (role="img"). A button preferably keeps its
	// visible text: the icon accompanies it.
	// `filled`: reserved for the active star.
	let { name, size = 20, label, filled = false, class: className, style }: { name: IconName; size?: number; label?: string; filled?: boolean; class?: string; style?: string } = $props();
	$effect(() => ensureSymbol(name));
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill={filled ? "currentColor" : "none"}
	stroke="currentColor"
	stroke-width={strokeFor(size)}
	stroke-linecap="butt"
	stroke-linejoin="miter"
	stroke-miterlimit="2"
	focusable="false"
	role={label ? "img" : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : "true"}
	class={cn("shrink-0", className)}
	{style}
><use href="#{symbolId(name)}" /></svg>
