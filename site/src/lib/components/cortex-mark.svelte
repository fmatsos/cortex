<script lang="ts">
	// Marque de Cortex (assets/logo/cortex-mark.svg), en currentColor : suit le thème.
	// `animated` : animation en boucle d'un cerveau qui « pense » — des influx parcourent les plis et les liens,
	// les trois nœuds du graphe s'allument à leur passage, et le contour respire doucement.
	// Avec prefers-reduced-motion, la marque est statique.
	let { size = 24, animated = false, class: cls = "" }: { size?: number; animated?: boolean; class?: string } = $props();
	const PLIS = "M32 14v37M18 15v5c0 3 2 5 5 5h2M10 28h5c4 0 7 3 7 7v2c0 5-3 8-7 8";
	const LIENS = "M44 22l-4 11 6 10";
</script>

<svg viewBox="0 0 64 64" width={size} height={size} class="mark {cls}" class:animated fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	<g class="corps">
		<path d="M32 14C32 6 20 6 18 15 10 14 6 21 10 28 3 33 7 44 15 45 14 55 27 59 32 51 37 59 50 55 49 45 57 44 61 33 54 28 58 21 54 14 46 15 44 6 32 6 32 14Z" />
		<path d={PLIS} />
		<path d="M43.2 24.4l-2.4 6.2m.6 4.5 3.2 5.8" />
	</g>
	{#if animated}
		<!-- influx : un court segment lumineux qui glisse le long des plis puis des liens -->
		<path class="influx plis" pathLength="1" d={PLIS} />
		<path class="influx liens" pathLength="1" d={LIENS} />
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
	.noeud, .corps { transform-box: fill-box; transform-origin: center; }
	@media (prefers-reduced-motion: no-preference) {
		.animated .corps { animation: respire 4.8s ease-in-out infinite; }
		.animated .influx {
			display: inline;
			stroke: var(--link-visited, currentColor);
			stroke-width: 4.5;
			stroke-dasharray: 0.14 0.86;
			stroke-dashoffset: 1.14;
			animation: influx 2.4s ease-in-out infinite;
		}
		.animated .liens { animation-delay: 1.2s; }
		.animated .noeud { animation: signal 2.4s ease-in-out infinite; }
		.animated .n1 { animation-delay: 1.25s; }
		.animated .n2 { animation-delay: 1.55s; }
		.animated .n3 { animation-delay: 1.85s; }
	}
	@keyframes influx {
		0% { stroke-dashoffset: 1.14; opacity: 0; }
		10% { opacity: 1; }
		55% { stroke-dashoffset: 0; opacity: 1; }
		60%, 100% { stroke-dashoffset: 0; opacity: 0; }
	}
	@keyframes signal {
		0%, 30%, 100% { transform: scale(1); }
		12% { transform: scale(1.8); }
	}
	@keyframes respire {
		0%, 100% { transform: scale(1); }
		50% { transform: scale(1.035); }
	}
</style>
