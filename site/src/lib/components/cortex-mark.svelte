<script lang="ts">
	import AssistantAvatar from "#lib/components/assistant/assistant-avatar.svelte";

	// The brand mark: the brain drawn as a knowledge graph (master drawing: design/brand/cortex-mark.svg), still, in its idle
	// composition. Below 40 px the avatar draws its own small glyph (viewBox 32 for 24 to 39 px, viewBox 16 below 24); sizes that
	// keep the strokes on whole pixels: 16, 24, 32 (the header), 48, 72 and 96.
	let { size = 24 }: { size?: number } = $props();
</script>

<AssistantAvatar state="idle" {size} />
