<script lang="ts">
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { HTMLInputAttributes, HTMLInputTypeAttribute } from "svelte/elements";

	type InputType = Exclude<HTMLInputTypeAttribute, "file">;

	type Props = WithElementRef<
		Omit<HTMLInputAttributes, "type"> &
			({ type: "file"; files?: FileList } | { type?: InputType; files?: undefined })
	>;

	let {
		ref = $bindable(null),
		value = $bindable(),
		type,
		files = $bindable(),
		class: className,
		"data-slot": dataSlot = "input",
		...restProps
	}: Props = $props();
</script>

{#if type === "file"}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(
			"h-9 border-input aria-invalid:border-destructive disabled:bg-muted rounded-none border bg-card px-2.5 py-1 text-base motion-safe:transition-colors file:h-6 file:text-sm file:font-medium md:text-sm w-full min-w-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring file:inline-flex file:border-0 file:bg-transparent file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
			className
		)}
		type="file"
		bind:files
		bind:value
		{...restProps}
	/>
{:else}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(
			"h-9 pointer-coarse:h-11 border-input aria-invalid:border-destructive disabled:bg-muted rounded-none border bg-card px-2.5 py-1 text-base motion-safe:transition-colors file:h-6 file:text-sm file:font-medium md:text-sm w-full min-w-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring file:inline-flex file:border-0 file:bg-transparent file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
			className
		)}
		{type}
		bind:value
		{...restProps}
	/>
{/if}
