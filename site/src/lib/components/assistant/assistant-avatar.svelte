<script module lang="ts">
	export type FolioState = "idle" | "pending" | "answer" | "error";

	// One drawing, three optical sizes. Coordinates are chosen so that every stroke edge lands on a whole pixel at the size the
	// variant is made for: full 48 and 96 px (also 72), compact 24 px, tiny 16 px. Other sizes render, with softer edges.
	// back: the rear sheet and the margin rule, as one mitered path; front: x, y, side of the front sheet; rows: centre of each
	// index line; x0, x1: extent of a line; short: end of a line still being written; cs: side of the square cursor;
	// rule: height of the conclusion rule (none when it does not fit); bx: centre of the break mark.
	type Optic = { vb: number; sw: number; back: string; front: number[]; rows: number[]; x0: number; x1: number; short: number; cs: number; rule?: number; bx: number; br: number };
	export const OPTICS: Record<"full" | "compact" | "tiny", Optic> = {
		full: { vb: 48, sw: 2, back: "M11 45V3H45V39H39", front: [3, 9, 36], rows: [17, 25, 33], x0: 16, x1: 34, short: 26, cs: 6, rule: 39, bx: 30, br: 4 },
		compact: { vb: 48, sw: 2, back: "M11 45V3H45V39H39", front: [3, 9, 36], rows: [19, 29], x0: 16, x1: 34, short: 26, cs: 6, rule: 37, bx: 30, br: 4 },
		tiny: { vb: 16, sw: 1, back: "M4.5 4.5V1.5H14.5V11.5H11.5", front: [1.5, 4.5, 10], rows: [7.5, 11.5], x0: 4, x1: 9, short: 7, cs: 3, bx: 7.5, br: 2 },
	};
</script>

<script lang="ts">
	// The assistant's avatar: the indexed folio (master drawing: design/brand/folio.svg). Two offset sheets, a margin rule,
	// index lines and a square cursor. Square language: butt ends, mitered joins, no curve. Decorative: the state is told by
	// the panel's text. Colours come from the tokens (currentColor, --primary, --destructive). Below 40 px an optical variant
	// keeps two index lines, so the strokes do not merge.
	//
	//   idle      still; cursor on the first index mark
	//   pending   cursor steps down the marks and back, orthogonally, only while pending; the last line is still being written
	//   answer    cursor on the last mark; a conclusion rule is drawn once, then still
	//   error     the index breaks off at an angular mark (a tilted square); no cursor
	//
	// Reduced motion: no state moves; each is a distinct still composition (pending: cursor on the middle mark).
	let { state = "idle", size = 24 }: { state?: FolioState; size?: number } = $props();

	const optic = $derived(size < 20 ? "tiny" : size < 40 ? "compact" : "full");
	const o = $derived(OPTICS[optic]);
	const pitch = $derived(o.rows[1] - o.rows[0]);
	// still position of the cursor, as an index mark (pending in the middle, or on the last one when there are two)
	const at = $derived(state === "answer" ? o.rows.length - 1 : state === "pending" ? Math.max(1, o.rows.length - 2) : 0);
	const end = (i: number) => (state === "pending" && i === o.rows.length - 1 ? o.short : o.x1);
	const brk = $derived(o.rows[1]);
</script>

<svg class="folio" data-state={state} data-optic={optic} viewBox="0 0 {o.vb} {o.vb}" width={size} height={size} focusable="false" aria-hidden="true" style="--pitch: {pitch}; --at: {at}; --sw: {o.sw}">
	<g class="sheets">
		<path d={o.back} />
		<rect x={o.front[0]} y={o.front[1]} width={o.front[2]} height={o.front[2]} />
	</g>
	<g class="lines">
		{#each o.rows as c, i (c)}
			{#if state !== "error" || i < 2}<path d="M{o.x0} {c}H{state === "error" && i === 1 ? o.x0 + o.cs : end(i)}" />{/if}
		{/each}
	</g>
	{#if state === "answer" && o.rule}<path class="rule" pathLength="1" d="M{o.x0} {o.rule}H{o.x1}" />{/if}
	{#if state === "error"}
		<path class="break" d="M{o.bx} {brk - o.br}L{o.bx + o.br} {brk}L{o.bx} {brk + o.br}L{o.bx - o.br} {brk}Z" />
	{:else}
		<rect class="cursor" x={o.x0} y={o.rows[0] - o.cs / 2} width={o.cs} height={o.cs} />
	{/if}
</svg>

<style>
	.folio {
		display: block;
		flex: none;
	}
	.sheets, .lines, .rule {
		fill: none;
		stroke-width: var(--sw);
		stroke-linecap: butt;
		stroke-linejoin: miter;
	}
	.sheets, .lines {
		stroke: currentColor;
	}
	.rule {
		stroke: var(--primary, currentColor);
	}
	.break {
		fill: var(--destructive, currentColor);
	}
	.cursor {
		fill: var(--primary, currentColor);
		transform: translateY(calc(var(--pitch) * var(--at) * 1px));
	}

	@media (prefers-reduced-motion: no-preference) {
		[data-state="pending"] .cursor {
			animation: walk 3.2s step-end infinite;
		}
		[data-optic="compact"][data-state="pending"] .cursor,
		[data-optic="tiny"][data-state="pending"] .cursor {
			animation-name: walk-two;
		}
		.rule {
			stroke-dasharray: 1;
			animation: write 0.45s steps(6, end) both;
		}
	}
	/* the cursor goes down the marks and back; each move is a whole step, held until the next */
	@keyframes walk {
		0% { transform: translateY(0); }
		25% { transform: translateY(calc(var(--pitch) * 1px)); }
		50% { transform: translateY(calc(var(--pitch) * 2px)); }
		75% { transform: translateY(calc(var(--pitch) * 1px)); }
	}
	@keyframes walk-two {
		0% { transform: translateY(0); }
		50% { transform: translateY(calc(var(--pitch) * 1px)); }
	}
	@keyframes write {
		from { stroke-dashoffset: 1; }
		to { stroke-dashoffset: 0; }
	}
</style>
