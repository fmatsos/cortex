<script lang="ts">
	import type { Snippet } from "svelte";
	import { setMenu, type MenuContext } from "./context.js";

	// Root: owns the state shared by Trigger and Content. No markup of its own. The menu itself is a native `popover`
	// (see dropdown-menu-content.svelte); `open` is bindable and mirrors the popover's real state.
	let {
		open = $bindable(false),
		onOpenChange,
		children,
	}: { open?: boolean; onOpenChange?: (open: boolean) => void; children?: Snippet } = $props();

	let triggerEl = $state<HTMLElement | null>(null);
	let contentEl = $state<HTMLElement | null>(null);
	let active = $state<HTMLElement | null>(null);
	let focusTarget = $state<"first" | "last">("first");

	const id = $props.id();
	const ctx: MenuContext = {
		id,
		get open() { return open; },
		set open(v) { if (v !== open) { open = v; onOpenChange?.(v); } },
		get triggerEl() { return triggerEl; },
		set triggerEl(v) { triggerEl = v; },
		get contentEl() { return contentEl; },
		set contentEl(v) { contentEl = v; },
		get active() { return active; },
		set active(v) { active = v; },
		get focusTarget() { return focusTarget; },
		set focusTarget(v) { focusTarget = v; },
		close() {
			if (contentEl?.matches(":popover-open")) contentEl.hidePopover();
			triggerEl?.focus();
		},
	};
	setMenu(ctx);
</script>

{@render children?.()}
