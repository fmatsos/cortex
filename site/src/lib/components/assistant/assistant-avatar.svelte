<script module lang="ts">
	export type AvatarState = "idle" | "pending" | "answer" | "error";

	// Two drawings. The full graph (viewBox 48, 40 px and up) and, below 40 px, a purpose-drawn glyph that does not shrink the
	// graph: the brain silhouette as one closed polyline and, inside it, only the prefrontal accent (three round nodes in the
	// accent colour). The glyph is drawn on the target pixel grid: viewBox 32 for 24 to 39 px, viewBox 16 for under 24 px (also
	// the favicon). Nodes are small filled circles (the brand mark's one exception to the square system), links stay straight.
	//
	// Full: nodes: centres of the nodes; front: the nodes of the prefrontal cluster (accent colour); links: polylines, a point is a
	// node index or a [x, y] bend, f marks a link of the front cluster; path: the nodes the pending signal walks through, from the
	// back of the brain to the front; cut: the two nodes of the straight link that breaks in the error state, gap: length of the
	// break along that link; s: diameter of a node, sw: link width, grow: diameter of a front node once answered.
	type Pt = number | [number, number];
	type Link = { p: Pt[]; f?: true };
	type Optic = { vb: number; sw: number; s: number; grow: number; gap: number; cut: [number, number]; nodes: [number, number][]; front: number[]; links: Link[]; path: number[] };
	export const FULL: Optic = {
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
	};

	// Glyph: poly: the silhouette, a closed polyline (front facing right, short stem at the bottom); nodes: the three accent
	// nodes, back to front (the order the pending signal lights them); links: pairs of node indices (none at 16);
	// r: node radius, sw: contour width, lw: link width, grow: radius once answered; err: the node that turns into the error dot,
	// cut: index of the contour segment (vertex cut to cut + 1) that breaks near it, gap: length of the break.
	// Clear space between elements: at least 2 units in the 32 glyph and about 1.8 in the 16 glyph (three nodes in so small a
	// silhouette leave no more), checked in the review sheet at 8x. Node centres are on the pixel grid (half units at 32, whole at 16).
	type Glyph = { vb: number; sw: number; lw: number; r: number; grow: number; gap: number; err: number; cut: number; poly: [number, number][]; nodes: [number, number][]; links: [number, number][] };
	export const GLYPHS: Record<"compact" | "tiny", Glyph> = {
		compact: {
			vb: 32, sw: 1.5, lw: 1, r: 1.5, grow: 2, gap: 3, err: 2, cut: 5,
			poly: [[2, 15], [5, 8], [13, 4], [21, 3], [28, 7], [30, 13], [27, 20], [21, 22], [18, 26], [13, 26], [12, 21]],
			nodes: [[16.5, 8.5], [22.5, 10.5], [24.5, 15.5]],
			links: [[0, 1], [1, 2]],
		},
		tiny: {
			vb: 16, sw: 1, lw: 1, r: 1, grow: 1.5, gap: 2, err: 2, cut: 4,
			poly: [[1, 8], [1.5, 4], [5, 1.5], [11, 1.5], [14.5, 4], [14.5, 12], [10.5, 12.5], [10, 14.5], [7, 14.5], [6.5, 12.5]],
			nodes: [[5, 7], [9, 5], [11, 9]],
			links: [],
		},
	};
</script>

<script lang="ts">
	// The assistant's avatar: a brain in side profile (front facing right) drawn as a knowledge graph, small round nodes
	// joined by straight links, the outer links forming the contour; the prefrontal cluster, at the front, is in the accent
	// colour (master drawings: design/brand/cortex-mark.svg, cortex-mark-16.svg). Butt ends, mitered joins, no curved link.
	// Decorative: the state is told by the panel's text. Colours come from the tokens (currentColor, --primary, --destructive).
	//
	//   idle      still
	//   pending   full: a signal steps along the links from the back of the brain to the front cluster;
	//             glyph: the three accent nodes light up one after another; only while pending
	//   answer    the front nodes grow once, in two steps, then stay larger
	//   error     full: one link of the front cluster is broken, the break marked by a dot in the destructive colour;
	//             glyph: one node is a destructive dot and the contour is broken near it
	//
	// Reduced motion: no state moves; each is a distinct still composition (pending: the signal rests mid-path, the last
	// accent node of the glyph is dim).
	let { state = "idle", size = 24 }: { state?: AvatarState; size?: number } = $props();

	const optic = $derived(size < 24 ? "tiny" : size < 40 ? "compact" : "full");
	const o = FULL;
	const g = $derived(optic === "full" ? null : GLYPHS[optic]);
	const vb = $derived(g ? g.vb : o.vb);
	const at = (p: Pt): [number, number] => (typeof p === "number" ? o.nodes[p] : p);
	const d = (l: Link) => l.p.map((p, i) => `${i ? "L" : "M"}${at(p).join(" ")}`).join("");
	const broken = (l: Link) => l.p.length === 2 && l.p[0] === o.cut[0] && l.p[1] === o.cut[1];
	const ink = o.links.filter((l) => !l.f);
	const front = o.links.filter((l) => l.f);
	const frontCut = front.some(broken);
	const isFront = (i: number) => o.front.includes(i);

	// the pending signal: a node, the middle of a link, the next node, up to the front; seven resting places
	const stops = (() => {
		const pts = o.path.map((i) => o.nodes[i]);
		const all = pts.flatMap((p, i) => (i ? [[(pts[i - 1][0] + p[0]) / 2, (pts[i - 1][1] + p[1]) / 2], p] : [p]));
		while (all.length < 7) all.push(all[all.length - 1]);
		return all;
	})();
	const fullVars = stops.map(([x, y], i) => `--x${i}:${x}px;--y${i}:${y}px`).join(";") + `;--sx:${stops[1][0]}px;--sy:${stops[1][1]}px;--sw:${o.sw};--grow:${o.grow / o.s}`;
	const vars = $derived(g ? `--sw:${g.sw};--lw:${g.lw};--grow:${(g.grow * 2) / (g.r * 2)}` : fullVars);

	// the broken link: two stubs and, between them, the break mark
	const brk = (() => {
		const [a, b] = [o.nodes[o.cut[0]], o.nodes[o.cut[1]]];
		const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
		const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
		const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
		const h = o.gap / 2;
		return { a, b, m: [mx, my], s1: [mx - ux * h, my - uy * h], s2: [mx + ux * h, my + uy * h] };
	})();

	// the glyph's contour: closed; in the error state open, with a gap in the middle of one segment
	const contour = $derived.by(() => {
		if (!g) return "";
		const pts = g.poly;
		const pt = (p: number[]) => p.join(" ");
		if (state !== "error") return `M${pts.map(pt).join("L")}Z`;
		const a = pts[g.cut], b = pts[(g.cut + 1) % pts.length];
		const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
		const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
		const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
		const h = g.gap / 2;
		const order = pts.map((_, i) => pts[(g.cut + 1 + i) % pts.length]);
		return `M${pt([mx + ux * h, my + uy * h])}L${order.map(pt).join("L")}L${pt([mx - ux * h, my - uy * h])}`;
	});
	const glyphLinks = $derived.by(() => {
		if (!g) return "";
		const keep = g.links.filter(([a, b]) => state !== "error" || (a !== g.err && b !== g.err));
		return keep.map(([a, b]) => `M${g.nodes[a].join(" ")}L${g.nodes[b].join(" ")}`).join("");
	});
</script>

<svg class="folio" data-state={state} data-optic={optic} viewBox="0 0 {vb} {vb}" width={size} height={size} focusable="false" aria-hidden="true" style={vars}>
	{#if g}
		<g class="links ink"><path d={contour} /></g>
		{#if glyphLinks}<g class="links front glinks"><path d={glyphLinks} /></g>{/if}
		<g class="nodes front">
			{#each g.nodes as [x, y], i (i)}
				{#if state === "error" && i === g.err}
					<circle class="break" cx={x} cy={y} r={g.r} />
				{:else}
					<circle class="nf" style="--i:{i}" cx={x} cy={y} r={g.r} />
				{/if}
			{/each}
		</g>
	{:else}
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
				{#if !isFront(i)}<circle cx={x} cy={y} r={o.s / 2} />{/if}
			{/each}
		</g>
		<g class="nodes front">
			{#each o.nodes as [x, y], i (i)}
				{#if isFront(i)}<circle class="nf" cx={x} cy={y} r={o.s / 2} />{/if}
			{/each}
		</g>
		{#if state === "pending"}<circle class="signal" cx="0" cy="0" r={o.s / 2} />{/if}
		{#if state === "error"}<circle class="break" cx={brk.m[0]} cy={brk.m[1]} r={o.s / 2} />{/if}
	{/if}
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
	.glinks {
		stroke-width: var(--lw);
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
	/* glyph, reduced motion and the instant before the animation: the signal rests, the last accent node is dim */
	[data-state="pending"]:not([data-optic="full"]) .nf:nth-child(3) {
		opacity: 0.3;
	}

	@media (prefers-reduced-motion: no-preference) {
		[data-state="pending"] .signal {
			animation: walk 5s step-end infinite;
		}
		[data-state="answer"] .nf {
			animation: settle 0.5s steps(2, end) both;
		}
		/* glyph: the three accent nodes light up one after another, half a second each */
		[data-state="pending"]:not([data-optic="full"]) .nf {
			opacity: 0.3;
			animation: light 1.5s step-end infinite;
			animation-delay: calc(var(--i) * 0.5s - 1.5s);
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
	@keyframes light {
		0% { opacity: 1; }
		33.33% { opacity: 0.3; }
	}
	@keyframes settle {
		from { transform: scale(1); }
	}
</style>
