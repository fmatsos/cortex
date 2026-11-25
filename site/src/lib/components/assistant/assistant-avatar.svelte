<script module lang="ts">
	export type AvatarState = "idle" | "pending" | "answer" | "error";

	// Side-profile brain, front facing right. The contour and triangulation follow the brand reference.
	// One 32-unit drawing from 24 px up; the 16-unit favicon drops the central hub and stem node.
	// All coordinates are on half units. Filled circles are the brand's exception to the square UI.
	// p: node indices or contour bends; f: accent link; cut/gap/rb: broken link and error dot;
	// inner: links the pending signal can walk; grow: answered front-node radius.
	type Pt = number | [number, number];
	type Link = { p: Pt[]; f?: true; inner?: true };
	type Optic = { vb: number; sw: number; r: number; rf: number; grow: number; gap: number; rb: number; cut: [number, number]; nodes: [number, number][]; front: number[]; links: Link[] };
	export const OPTICS: Record<"mark" | "tiny", Optic> = {
		// 0 back, 1 upper back, 2 crown, 3 temporal back, 4 hub, 5 temporal bottom, 6 stem;
		// 7 frontal top, 8 frontal hub, 9 frontal tip, 10 frontal bottom.
		mark: {
			vb: 32, sw: 0.65, r: 1.25, rf: 1.3, grow: 1.6, gap: 4, rb: 0.65, cut: [1, 4], front: [7, 8, 9, 10],
			nodes: [[2.5, 14], [6.5, 7], [15.5, 3.5], [5.5, 20.5], [12, 13], [13.5, 22], [11, 27], [23.5, 6], [19, 9.5], [29.5, 13], [21, 18]],
			links: [
				{ p: [0, [3.5, 10], 1] }, { p: [1, [10.5, 4.5], 2] }, { p: [2, [19.5, 4.5], 7] },
				{ p: [0, [2.5, 17], [3.5, 18.5], 3] }, { p: [3, [7.5, 23.5], [10.5, 24.5], 6] }, { p: [6, 5] },
				{ p: [5, [15, 22.5], [18.5, 21.5], [20, 20.5], 10] },
				{ p: [1, 4], inner: true }, { p: [2, 4], inner: true }, { p: [0, 4], inner: true },
				{ p: [3, 4], inner: true }, { p: [3, 5], inner: true }, { p: [4, 10], inner: true },
				{ p: [7, [27.5, 9], 9], f: true }, { p: [9, [28, 16.5], [25.5, 18], 10], f: true },
				{ p: [4, 8], f: true, inner: true }, { p: [8, 7], f: true, inner: true }, { p: [8, 9], f: true, inner: true },
				{ p: [8, 10], f: true, inner: true }, { p: [10, 9], f: true, inner: true },
			],
		},
		// 0 back, 1 crown, 2 temporal back, 3 temporal bottom; 4 frontal top, 5 tip, 6 frontal bottom.
		tiny: {
			vb: 16, sw: 0.65, r: 0.65, rf: 0.7, grow: 0.85, gap: 4.5, rb: 0.45, cut: [0, 6], front: [4, 5, 6],
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
	//   pending   a small signal and soft halo wander along the inner links; only while pending
	//   answer    the cluster nodes grow once, in two steps, then stay larger
	//   error     one inner link is broken, the break marked by a dot in the destructive colour
	//
	// Reduced motion and tiny sizes: the pending signal rests at the middle of an inner link.
	let { state: avatarState = "idle", size = 32 }: { state?: AvatarState; size?: number } = $props();
	let signal: SVGGElement | undefined = $state();

	const optic = $derived(size < 24 ? "tiny" : "mark");
	const o = $derived(OPTICS[optic]);
	const at = (p: Pt): [number, number] => (typeof p === "number" ? o.nodes[p] : p);
	const points = (l: Link) => l.p.map((p) => at(p).join(",")).join(" ");
	const broken = (l: Link) => l.p.length === 2 && l.p[0] === o.cut[0] && l.p[1] === o.cut[1];
	const ink = $derived(o.links.filter((l) => !l.f));
	const front = $derived(o.links.filter((l) => l.f));
	const isFront = (i: number) => o.front.includes(i);

	const vars = $derived(`--sw:${o.sw};--grow:${o.grow / o.rf}`);

	$effect(() => {
		const el = signal, drawing = o;
		if (avatarState !== "pending" || !el || optic === "tiny") return;

		const neighbours = new Map<number, number[]>();
		for (const link of drawing.links.filter((l) => l.inner)) {
			const [a, b] = link.p as [number, number];
			neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
			neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
		}
		const pick = (nodes: number[]) => nodes[Math.floor(Math.random() * nodes.length)];
		const motion = matchMedia("(prefers-reduced-motion: reduce)");
		let animation: Animation | undefined;
		let current = pick([...neighbours.keys()]), previous = -1;
		const stop = () => {
			if (!animation) return;
			animation.onfinish = null;
			animation.cancel();
			animation = undefined;
		};
		const travel = () => {
			const adjacent = neighbours.get(current)!;
			const forward = adjacent.filter((n) => n !== previous);
			const next = pick(forward.length ? forward : adjacent);
			const [a, b] = [drawing.nodes[current], drawing.nodes[next]];
			const from = `translate(${a[0]}px, ${a[1]}px)`, to = `translate(${b[0]}px, ${b[1]}px)`;
			stop();
			el.style.transform = from;
			// Fourteen grid units per second: about 0.7 s for a typical inner link, at every display size.
			animation = el.animate([{ transform: from }, { transform: to }], {
				duration: Math.hypot(b[0] - a[0], b[1] - a[1]) / 14 * 1000, easing: "linear", fill: "forwards",
			});
			animation.onfinish = () => { previous = current; current = next; travel(); };
			if (document.hidden) animation.pause();
		};
		const sync = () => {
			if (motion.matches) {
				stop();
				el.style.removeProperty("transform");
			} else {
				if (!animation) travel();
				if (document.hidden) animation?.pause();
				else animation?.play();
			}
		};
		motion.addEventListener("change", sync);
		document.addEventListener("visibilitychange", sync);
		sync();
		return () => {
			motion.removeEventListener("change", sync);
			document.removeEventListener("visibilitychange", sync);
			stop();
			el.style.removeProperty("transform");
		};
	});

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

<svg class="folio" data-state={avatarState} data-optic={optic} viewBox="0 0 {o.vb} {o.vb}" width={size} height={size} focusable="false" aria-hidden="true" style={vars}>
	<g class="links ink">
		{#each ink as l, i (i)}{#if avatarState !== "error" || !broken(l)}<polyline points={points(l)} />{/if}{/each}
		{#if avatarState === "error"}<polyline points="{brk.a.join(",")} {brk.s1.join(",")}" /><polyline points="{brk.s2.join(",")} {brk.b.join(",")}" />{/if}
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
	{#if avatarState === "pending"}
		<g class="signal-motion" bind:this={signal} transform="translate({brk.m.join(' ')})">
			<circle class="halo" cx="0" cy="0" r={o.r * 2} />
			<circle class="signal" cx="0" cy="0" r={o.r * 0.75} />
		</g>
	{/if}
	{#if avatarState === "error"}<circle class="break" cx={brk.m[0]} cy={brk.m[1]} r={o.rb} />{/if}
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
	/* owner: the travelling signal is not green (it would read as a prefrontal node): an ochre of its own, `--signal` */
	.signal-motion {
		fill: var(--signal, currentColor);
	}
	.halo {
		opacity: 0.12;
		filter: blur(0.65px);
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
		[data-state="answer"] .nf {
			animation: settle 0.5s steps(2, end) both;
		}
	}
	@keyframes settle {
		from { transform: scale(1); }
	}
</style>
