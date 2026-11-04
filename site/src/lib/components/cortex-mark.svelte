<script lang="ts">
	// Marque de Cortex (assets/logo/cortex-mark.svg), en currentColor : suit le thème.
	// `animated` : le cerveau se dessine trait par trait, puis un signal parcourt les trois nœuds du graphe, en boucle lente.
	// Avec prefers-reduced-motion, la marque est statique.
	let { size = 24, animated = false, class: cls = "" }: { size?: number; animated?: boolean; class?: string } = $props();
</script>

<svg viewBox="0 0 64 64" width={size} height={size} class="mark {cls}" class:animated fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	<path class="contour" pathLength="1" d="M32 14C32 6 20 6 18 15 10 14 6 21 10 28 3 33 7 44 15 45 14 55 27 59 32 51 37 59 50 55 49 45 57 44 61 33 54 28 58 21 54 14 46 15 44 6 32 6 32 14Z" />
	<path class="plis" pathLength="1" d="M32 14v37M18 15v5c0 3 2 5 5 5h2M10 28h5c4 0 7 3 7 7v2c0 5-3 8-7 8" />
	<path class="liens" pathLength="1" d="M43.2 24.4l-2.4 6.2m.6 4.5 3.2 5.8" />
	<g fill="currentColor" stroke="none">
		<circle class="noeud n1" cx="44" cy="22" r="2.5" />
		<circle class="noeud n2" cx="40" cy="33" r="2.5" />
		<circle class="noeud n3" cx="46" cy="43" r="2.5" />
	</g>
</svg>

<style>
	.mark { overflow: visible; }
	.noeud { transform-box: fill-box; transform-origin: center; }
	@media (prefers-reduced-motion: no-preference) {
		.animated path { stroke-dasharray: 1; stroke-dashoffset: 1; animation: trace 1.4s ease-out forwards; }
		.animated .plis { animation-delay: 0.5s; }
		.animated .liens { animation-delay: 0.9s; }
		.animated .noeud { opacity: 0; animation: apparait 0.3s ease-out forwards, signal 3.6s ease-in-out 2s infinite; }
		.animated .n1 { animation-delay: 1.1s, 2s; }
		.animated .n2 { animation-delay: 1.25s, 2.4s; }
		.animated .n3 { animation-delay: 1.4s, 2.8s; }
	}
	@keyframes trace { to { stroke-dashoffset: 0; } }
	@keyframes apparait { to { opacity: 1; } }
	@keyframes signal {
		0%, 30%, 100% { transform: scale(1); }
		12% { transform: scale(1.7); }
	}
</style>
