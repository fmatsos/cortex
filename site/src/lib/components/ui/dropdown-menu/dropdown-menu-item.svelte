<script lang="ts">
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
	import { itemClass, useMenu } from "./context.js";

	// An action row (`<button role="menuitem">`), or a link row when `href` is given. Selecting it runs `onSelect`, then
	// closes the menu unless `onSelect` calls `event.preventDefault()` (or `closeOnSelect` is false).
	let {
		ref = $bindable(null),
		class: className,
		variant = "default",
		inset = false,
		disabled = false,
		href,
		onSelect,
		closeOnSelect = true,
		children,
		...restProps
	}: WithElementRef<HTMLButtonAttributes & Omit<HTMLAnchorAttributes, "type">> & {
		variant?: "default" | "destructive";
		inset?: boolean;
		onSelect?: (event: Event) => void;
		closeOnSelect?: boolean;
	} = $props();

	const menu = useMenu();
	const cls = $derived(cn(itemClass, variant === "destructive" && "text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive focus-visible:outline-destructive", inset && "pl-8", className));

	function select(e: Event) {
		if (disabled) { e.preventDefault(); return; }
		onSelect?.(e);
		if (closeOnSelect && !e.defaultPrevented) menu.close();
	}
	// A link activates on Enter natively; Space is added so it behaves like every other menu item.
	function keydown(e: KeyboardEvent) {
		if (href && e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); }
	}
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="dropdown-menu-item"
		data-variant={variant}
		role="menuitem"
		href={disabled ? undefined : href}
		aria-disabled={disabled || undefined}
		tabindex={ref && menu.active === ref ? 0 : -1}
		class={cls}
		onclick={select}
		onkeydown={keydown}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="dropdown-menu-item"
		data-variant={variant}
		type="button"
		role="menuitem"
		aria-disabled={disabled || undefined}
		tabindex={ref && menu.active === ref ? 0 : -1}
		class={cls}
		onclick={select}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
