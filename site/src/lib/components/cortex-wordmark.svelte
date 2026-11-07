<script lang="ts">
	import { onMount } from "svelte";

	// The word "Cortex" in SVG, at the size of the surrounding text (1 em = 100 units).
	// Animated like the mark: after the logo's nodes (same 4 s cycle), a light runs INSIDE the letters,
	// one after the other (stroke along the outline, clipped to the shape of the letters: nothing overflows).
	// Static with prefers-reduced-motion. The readable text is the sr-only one.
	const WORD = "Cortex";
	const uid = $props.id();
	const clip = `cw-${uid}`;
	let text = $state<SVGTextElement>();
	let width = $state(330); // estimate for prerendering, measured afterwards
	onMount(() => { if (text) width = Math.ceil(text.getComputedTextLength()) + 4; });
</script>

<span class="wordmark"><span class="sr-only">{WORD}</span><svg viewBox="0 -78 {width} 84" style="width: {width / 100}em; height: 0.84em" aria-hidden="true">
	<defs><clipPath id={clip}><text x="0" y="0" font-size="100">{WORD}</text></clipPath></defs>
	<text bind:this={text} x="0" y="0" font-size="100" fill="currentColor">{WORD}</text>
	<text class="trace" x="0" y="0" font-size="100" clip-path="url(#{clip})">{#each WORD as c, i}<tspan style="animation-delay: {2 + i * 0.13}s">{c}</tspan>{/each}</text>
</svg></span>

<style>
	.wordmark { display: inline-flex; align-items: baseline; }
	svg { overflow: visible; vertical-align: baseline; }
	text { font-family: inherit; font-weight: inherit; letter-spacing: inherit; }
	.trace { display: none; }
	@media (prefers-reduced-motion: no-preference) {
		.trace {
			display: inline;
			fill: none;
			/* same light as in the logo: the background color, sliding inside the outline */
			stroke: var(--background, #fff);
			stroke-width: 6;
			stroke-linecap: round;
			stroke-linejoin: round;
		}
		.trace tspan {
			stroke-dasharray: 45 600;
			stroke-dashoffset: 645;
			opacity: 0;
			animation: lettre 4s ease-in-out infinite;
		}
	}
	@keyframes lettre {
		0% { stroke-dashoffset: 645; opacity: 0; }
		2% { opacity: 0.4; }
		16% { stroke-dashoffset: 0; opacity: 0.4; }
		18%, 100% { stroke-dashoffset: 0; opacity: 0; }
	}
</style>
