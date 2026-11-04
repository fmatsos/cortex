<script lang="ts">
	// Cortex mark (assets/logo/cortex-mark.svg), in currentColor: follows the theme.
	// `animated`: in a loop, a thin light runs down the axis of the brain then along the graph links,
	// and each node pulses as it passes.
	// With prefers-reduced-motion, the mark is static.
	let { size = 24, animated = false, class: cls = "" }: { size?: number; animated?: boolean; class?: string } = $props();
	const LIENS = "M44 22l-4 11 6 10";
</script>

<svg viewBox="0 0 64 64" width={size} height={size} class="mark {cls}" class:animated fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	<g>
		<path d="M32 14C32 6 20 6 18 15 10 14 6 21 10 28 3 33 7 44 15 45 14 55 27 59 32 51 37 59 50 55 49 45 57 44 61 33 54 28 58 21 54 14 46 15 44 6 32 6 32 14Z" />
		<path d="M32 14v37M18 15v5c0 3 2 5 5 5h2M10 28h5c4 0 7 3 7 7v2c0 5-3 8-7 8" />
		<path d="M43.2 24.4l-2.4 6.2m.6 4.5 3.2 5.8" />
	</g>
	{#if animated}
		<!-- inflow: runs down the central axis, then along the graph links (one path per stroke: the dashes restart on each subpath) -->
		<path class="influx i1" pathLength="1" d="M32 14v37" />
		<path class="influx i4" pathLength="1" d={LIENS} />
	{/if}
	<g fill="currentColor" stroke="none">
		<circle class="noeud n1" cx="44" cy="22" r="2.5" />
		<circle class="noeud n2" cx="40" cy="33" r="2.5" />
		<circle class="noeud n3" cx="46" cy="43" r="2.5" />
	</g>
</svg>

<style>
	.mark { overflow: visible; }
	.influx { display: none; }
	.noeud { transform-box: fill-box; transform-origin: center; }
	@media (prefers-reduced-motion: no-preference) {
		/* a thin light running inside the stroke (background color), one stroke at a time, then the nodes */
		.animated .influx {
			display: inline;
			stroke: var(--background, #fff);
			stroke-width: 2;
			stroke-dasharray: 0.2 0.8;
			stroke-dashoffset: 1.2;
			opacity: 0;
			animation: influx 4s ease-in-out infinite;
		}
		.animated .i4 { animation-delay: 1.1s; }
		.animated .noeud { animation: signal 4s ease-in-out infinite; }
		.animated .n1 { animation-delay: 1.15s; }
		.animated .n2 { animation-delay: 1.5s; }
		.animated .n3 { animation-delay: 1.85s; }
	}
	@keyframes influx {
		0% { stroke-dashoffset: 1.2; opacity: 0; }
		3% { opacity: 1; }
		28% { stroke-dashoffset: 0; opacity: 1; }
		30%, 100% { stroke-dashoffset: 0; opacity: 0; }
	}
	@keyframes signal {
		0%, 18%, 100% { transform: scale(1); }
		7% { transform: scale(1.45); }
	}
</style>
