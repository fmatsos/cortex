<script module lang="ts">
	export type AvatarState = "idle" | "pending" | "answer" | "error";

	// One drawing, three optical sizes: full (viewBox 48, 28 px and up), compact (viewBox 24, 18 to 27 px: fewer nodes, a thicker
	// link relative to the size) and tiny (viewBox 16, under 18 px, also the favicon). Coordinates are chosen so that node edges
	// land on whole pixels at the size the variant is made for (48, 96, 24, 16); links are straight segments at any angle.
	// nodes: centres of the square nodes; front: the nodes of the prefrontal cluster (accent colour);
	// links: polylines, a point is a node index or a [x, y] bend, f marks a link of the front cluster;
	// path: the nodes the pending signal walks through, from the back of the brain to the front;
	// cut: the two nodes of the straight link that breaks in the error state, gap: length of the break along that link;
	// s: side of a node, sw: link width, grow: side of a front node once answered.
	type Pt = number | [number, number];
	type Link = { p: Pt[]; f?: true };
	type Optic = { vb: number; sw: number; s: number; grow: number; gap: number; cut: [number, number]; nodes: [number, number][]; front: number[]; links: Link[]; path: number[] };
	export const OPTICS: Record<"full" | "compact" | "tiny", Optic> = {
		full: {
			vb: 48, sw: 1, s: 4, grow: 6, gap: 8, path: [4, 5, 3, 6], cut: [3, 6], front: [2, 3, 6, 7],
			nodes: [[22, 8], [10, 12], [34, 10], [26, 16], [6, 22], [18, 20], [42, 20], [30, 28], [10, 32], [20, 34], [16, 40]],
			links: [
				{ p: [4, [7, 16], 1, [16, 9], 0, 2] },
				{ p: [4, [5, 26], [7, 29], 8, [12, 36], [16, 38], 10] },
				{ p: [7, [28, 31], [26, 33], [22, 34], 9] },
				{ p: [1, 5] }, { p: [0, 5] }, { p: [4, 5] }, { p: [5, 8] }, { p: [5, 7] }, { p: [8, 9] }, { p: [9, 10] },
				{ p: [2, [39, 14], 6, [41, 25], [36, 28], 7], f: true },
				{ p: [5, 3], f: true }, { p: [3, 2], f: true }, { p: [3, 6], f: true }, { p: [3, 7], f: true }, { p: [6, 7], f: true },
			],
		},
		compact: {
			vb: 24, sw: 1, s: 4, grow: 5, gap: 4, path: [3, 4, 2, 5], cut: [4, 6], front: [1, 2, 5, 6],
			nodes: [[11, 4], [17, 5], [14, 9], [3, 12], [9, 11], [21, 11], [16, 15], [9, 20]],
			links: [
				{ p: [3, [4, 7], [6, 5], 0, 1] },
				{ p: [3, [3, 16], [6, 19], 7] },
				{ p: [6, [13, 18], 7] },
				{ p: [4, 6] }, { p: [0, 4] }, { p: [3, 4] },
				{ p: [1, [20, 7], 5, [19, 15], 6], f: true },
				{ p: [4, 2], f: true }, { p: [2, 1], f: true }, { p: [2, 5], f: true }, { p: [2, 6], f: true },
			],
		},
		tiny: {
			vb: 16, sw: 1, s: 3, grow: 4, gap: 3, path: [3, 2, 4], cut: [3, 2], front: [1, 2, 4, 5],
			nodes: [[7.5, 3.5], [12.5, 4.5], [9.5, 7.5], [2.5, 8.5], [13.5, 9.5], [10.5, 12.5], [6.5, 13.5]],
			links: [
				{ p: [3, [4, 5], 0, 1] },
				{ p: [3, [3, 12], 6] },
				{ p: [5, [8, 14], 6] },
				{ p: [3, 2] }, { p: [0, 2] },
				{ p: [1, 4], f: true }, { p: [4, 5], f: true },
				{ p: [2, 1], f: true }, { p: [2, 4], f: true }, { p: [2, 5], f: true },
			],
		},
	};
</script>

<script lang="ts">
	// The assistant's avatar: a brain in side profile (front facing right) drawn as a knowledge graph, small square nodes
	// joined by straight links, the outer links forming the contour; the prefrontal cluster, at the front, is in the accent
	// colour (master drawing: design/brand/cortex-mark.svg). Square language: square nodes, butt ends, mitered joins, no curve.
	// Decorative: the state is told by the panel's text. Colours come from the tokens (currentColor, --primary, --destructive).
	//
	//   idle      still
	//   pending   a square signal steps along the links from the back of the brain to the front cluster, only while pending
	//   answer    the front nodes grow once, in two steps, then stay larger
	//   error     one link of the front cluster is broken, the break marked by a square in the destructive colour
	//
	// Reduced motion: no state moves; each is a distinct still composition (pending: the signal rests mid-path).
	let { state = "idle", size = 24 }: { state?: AvatarState; size?: number } = $props();

	const optic = $derived(size < 18 ? "tiny" : size < 28 ? "compact" : "full");
	const o = $derived(OPTICS[optic]);
	const at = (p: Pt): [number, number] => (typeof p === "number" ? o.nodes[p] : p);
	const d = (l: Link) => l.p.map((p, i) => `${i ? "L" : "M"}${at(p).join(" ")}`).join("");
	const broken = (l: Link) => l.p.length === 2 && l.p[0] === o.cut[0] && l.p[1] === o.cut[1];
	const ink = $derived(o.links.filter((l) => !l.f));
	const front = $derived(o.links.filter((l) => l.f));
	const frontCut = $derived(front.some(broken));
	const isFront = (i: number) => o.front.includes(i);

	// the pending signal: a node, the middle of a link, the next node, up to the front; seven resting places
	const stops = $derived.by(() => {
		const pts = o.path.map((i) => o.nodes[i]);
		const all = pts.flatMap((p, i) => (i ? [[(pts[i - 1][0] + p[0]) / 2, (pts[i - 1][1] + p[1]) / 2], p] : [p]));
		while (all.length < 7) all.push(all[all.length - 1]);
		return all;
	});
	const vars = $derived(stops.map(([x, y], i) => `--x${i}:${x}px;--y${i}:${y}px`).join(";") + `;--sx:${stops[1][0]}px;--sy:${stops[1][1]}px;--sw:${o.sw};--grow:${o.grow / o.s}`);

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
	</g>
	<g class="links front">
		{#each front as l, i (i)}
			{#if state !== "error" || !broken(l)}<path d={d(l)} />{/if}
		{/each}
		{#if state === "error" && frontCut}<path d="M{brk.a.join(" ")}L{brk.s1.join(" ")}M{brk.s2.join(" ")}L{brk.b.join(" ")}" />{/if}
	</g>
	{#if state === "error" && !frontCut}
		<g class="links ink"><path d="M{brk.a.join(" ")}L{brk.s1.join(" ")}M{brk.s2.join(" ")}L{brk.b.join(" ")}" /></g>
	{/if}
	<g class="nodes ink">
		{#each o.nodes as [x, y], i (i)}
			{#if !isFront(i)}<rect x={x - o.s / 2} y={y - o.s / 2} width={o.s} height={o.s} />{/if}
		{/each}
	</g>
	<g class="nodes front">
		{#each o.nodes as [x, y], i (i)}
			{#if isFront(i)}<rect class="nf" x={x - o.s / 2} y={y - o.s / 2} width={o.s} height={o.s} />{/if}
		{/each}
	</g>
	{#if state === "pending"}<rect class="signal" x={-o.s / 2} y={-o.s / 2} width={o.s} height={o.s} />{/if}
	{#if state === "error"}<rect class="break" x={brk.m[0] - o.s / 2} y={brk.m[1] - o.s / 2} width={o.s} height={o.s} />{/if}
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
			animation: walk 5s step-end infinite;
		}
		[data-state="answer"] .nf {
			animation: settle 0.5s steps(2, end) both;
		}
	}
	/* the signal rests on each place for half a second, holds on the front, then starts again from the back */
	@keyframes walk {
		0% { transform: translate(var(--x0), var(--y0)); }
		10% { transform: translate(var(--x1), var(--y1)); }
		20% { transform: translate(var(--x2), var(--y2)); }
		30% { transform: translate(var(--x3), var(--y3)); }
		40% { transform: translate(var(--x4), var(--y4)); }
		50% { transform: translate(var(--x5), var(--y5)); }
		60% { transform: translate(var(--x6), var(--y6)); }
	}
	@keyframes settle {
		from { transform: scale(1); }
	}
</style>
