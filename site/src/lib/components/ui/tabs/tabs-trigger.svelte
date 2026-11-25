<script lang="ts">
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { HTMLButtonAttributes } from "svelte/elements";
	import { slug, useTabs } from "./context.js";

	// One tab. Selected on click and on focus (automatic activation); only the selected tab is in the Tab order.
	let {
		ref = $bindable(null),
		class: className,
		value,
		disabled = false,
		children,
		onclick,
		onfocus,
		...restProps
	}: WithElementRef<HTMLButtonAttributes> & { value: string } = $props();

	const tabs = useTabs();
	const selected = $derived(tabs.value === value);
	const select = () => { if (!disabled) tabs.value = value; };
</script>

<button
	bind:this={ref}
	data-slot="tabs-trigger"
	data-value={value}
	data-state={selected ? "active" : "inactive"}
	type="button"
	role="tab"
	id="{tabs.id}-tab-{slug(value)}"
	aria-selected={selected}
	aria-controls="{tabs.id}-panel-{slug(value)}"
	tabindex={selected ? 0 : -1}
	{disabled}
	class={cn(
		"touch-target relative inline-flex flex-1 items-center justify-center gap-1.5 rounded-none border border-transparent px-3 text-sm font-medium whitespace-nowrap motion-safe:transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-selected:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
		"group-data-[variant=default]/tabs-list:aria-selected:border-input group-data-[variant=default]/tabs-list:aria-selected:bg-card",
		"group-data-[variant=line]/tabs-list:flex-none group-data-[variant=line]/tabs-list:after:absolute group-data-[variant=line]/tabs-list:after:inset-x-0 group-data-[variant=line]/tabs-list:after:-bottom-px group-data-[variant=line]/tabs-list:after:h-0.5 group-data-[variant=line]/tabs-list:aria-selected:after:bg-primary",
		className
	)}
	onclick={(e) => { (onclick as ((e: MouseEvent) => void) | undefined)?.(e as MouseEvent); select(); }}
	onfocus={(e) => { (onfocus as ((e: FocusEvent) => void) | undefined)?.(e as FocusEvent); select(); }}
	{...restProps}
>
	{@render children?.()}
</button>
