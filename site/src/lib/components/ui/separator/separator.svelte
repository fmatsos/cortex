<script lang="ts">
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	// A 1 px rule in --border. Plain element, no Bits UI: nothing interactive to manage. Decorative by default
	// (role="none"); `decorative={false}` exposes it to assistive technology as a separator.
	let {
		ref = $bindable(null),
		class: className,
		orientation = "horizontal",
		decorative = true,
		"data-slot": dataSlot = "separator",
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		orientation?: "horizontal" | "vertical";
		decorative?: boolean;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot={dataSlot}
	data-orientation={orientation}
	role={decorative ? "none" : "separator"}
	aria-orientation={decorative || orientation === "horizontal" ? undefined : orientation}
	class={cn(
		"shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch",
		className
	)}
	{...restProps}
></div>
