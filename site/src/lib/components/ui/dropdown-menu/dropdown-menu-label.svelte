<script lang="ts">
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	// A non-interactive heading for a group of items.
	let {
		ref = $bindable(null),
		class: className,
		inset = false,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & { inset?: boolean } = $props();
</script>

<div bind:this={ref} data-slot="dropdown-menu-label" class={cn("text-muted-foreground px-2 py-1.5 text-xs font-semibold", inset && "pl-8", className)} {...restProps}>
	{@render children?.()}
</div>
