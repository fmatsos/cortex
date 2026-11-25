<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { HTMLSelectAttributes } from "svelte/elements";

	type NativeSelectProps = Omit<WithElementRef<HTMLSelectAttributes, HTMLSelectElement>, "size"> & {
		size?: "sm" | "default";
	};

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		size = "default",
		children,
		...restProps
	}: NativeSelectProps = $props();
</script>

<div
	class={cn(
		"group/native-select relative h-fit w-fit has-[select:disabled]:opacity-50",
		className
	)}
	data-slot="native-select-wrapper"
	data-size={size}
>
	<select
		bind:value
		bind:this={ref}
		data-slot="native-select"
		data-size={size}
		class="border-input placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground aria-invalid:border-destructive h-9 pointer-coarse:h-11 w-full min-w-0 appearance-none rounded-none border bg-card py-1 pr-8 pl-2.5 text-base md:text-sm motion-safe:transition-colors select-none data-[size=sm]:h-8 data-[size=sm]:py-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:cursor-not-allowed"
		{...restProps}
	>
		{@render children?.()}
	</select>
	<Icon name="chevron-down" size={16} class="text-muted-foreground top-1/2 right-2.5 -translate-y-1/2 pointer-events-none absolute select-none" />
</div>
