<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";

	export const tabsListVariants = tv({
		base: "group/tabs-list text-muted-foreground inline-flex h-9 w-fit max-w-full items-stretch rounded-none",
		variants: {
			// segmented: a framed track, the selected tab is a raised cell
			// line: a 1 px rule under the row, the selected tab carries a 2 px underline
			variant: {
				default: "border-input bg-muted gap-0.5 border p-0.5",
				line: "border-border w-full justify-start gap-1 border-b bg-transparent",
			},
		},
		defaultVariants: { variant: "default" },
	});

	export type TabsListVariant = VariantProps<typeof tabsListVariants>["variant"];
</script>

<script lang="ts">
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	// The row of tabs. Left / Right / Home / End move the focus, which selects the tab (automatic activation).
	let {
		ref = $bindable(null),
		class: className,
		variant = "default",
		children,
		onkeydown,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & { variant?: TabsListVariant } = $props();

	function keydown(e: KeyboardEvent & { currentTarget: EventTarget & HTMLDivElement }) {
		(onkeydown as ((e: KeyboardEvent) => void) | undefined)?.(e);
		if (e.defaultPrevented) return;
		const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not(:disabled)')];
		const i = tabs.indexOf(document.activeElement as HTMLElement);
		let next: HTMLElement | undefined;
		if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
		else if (e.key === "ArrowLeft") next = tabs[(i <= 0 ? tabs.length : i) - 1];
		else if (e.key === "Home") next = tabs[0];
		else if (e.key === "End") next = tabs.at(-1);
		else return;
		e.preventDefault();
		next?.focus();
	}
</script>

<div
	bind:this={ref}
	data-slot="tabs-list"
	data-variant={variant}
	role="tablist"
	aria-orientation="horizontal"
	class={cn(tabsListVariants({ variant }), className)}
	onkeydown={keydown}
	{...restProps}
>
	{@render children?.()}
</div>
