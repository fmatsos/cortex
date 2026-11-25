<script lang="ts">
	import AssistantAvatar from "#lib/components/assistant/assistant-avatar.svelte";

	// The brand mark: the brain drawn as a knowledge graph (master drawings: design/brand/cortex-mark.svg on a 32-unit grid and
	// cortex-mark-16.svg), still, in its idle composition. The same drawing as the assistant's avatar at every size: one optical
	// size from 24 px up (32 is the sharp size, one unit per pixel; the header), a reduced one under 24 px.
	let { size = 24 }: { size?: number } = $props();
</script>

<AssistantAvatar state="idle" {size} />
