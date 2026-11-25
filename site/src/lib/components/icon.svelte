<script lang="ts">
	import { VIEW_BOX, ensureSymbol, iconKey, symbolId, type IconName } from "#lib/icons.js";
	import { cn } from "#lib/utils.js";

	// An instance of the project's icon pack (see lib/icons.ts: Phosphor Light): a `<use>` of the symbol in the page's
	// sprite, which the build-time hook wrote into the page (only the symbols the page uses); `ensureSymbol` adds this one
	// when it is not there yet (an icon that appears after the first render). The symbols are filled shapes, so the
	// instance only carries `currentColor` and its size. Decorative by default (aria-hidden); with `label`, the icon
	// carries its own accessible name (role="img"). A button preferably keeps its visible text: the icon accompanies it.
	// `filled`: the Fill weight, where the pack has one (the active star).
	let { name, size = 20, label, filled = false, class: className, style }: { name: IconName; size?: number; label?: string; filled?: boolean; class?: string; style?: string } = $props();
	const key = $derived(iconKey(name, filled));
	$effect(() => ensureSymbol(key));
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox={VIEW_BOX}
	width={size}
	height={size}
	fill="currentColor"
	focusable="false"
	role={label ? "img" : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : "true"}
	class={cn("shrink-0", className)}
	{style}
><use href="#{symbolId(key)}" /></svg>
