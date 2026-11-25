<script lang="ts">
	import AssistantAvatar from "#lib/components/assistant/assistant-avatar.svelte";

	// The brand mark: the brain drawn as a knowledge graph (master drawing: design/brand/cortex-mark.svg), still, in its idle
	// composition. Sizes that keep the strokes on whole pixels: 16 and 24 (own drawings), 48, 72 and 96.
	let { size = 24 }: { size?: number } = $props();
</script>

<AssistantAvatar state="idle" {size} />
