<script lang="ts">
	import Separator from "../separator/separator.svelte";
	import { cn } from "#lib/utils.js";
	import type { ComponentProps } from "svelte";

	// A 1 px rule between groups; exposed as role="separator" inside the menu.
	let { class: className, ...restProps }: ComponentProps<typeof Separator> = $props();
</script>

<Separator data-slot="dropdown-menu-separator" decorative={false} class={cn("-mx-1 my-1 w-auto", className)} {...restProps} />
