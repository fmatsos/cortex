<script lang="ts">
	import type { Snippet } from "svelte";
	import { cn } from "#lib/utils.js";

	// A modal dialog on the native `<dialog>` element: `showModal()` gives the top layer, the inert page behind, Escape and
	// the return of the focus to the control that opened it. Square, with the floating-layer shadow and edge (--shadow-overlay,
	// --input) like the menus. `open` is bindable and mirrors the real state (Escape closes it too); a click on the backdrop
	// closes it. The first field or button of the body takes the focus: put `autofocus` on the safest one (Cancel, for a
	// destructive confirmation). `title` names it (aria-labelledby); `description` is optional body text.
	let {
		open = $bindable(false),
		title,
		description,
		children,
		actions,
		class: className,
		onclose,
	}: { open?: boolean; title: string; description?: string; children?: Snippet; actions?: Snippet; class?: string; onclose?: () => void } = $props();
	const uid = $props.id();
	let el = $state<HTMLDialogElement | null>(null);

	$effect(() => {
		if (!el) return;
		if (open && !el.open) el.showModal();
		else if (!open && el.open) el.close();
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
	bind:this={el}
	data-slot="dialog"
	aria-labelledby="{uid}-title"
	aria-describedby={description ? `${uid}-description` : undefined}
	class={cn("bg-popover text-popover-foreground border-input shadow-overlay m-auto max-h-[calc(100dvh-2rem)] w-[min(30rem,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-none border p-0 backdrop:bg-foreground/40", className)}
	onclose={() => { open = false; onclose?.(); }}
	onclick={(e) => { if (e.target === el) el?.close(); }}
>
	<div class="flex flex-col gap-3 p-5">
		<h2 id="{uid}-title" class="text-lg font-semibold tracking-tight">{title}</h2>
		{#if description}<p id="{uid}-description" class="text-muted-foreground text-sm">{description}</p>{/if}
		{@render children?.()}
		{#if actions}<div class="mt-2 flex flex-wrap justify-end gap-2">{@render actions()}</div>{/if}
	</div>
</dialog>
