<script module lang="ts">
	// Both instances use the same randomly chosen walk for this browser session.
	let walk: number[] | undefined;
	const initialWalk = [0, 1, 2, 0, 2, 1, 0, 1, 0, 2, 1, 2, 0];
	function randomWalk() {
		const result = [Math.floor(Math.random() * 3)];
		for (let i = 1; i < 12; i++) {
			const choices = [0, 1, 2].filter((n) => n !== result[i - 1] && (i !== 11 || n !== result[0]));
			result.push(choices[Math.floor(Math.random() * choices.length)]);
		}
		return [...result, result[0]];
	}
	const headerPoints = [[32, 12], [14.68, 42], [49.32, 42]];
	const mascotPoints = [[865, 917], [811, 1010], [919, 1010]];
	function arc(points: number[][], radius: number, from: number, to: number) {
		const [x1, y1] = points[from], [x2, y2] = points[to];
		return `M${x1} ${y1}A${radius} ${radius} 0 0 ${(from + 1) % 3 === to ? 0 : 1} ${x2} ${y2}`;
	}
</script>

<script lang="ts">
	import { onMount } from "svelte";
	import mascot from "#lib/assets/cortex-mascot.svg?url";

	let { size = 24, animated = false, variant = "mascot" }: { size?: number; animated?: boolean; variant?: "mascot" | "graph" } = $props();
	let phase = $state(0);
	let route = $state(initialWalk);
	onMount(() => {
		walk ??= randomWalk();
		route = walk;
		phase = -(performance.now() % 12000);
	});
</script>

{#if variant === "graph"}
	<svg class="mark" viewBox="0 0 64 64" width={size} height={size} style="--phase: {phase}ms" aria-hidden="true">
		<path d="M32 12A20 20 0 0 0 14.68 42A20 20 0 0 0 49.32 42A20 20 0 0 0 32 12Z" fill="none" stroke="#075E75" stroke-width="5" stroke-linecap="round" />
		<g fill="#FA7067" stroke="#075E75" stroke-width="3"><circle cx="32" cy="12" r="7.5" /><circle cx="14.68" cy="42" r="7.5" /><circle cx="49.32" cy="42" r="7.5" /></g>
		<g class="signal" fill="none" stroke-width="3.5" stroke-linecap="round">
			{#each route.slice(0, -1) as point, i}<path class="edge" style="--delay: {i}s" pathLength="1" d={arc(headerPoints, 20, point, route[i + 1])} />{/each}
		</g>
		<g class="lights">{#each route.slice(0, -1) as point, i}<circle class="node" style="--delay: {i}s" cx={headerPoints[point][0]} cy={headerPoints[point][1]} r="5.5" />{/each}</g>
	</svg>
{:else if animated}
	<svg class="mark" viewBox="0 0 1312 1312" width={size} height={size} style="--phase: {phase}ms" aria-hidden="true">
		<image href={mascot} width="1312" height="1312" />
		<g class="blink" transform="translate(0 56.5)" fill="#f8ebe5" stroke="#054f5d" stroke-width="5" stroke-linecap="round">
			<path d="M627 671 Q647 674 671 681 L668 717 Q650 724 633 714Z" />
			<path d="M767 686 Q782 681 797 675 L796 716 Q782 723 771 717Z" />
		</g>
		<g transform="translate(0 56.5)">
			<g class="signal" fill="none" stroke-width="14" stroke-linecap="round">
				{#each route.slice(0, -1) as point, i}<path class="edge" style="--delay: {i}s" pathLength="1" d={arc(mascotPoints, 62, point, route[i + 1])} />{/each}
			</g>
			<g class="lights">{#each route.slice(0, -1) as point, i}<circle class="node" style="--delay: {i}s" cx={mascotPoints[point][0]} cy={mascotPoints[point][1]} r="21" />{/each}</g>
		</g>
	</svg>
{:else}
	<img src={mascot} alt="" aria-hidden="true" width={size} height={size} />
{/if}

<style>
	img, .mark { display: block; flex: none; }
	.blink, .edge, .node { opacity: 0; }
	.signal { stroke: #fff8b5; }
	.lights { fill: #fff8b5; }
	@media (prefers-reduced-motion: no-preference) {
		.blink { animation: blink 6s linear infinite; }
		.edge { stroke-dasharray: .25 .75; animation: travel 12s linear infinite; animation-delay: calc(var(--phase) + var(--delay)); }
		.node { animation: pulse 12s ease-in-out infinite; animation-delay: calc(var(--phase) + var(--delay)); }
	}
	@keyframes blink { 0%, 46%, 49%, 100% { opacity: 0; } 47%, 48% { opacity: 1; } }
	@keyframes travel {
		0% { stroke-dashoffset: .25; opacity: 1; }
		8.3% { stroke-dashoffset: -.75; opacity: 1; }
		8.34%, 100% { stroke-dashoffset: -.75; opacity: 0; }
	}
	@keyframes pulse { 0% { opacity: 1; } 4%, 100% { opacity: 0; } }
</style>
