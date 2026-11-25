<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";

	export const badgeVariants = tv({
		// compact rectangle that reads as a label, not a control: no hover or focus look unless it is a link (see the component)
		// metadata at 14 px (`size: "sm"` = 12 px, reserved for what is really secondary); instant state changes if motion is reduced
		base: "min-h-6 gap-1.5 rounded-none border border-transparent px-2 py-0.5 text-sm leading-5 font-medium motion-safe:transition-colors has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:size-4 group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap aria-invalid:border-destructive [&>svg]:pointer-events-none",
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground [a]:hover:bg-primary/90",
				secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
				destructive: "border-destructive/40 bg-destructive/10 text-destructive [a]:hover:bg-destructive/20",
				outline: "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
				// low-stakes status (stable page): discreet, secondary text without background
				stable: "border-border text-muted-foreground",
				// state that calls for caution (draft, to review, outdated): the strongest prominence
				caution: "border-warning-foreground/40 bg-warning-background text-warning-foreground font-semibold",
				ghost: "[a]:hover:bg-muted [a]:hover:text-muted-foreground",
				link: "text-primary underline-offset-4 [a]:hover:underline",
			},
			size: {
				default: "",
				sm: "min-h-5 px-2 text-xs leading-4 [&>svg]:size-3.5",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	});

	export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];
	export type BadgeSize = VariantProps<typeof badgeVariants>["size"];
</script>

<script lang="ts">
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { HTMLAnchorAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		href,
		class: className,
		variant = "default",
		size = "default",
		children,
		...restProps
	}: WithElementRef<HTMLAnchorAttributes> & {
		variant?: BadgeVariant;
		size?: BadgeSize;
	} = $props();
</script>

<svelte:element
	this={href ? "a" : "span"}
	bind:this={ref}
	data-slot="badge"
	{href}
	class={cn(badgeVariants({ variant, size }), href && "touch-target overflow-visible focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
