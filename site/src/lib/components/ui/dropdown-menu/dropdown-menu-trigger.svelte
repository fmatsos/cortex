<script lang="ts">
	import { buttonVariants, type ButtonSize, type ButtonVariant } from "../button/button.svelte";
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { HTMLButtonAttributes } from "svelte/elements";
	import { useMenu } from "./context.js";

	// The button that opens the menu. `popovertarget` gives the click, Enter and Space toggle natively; ArrowDown (first
	// item) and ArrowUp (last item) open it from the keyboard. `variant` / `size` borrow the Button look; leave them
	// out to style the trigger with `class` alone.
	let {
		ref = $bindable(null),
		class: className,
		variant,
		size,
		type = "button",
		children,
		onkeydown,
		...restProps
	}: WithElementRef<HTMLButtonAttributes, HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize } = $props();

	const menu = useMenu();

	function keydown(e: KeyboardEvent & { currentTarget: EventTarget & HTMLButtonElement }) {
		(onkeydown as ((e: KeyboardEvent) => void) | undefined)?.(e);
		if (e.defaultPrevented || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
		e.preventDefault();
		menu.focusTarget = e.key === "ArrowDown" ? "first" : "last";
		if (!menu.contentEl?.matches(":popover-open")) menu.contentEl?.showPopover();
		else menu.contentEl.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
	}

	$effect(() => { menu.triggerEl = ref; });
</script>

<button
	bind:this={ref}
	data-slot="dropdown-menu-trigger"
	id="{menu.id}-trigger"
	{type}
	class={cn(variant || size ? buttonVariants({ variant: variant ?? "outline", size }) : "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", className)}
	style="anchor-name: --{menu.id}"
	popovertarget="{menu.id}-menu"
	aria-haspopup="menu"
	aria-expanded={menu.open}
	aria-controls="{menu.id}-menu"
	onkeydown={keydown}
	{...restProps}
>
	{@render children?.()}
</button>
