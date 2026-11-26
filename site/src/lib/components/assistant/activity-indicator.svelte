<script lang="ts">
	// A looping activity glyph: three small squares, one lit at a time, the light stepping from left to right. Pure CSS, no timer;
	// inline-sized (default 18 px) so it sits beside a line of text. Decorative: the panel's status text says what is going on.
	// Under prefers-reduced-motion: reduce it stays still, the three squares equally dim.
	let { size = 18 }: { size?: number } = $props();
</script>

<span class="activity" aria-hidden="true" style="--size:{size}px"><i></i><i></i><i></i></span>

<style>
	/* three squares of a quarter of the box, a gap of an eighth: 3/4 + 2/8 = the whole width */
	.activity {
		display: inline-flex;
		align-items: center;
		justify-content: space-between;
		width: var(--size);
		height: var(--size);
		vertical-align: middle;
		flex-shrink: 0;
	}
	.activity i {
		display: block;
		width: calc(var(--size) / 4);
		height: calc(var(--size) / 4);
		background: var(--primary);
		opacity: 0.35;
	}
	@media (prefers-reduced-motion: no-preference) {
		.activity i {
			animation: step 1.2s steps(1, end) infinite;
		}
		.activity i:nth-child(2) {
			animation-delay: 0.4s;
		}
		.activity i:nth-child(3) {
			animation-delay: 0.8s;
		}
	}
	/* lit for the first third of the cycle, dim for the rest; the delays pass the light on */
	@keyframes step {
		0% {
			opacity: 1;
		}
		33.4% {
			opacity: 0.35;
		}
	}
</style>
