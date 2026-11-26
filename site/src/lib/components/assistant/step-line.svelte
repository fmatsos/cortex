<script lang="ts">
	import { fly } from "svelte/transition";

	// One line, changed in place: the old wording fades out to the right while the new one is typed, character by character, from
	// the left. A fixed height and both lines absolutely positioned: the layout never jumps. Not announced (no live region);
	// under reduced motion the swap is instant, no typing. Local transitions: nothing plays when the line is first drawn.
	let { text }: { text: string } = $props();
	const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
	/** The text appears one character at a time (a slice, so any font works): ~22 ms each, a long line done within 600 ms. */
	function typed(node: HTMLElement) {
		const full = node.textContent ?? "";
		return { duration: calm() ? 0 : Math.min(600, full.length * 22), tick: (t: number) => { node.textContent = full.slice(0, Math.ceil(full.length * t)); } };
	}
</script>

<span class="relative block h-5 min-w-0 flex-1 overflow-hidden" data-step-line>
	{#key text}
		<span title={text} class="shimmer absolute inset-x-0 top-0 truncate leading-5" in:typed out:fly={{ x: 8, duration: calm() ? 0 : 150 }}>{text}</span>
	{/key}
</span>

<style>
	/* a light sweep across the text, the muted colour to the foreground and back, in a loop; plain text without motion */
	@media (prefers-reduced-motion: no-preference) {
		@supports (background-clip: text) {
			.shimmer {
				background: linear-gradient(100deg, var(--muted-foreground) 35%, var(--foreground) 50%, var(--muted-foreground) 65%) 100% 0 / 300% 100% no-repeat;
				background-clip: text;
				color: transparent;
				animation: sweep 2s linear infinite;
			}
		}
	}
	@keyframes sweep {
		to {
			background-position: 0 0;
		}
	}
</style>
