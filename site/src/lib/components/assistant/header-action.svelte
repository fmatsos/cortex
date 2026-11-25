<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import type { IconName } from "#lib/icons.js";

	// A square icon button of the assistant's header. The tooltip (`title`) and the accessible name are the same text. When
	// it cannot be used right now (`disabled`) it keeps the focus and its tooltip (`aria-disabled`, not `disabled`: a disabled
	// button shows no tooltip) and does nothing.
	let { icon, label, disabled = false, onclick, id }: { icon: IconName; label: string; disabled?: boolean; onclick: () => void; id?: string } = $props();
</script>

<Button {id} variant="ghost" size="icon" class="pointer-coarse:size-11 {disabled ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : ''}" aria-label={label} title={label} aria-disabled={disabled || undefined}
	onclick={(e: MouseEvent) => { if (disabled) { e.preventDefault(); return; } onclick(); }}>
	<Icon name={icon} size={20} />
</Button>
