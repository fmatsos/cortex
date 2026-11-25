<script module lang="ts">
	export type AvatarState = "idle" | "pending" | "answer" | "error";

	// One drawing at every size: a brain in side profile (front facing right) drawn as a knowledge graph. Eight round nodes
	// (five ink ones, the last of them the stem, and the three of the prefrontal cluster in the accent colour) joined by straight
	// links; the outer links draw the silhouette, three inner links tie the back to the cluster. There are two optical sizes of
	// the same drawing, never two drawings: `mark` on a 32-unit grid (from 24 px, one unit is one pixel at 32 px) and `tiny` on a
	// 16-unit grid (under 24 px, also the favicon) that keeps the silhouette and the cluster and drops what no longer fits.
	// Nodes are small filled circles (the brand mark's one exception to the square system), links stay straight.
	//
	// vb: grid; sw: link width; r: ink node radius; rf: front node radius; grow: front node radius once answered;
	// nodes: centres; front: the nodes of the prefrontal cluster (accent colour); links: polylines, a point is a node index or
	// a [x, y] bend, f marks a link of the cluster; path: the nodes the pending signal walks through, from the back of the brain
	// into the cluster; cut: the two nodes of the straight link that breaks in the error state, gap: length of the break along
	// that link, rb: radius of the dot in the break.
	// Clear space, checked in the review sheet at 8x: at 32 px at least 2.5 units between any node and any link that does not
	// end on it, or any other node (the tightest place is the stem, 2.5 below the bottom node); at 16 px at least 2 units
	// at rest and 1.3 once the cluster has grown.
	type Pt = number | [number, number];
	type Link = { p: Pt[]; f?: true };
	type Optic = { vb: number; sw: number; r: number; rf: number; grow: number; gap: number; rb: number; cut: [number, number]; nodes: [number, number][]; front: number[]; links: Link[]; path: number[] };
	export const OPTICS: Record<"mark" | "tiny", Optic> = {
		// 0 back, 1 top-back, 2 top, 3 bottom (the stem hangs from it), 4 stem; 5 front-top, 6 front, 7 inside the cluster
		mark: {
			vb: 32, sw: 1.3, r: 1.5, rf: 1.75, grow: 2.25, gap: 7, rb: 1.5, cut: [1, 7], path: [1, 7, 6], front: [5, 6, 7],
			nodes: [[3.5, 14.5], [9.5, 6.5], [18.5, 4], [15.5, 24.5], [15, 30], [26, 8], [29.5, 16], [21, 15]],
			links: [
				{ p: [0, 1] }, { p: [1, 2] }, { p: [2, 5] },
				{ p: [0, [4, 20], [8, 24], 3] }, { p: [3, [21.5, 24], [27, 20.5], 6] }, { p: [3, 4] },
				{ p: [1, 7] },
				{ p: [5, 6], f: true }, { p: [7, 5], f: true }, { p: [7, 6], f: true },
			],
		},
		// 0 back, 1 top, 2 bottom (a stub below it is the stem); 3 front-top, 4 front, 5 inside the cluster. One inner link fewer
		// than the mark (the cluster is a chain, not a triangle) and no stubs when the break opens: the gap swallows the link.
		tiny: {
			vb: 16, sw: 1, r: 1.15, rf: 1.25, grow: 1.6, gap: 5.6, rb: 0.85, cut: [1, 5], path: [1, 5, 4], front: [3, 4, 5],
			nodes: [[2, 7], [6, 2], [7.5, 12.5], [12.5, 4], [14, 8.5], [9.5, 8]],
			links: [
				{ p: [0, 1] }, { p: [1, [10, 1.5], 3] },
				{ p: [0, [2, 10.5], [4.5, 12.5], 2] }, { p: [2, [11, 12.5], [13.5, 11], 4] }, { p: [2, [7.5, 15]] },
				{ p: [1, 5] },
				{ p: [3, 4], f: true }, { p: [5, 4], f: true },
			],
		},
	};
</script>

<script lang="ts">
	// The assistant's avatar and the brand mark (master drawings: design/brand/cortex-mark.svg and cortex-mark-16.svg).
	// Decorative: the state is told by the panel's text. Colours come from the tokens (currentColor, --primary, --destructive).
	// Butt ends, mitered joins, no curved link.
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
	const d = (l: Link) => l.p.map((p, i) => `${i ? "L" : "M"}${at(p).join(" ")}`).join("");
	const broken = (l: Link) => l.p.length === 2 && l.p[0] === o.cut[0] && l.p[1] === o.cut[1];
	const ink = $derived(o.links.filter((l) => !l.f));
	const front = $derived(o.links.filter((l) => l.f));
	const isFront = (i: number) => o.front.includes(i);
	// large sizes thin the links a little: the same nodes, a finer line
	const sw = $derived(size >= 64 ? o.sw * 0.8 : size >= 40 ? o.sw * 0.9 : o.sw);

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
	const vars = $derived(stops.map(([x, y], i) => `--x${i}:${x}px;--y${i}:${y}px`).join(";") + `;--sx:${stops[2][0]}px;--sy:${stops[2][1]}px;--sw:${sw};--grow:${o.grow / o.rf}`);

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
		{#each ink as l, i (i)}{#if state !== "error" || !broken(l)}<path d={d(l)} />{/if}{/each}
		{#if state === "error"}<path d="M{brk.a.join(" ")}L{brk.s1.join(" ")}M{brk.s2.join(" ")}L{brk.b.join(" ")}" />{/if}
	</g>
	<g class="links front">
		{#each front as l, i (i)}<path d={d(l)} />{/each}
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
	{#if state === "pending"}<circle class="signal" cx="0" cy="0" r={o.r} />{/if}
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
			animation: walk 4s step-end infinite;
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
