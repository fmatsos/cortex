<script lang="ts">
	import { onMount } from "svelte";

	// Le mot « Cortex » en SVG, à la taille du texte qui l'entoure (1 em = 100 unités).
	// Animé comme la marque : après les nœuds du logo (même cycle de 4 s), une lumière court À L'INTÉRIEUR des lettres,
	// l'une après l'autre (trait le long du contour, découpé à la forme des lettres : rien ne déborde).
	// Statique avec prefers-reduced-motion. Le texte lisible est le sr-only.
	const WORD = "Cortex";
	const uid = $props.id();
	const clip = `cw-${uid}`;
	let text = $state<SVGTextElement>();
	let width = $state(330); // estimation pour le prérendu, mesurée ensuite
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
			/* même lumière que dans le logo : la couleur du fond, qui file à l'intérieur du tracé */
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
