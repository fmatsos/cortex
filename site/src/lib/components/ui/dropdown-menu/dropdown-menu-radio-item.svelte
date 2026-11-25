<script lang="ts">
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { HTMLButtonAttributes } from "svelte/elements";
	import { itemClass, useMenu, useRadio } from "./context.js";

	// One choice of a RadioGroup: `role="menuitemradio"` with `aria-checked`. The checked mark is a small solid square.
	let {
		ref = $bindable(null),
		class: className,
		value,
		disabled = false,
		onSelect,
		closeOnSelect = true,
		children,
		...restProps
	}: WithElementRef<HTMLButtonAttributes> & {
		value: string;
		onSelect?: (event: Event) => void;
		closeOnSelect?: boolean;
	} = $props();

	const menu = useMenu(), group = useRadio();
	const checked = $derived(group.value === value);

	function select(e: Event) {
		if (disabled) { e.preventDefault(); return; }
		group.select(value);
		onSelect?.(e);
		if (closeOnSelect && !e.defaultPrevented) menu.close();
	}
</script>

<button
	bind:this={ref}
	data-slot="dropdown-menu-radio-item"
	type="button"
	role="menuitemradio"
	aria-checked={checked}
	data-state={checked ? "checked" : "unchecked"}
	aria-disabled={disabled || undefined}
	tabindex={ref && menu.active === ref ? 0 : -1}
	class={cn(itemClass, "pl-8", className)}
	onclick={select}
	{...restProps}
>
	{#if checked}
		<span aria-hidden="true" class="bg-current pointer-events-none absolute left-3 size-2"></span>
	{/if}
	{@render children?.()}
</button>
