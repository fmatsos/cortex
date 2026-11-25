<script lang="ts">
	import AssistantAvatar from "#lib/components/assistant/assistant-avatar.svelte";

	// The brand mark: the indexed folio (master drawing: design/brand/folio.svg), still, in its idle composition.
	// Sizes that keep the strokes on whole pixels: 24 (header), 48, 72 and 96.
	let { size = 24 }: { size?: number } = $props();
</script>

<AssistantAvatar state="idle" {size} />
