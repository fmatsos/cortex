<script lang="ts">
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";
	import { setTabs } from "./context.js";

	// Root of a set of tabs, with no dependency: Root > List > Trigger, then one Content per value. `value` is bindable;
	// give it an initial value so the first paint (and the prerendered page) already shows a panel. Without one, the
	// first tab is selected on mount.
	let {
		ref = $bindable(null),
		class: className,
		value = $bindable(),
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & { value?: string } = $props();

	const id = $props.id();
	setTabs({
		id,
		get value() { return value; },
		set value(v) { value = v; },
	});

	$effect(() => {
		if (value === undefined) value = ref?.querySelector<HTMLElement>('[role="tab"]:not(:disabled)')?.dataset.value;
	});
</script>

<div bind:this={ref} data-slot="tabs" class={cn("flex flex-col gap-2", className)} {...restProps}>
	{@render children?.()}
</div>
