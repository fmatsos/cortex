<script lang="ts">
	import { cn, type WithElementRef, type WithoutChildren } from "#lib/utils.js";
	import type { HTMLTextareaAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		"data-slot": dataSlot = "textarea",
		...restProps
	}: WithoutChildren<WithElementRef<HTMLTextareaAttributes>> = $props();
</script>

<textarea
	bind:this={ref}
	data-slot={dataSlot}
	class={cn(
		"border-input aria-invalid:border-destructive disabled:bg-muted rounded-none border bg-card px-2.5 py-2 text-base motion-safe:transition-colors md:text-sm flex field-sizing-content min-h-20 w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
		className
	)}
	bind:value
	{...restProps}></textarea>
