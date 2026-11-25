<script module lang="ts">
	export type AvatarState = "idle" | "pending" | "answer" | "error";

	// Side-profile brain, front facing right. The contour and triangulation follow the brand reference.
	// One 32-unit drawing from 24 px up; the 16-unit favicon drops the central hub and stem node.
	// All coordinates are on half units. Filled circles are the brand's exception to the square UI.
	// p: node indices or contour bends; f: accent link; cut/gap/rb: broken link and error dot;
	// path: connected nodes followed by the pending signal; grow: answered front-node radius.
	type Pt = number | [number, number];
	type Link = { p: Pt[]; f?: true };
	type Optic = { vb: number; sw: number; r: number; rf: number; grow: number; gap: number; rb: number; cut: [number, number]; nodes: [number, number][]; front: number[]; links: Link[]; path: number[] };
	export const OPTICS: Record<"mark" | "tiny", Optic> = {
		// 0 back, 1 upper back, 2 crown, 3 temporal back, 4 hub, 5 temporal bottom, 6 stem;
		// 7 frontal top, 8 frontal hub, 9 frontal tip, 10 frontal bottom.
		mark: {
			vb: 32, sw: 0.65, r: 1.25, rf: 1.3, grow: 1.6, gap: 4, rb: 0.65, cut: [1, 4], path: [0, 4, 8, 9], front: [7, 8, 9, 10],
			nodes: [[2.5, 14], [6.5, 7], [15.5, 3.5], [5.5, 20.5], [12, 13], [13.5, 22], [11, 27], [23.5, 6], [19, 9.5], [29.5, 13], [21, 18]],
			links: [
				{ p: [0, [3.5, 10], 1] }, { p: [1, [10.5, 4.5], 2] }, { p: [2, [19.5, 4.5], 7] },
				{ p: [0, [2.5, 17], [3.5, 18.5], 3] }, { p: [3, [7.5, 23.5], [10.5, 24.5], 6] }, { p: [6, 5] },
				{ p: [5, [15, 22.5], [18.5, 21.5], [20, 20.5], 10] },
				{ p: [1, 4] }, { p: [2, 4] }, { p: [0, 4] }, { p: [3, 4] }, { p: [3, 5] }, { p: [4, 10] },
				{ p: [7, [27.5, 9], 9], f: true }, { p: [9, [28, 16.5], [25.5, 18], 10], f: true },
				{ p: [4, 8], f: true }, { p: [8, 7], f: true }, { p: [8, 9], f: true }, { p: [8, 10], f: true }, { p: [10, 9], f: true },
			],
		},
		// 0 back, 1 crown, 2 temporal back, 3 temporal bottom; 4 frontal top, 5 tip, 6 frontal bottom.
		tiny: {
			vb: 16, sw: 0.65, r: 0.65, rf: 0.7, grow: 0.85, gap: 4.5, rb: 0.45, cut: [0, 6], path: [0, 6, 5], front: [4, 5, 6],
			nodes: [[1.5, 7], [7.5, 2], [3, 10.5], [7, 11.5], [11.5, 3.5], [14.5, 7], [10.5, 9.5]],
			links: [
				{ p: [0, [2.5, 4.5], [4.5, 2.5], 1] }, { p: [1, [9.5, 2.5], 4] },
				{ p: [0, [1.5, 8.5], [2, 9.5], 2] }, { p: [2, [4, 12.5], [4.5, 14.5], 3] },
				{ p: [2, 3] }, { p: [3, [9, 11], [10, 10.5], 6] }, { p: [0, 6] },
				{ p: [4, [13.5, 5], 5], f: true }, { p: [5, [13.5, 9], [12, 9.5], 6], f: true },
				{ p: [4, 6], f: true }, { p: [6, 5], f: true },
			],
		},
	};
</script>

<script lang="ts">
	// The assistant's avatar and the brand mark (master drawings: design/brand/cortex-mark.svg and cortex-mark-16.svg).
	// Decorative: the state is told by the panel's text. Colours come from the tokens (currentColor, --primary, --destructive).
	// Butt ends, mitered joins, straight links.
	//
	//   idle      still
	//   pending   a signal steps along the links from the back of the brain into the cluster; only while pending
	//   answer    the cluster nodes grow once, in two steps, then stay larger
	//   error     one inner link is broken, the break marked by a dot in the destructive colour
	//
	// Reduced motion: no state moves; each is a distinct still composition (pending: the signal rests on the first link).
	let { state = "idle", size = 32 }: { state?: AvatarState; size?: number } = $props();

	const optic = $derived(size < 24 ? "tiny" : "mark");
	const o = $derived(OPTICS[optic]);
	const at = (p: Pt): [number, number] => (typeof p === "number" ? o.nodes[p] : p);
	const points = (l: Link) => l.p.map((p) => at(p).join(",")).join(" ");
	const broken = (l: Link) => l.p.length === 2 && l.p[0] === o.cut[0] && l.p[1] === o.cut[1];
	const ink = $derived(o.links.filter((l) => !l.f));
	const front = $derived(o.links.filter((l) => l.f));
	const isFront = (i: number) => o.front.includes(i);

	// the pending signal rests on each node of the path and on one or two points between them (up to eight resting places)
	const stops = $derived.by(() => {
		const pts = o.path.map((i) => o.nodes[i]);
		const all: number[][] = [pts[0]];
		for (let i = 1; i < pts.length; i++) {
			const [a, b] = [pts[i - 1], pts[i]];
			const k = Math.hypot(b[0] - a[0], b[1] - a[1]) > o.vb * 0.375 ? 3 : 2;
			for (let j = 1; j <= k; j++) all.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
		}
		while (all.length < 8) all.push(all[all.length - 1]);
		return all;
	});
	const vars = $derived(stops.map(([x, y], i) => `--x${i}:${x}px;--y${i}:${y}px`).join(";") + `;--sx:${stops[1][0]}px;--sy:${stops[1][1]}px;--sw:${o.sw};--grow:${o.grow / o.rf}`);

	// the broken link: two stubs and, between them, the break mark
	const brk = $derived.by(() => {
		const [a, b] = [o.nodes[o.cut[0]], o.nodes[o.cut[1]]];
		const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
		const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
		const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
		const h = o.gap / 2;
		return { a, b, m: [mx, my], s1: [mx - ux * h, my - uy * h], s2: [mx + ux * h, my + uy * h] };
	});
</script>

<svg class="folio" data-state={state} data-optic={optic} viewBox="0 0 {o.vb} {o.vb}" width={size} height={size} focusable="false" aria-hidden="true" style={vars}>
	<g class="links ink">
		{#each ink as l, i (i)}{#if state !== "error" || !broken(l)}<polyline points={points(l)} />{/if}{/each}
		{#if state === "error"}<polyline points="{brk.a.join(",")} {brk.s1.join(",")}" /><polyline points="{brk.s2.join(",")} {brk.b.join(",")}" />{/if}
	</g>
	<g class="links front">
		{#each front as l, i (i)}<polyline points={points(l)} />{/each}
	</g>
	<g class="nodes ink">
		{#each o.nodes as [x, y], i (i)}
			{#if !isFront(i)}<circle cx={x} cy={y} r={o.r} />{/if}
		{/each}
	</g>
	<g class="nodes front">
		{#each o.nodes as [x, y], i (i)}
			{#if isFront(i)}<circle class="nf" cx={x} cy={y} r={o.rf} />{/if}
		{/each}
	</g>
	{#if state === "pending"}<circle class="signal" cx="0" cy="0" r={o.rb} />{/if}
	{#if state === "error"}<circle class="break" cx={brk.m[0]} cy={brk.m[1]} r={o.rb} />{/if}
</svg>

<style>
	.folio {
		display: block;
		flex: none;
	}
	.links {
		fill: none;
		stroke-width: var(--sw);
		stroke-linecap: butt;
		stroke-linejoin: miter;
	}
	.ink {
		stroke: currentColor;
		fill: currentColor;
	}
	.links.ink {
		fill: none;
	}
	.nodes.ink {
		stroke: none;
	}
	.front {
		stroke: var(--primary, currentColor);
		fill: var(--primary, currentColor);
	}
	.links.front {
		fill: none;
	}
	.nodes.front {
		stroke: none;
	}
	.signal {
		fill: var(--primary, currentColor);
		transform: translate(var(--sx), var(--sy));
	}
	.break {
		fill: var(--destructive, currentColor);
	}
	.nf {
		transform-box: fill-box;
		transform-origin: center;
	}
	[data-state="answer"] .nf {
		transform: scale(var(--grow));
	}

	@media (prefers-reduced-motion: no-preference) {
		[data-state="pending"] .signal {
			animation: walk 4s steps(1, end) infinite;
		}
		[data-state="answer"] .nf {
			animation: settle 0.5s steps(2, end) both;
		}
	}
	/* the signal rests on each place for half a second, holds on the front, then starts again from the back */
	@keyframes walk {
		0% { transform: translate(var(--x0), var(--y0)); }
		12.5% { transform: translate(var(--x1), var(--y1)); }
		25% { transform: translate(var(--x2), var(--y2)); }
		37.5% { transform: translate(var(--x3), var(--y3)); }
		50% { transform: translate(var(--x4), var(--y4)); }
		62.5% { transform: translate(var(--x5), var(--y5)); }
		75% { transform: translate(var(--x6), var(--y6)); }
		87.5% { transform: translate(var(--x7), var(--y7)); }
	}
	@keyframes settle {
		from { transform: scale(1); }
	}
</style>
