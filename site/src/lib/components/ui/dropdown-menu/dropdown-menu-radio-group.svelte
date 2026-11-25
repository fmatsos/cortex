<script lang="ts">
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";
	import { setRadio } from "./context.js";

	// A set of mutually exclusive choices (theme, language). `value` is bindable.
	let {
		ref = $bindable(null),
		class: className,
		value = $bindable(),
		onValueChange,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & { value?: string; onValueChange?: (value: string) => void } = $props();

	setRadio({
		get value() { return value; },
		select(v) { if (v !== value) { value = v; onValueChange?.(v); } },
	});
</script>

<div bind:this={ref} data-slot="dropdown-menu-radio-group" role="group" class={cn(className)} {...restProps}>
	{@render children?.()}
</div>
