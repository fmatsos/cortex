<script lang="ts">
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";
	import { slug, useTabs } from "./context.js";

	// The panel of one tab. All panels stay in the DOM (so `aria-controls` always resolves); the others are `hidden`.
	let {
		ref = $bindable(null),
		class: className,
		value,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & { value: string } = $props();

	const tabs = useTabs();
	const selected = $derived(tabs.value === value);
</script>

<div
	bind:this={ref}
	data-slot="tabs-content"
	data-state={selected ? "active" : "inactive"}
	role="tabpanel"
	id="{tabs.id}-panel-{slug(value)}"
	aria-labelledby="{tabs.id}-tab-{slug(value)}"
	tabindex="0"
	hidden={!selected}
	class={cn("flex-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", className)}
	{...restProps}
>
	{@render children?.()}
</div>
