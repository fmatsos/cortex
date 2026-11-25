<script lang="ts">
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";
	import { useMenu } from "./context.js";

	// The menu: a native `popover="auto"`, so Escape, light dismiss and focus return come from the platform. Placed below
	// the trigger with CSS anchor positioning (flips above when there is no room); without it (`anchor-name` unsupported)
	// the position is computed from getBoundingClientRect on opening and the menu closes when the page scrolls.
	let {
		ref = $bindable(null),
		class: className,
		align = "start",
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & { align?: "start" | "end" } = $props();

	const menu = useMenu();
	const items = () => [...(ref?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])];
	const anchored = typeof CSS !== "undefined" && CSS.supports("anchor-name: --a");
	let fallback = $state("");
	let focusWasInside = false;
	let leaving = false; // Tab: the menu closes and the focus moves on, it does not come back to the trigger

	// `open` set from outside (bind:open) opens or closes the popover.
	$effect(() => {
		if (!ref) return;
		if (menu.open !== ref.matches(":popover-open")) menu.open ? ref.showPopover() : ref.hidePopover();
	});
	$effect(() => { menu.contentEl = ref; });

	function place() {
		const t = menu.triggerEl, c = ref;
		if (anchored || !t || !c) return;
		const r = t.getBoundingClientRect(), w = c.offsetWidth;
		const left = Math.max(8, Math.min(align === "end" ? r.right - w : r.left, innerWidth - w - 8));
		fallback = `left:${left}px;top:${r.bottom}px`;
	}

	function beforetoggle(e: Event) {
		if ((e as ToggleEvent).newState === "closed") focusWasInside = !!ref?.contains(document.activeElement);
	}
	function toggle(e: Event) {
		const opened = (e as ToggleEvent).newState === "open";
		menu.open = opened;
		if (opened) {
			place();
			const list = items();
			(menu.focusTarget === "last" ? list.at(-1) : list[0])?.focus();
			menu.focusTarget = "first";
		} else {
			menu.active = null;
			// Escape and item selection leave the focus inside the menu: bring it back to the trigger. A click elsewhere
			// already moved it, which is left alone.
			if (focusWasInside && !leaving) menu.triggerEl?.focus();
			leaving = false;
		}
	}
	function keydown(e: KeyboardEvent) {
		if (e.key === "Tab") { leaving = true; ref?.hidePopover(); return; }
		const list = items(), i = list.indexOf(document.activeElement as HTMLElement);
		let next: HTMLElement | undefined;
		if (e.key === "ArrowDown") next = list[(i + 1) % list.length];
		else if (e.key === "ArrowUp") next = list[(i <= 0 ? list.length : i) - 1];
		else if (e.key === "Home") next = list[0];
		else if (e.key === "End") next = list.at(-1);
		else return;
		e.preventDefault();
		next?.focus();
	}
	function focusin(e: FocusEvent) {
		menu.active = (e.target as HTMLElement).closest<HTMLElement>('[role^="menuitem"]');
	}
</script>

<svelte:window onscroll={() => { if (!anchored && ref?.matches(":popover-open")) menu.close(); }} />

<div
	bind:this={ref}
	data-slot="dropdown-menu-content"
	data-align={align}
	id="{menu.id}-menu"
	popover="auto"
	role="menu"
	aria-labelledby="{menu.id}-trigger"
	aria-orientation="vertical"
	tabindex="-1"
	class={cn("dropdown-menu-content bg-popover text-popover-foreground border-border m-0 max-h-[min(24rem,calc(100dvh-1rem))] w-max min-w-40 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-none border p-1 outline-none", className)}
	style="inset:auto;margin:4px 0 0;position-anchor:--{menu.id};top:anchor(bottom);{align === 'end' ? 'right:anchor(right)' : 'left:anchor(left)'};position-try-fallbacks:flip-block;{fallback}"
	onbeforetoggle={beforetoggle}
	ontoggle={toggle}
	onkeydown={keydown}
	onfocusin={focusin}
	{...restProps}
>
	{@render children?.()}
</div>
