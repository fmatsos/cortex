<script lang="ts">
	import type { TocItem } from "#lib/types.js";

	// Table of contents list (body headings, Notes, Sources): the current section carries aria-current="location".
	let { items, current = "", onnavigate }: { items: TocItem[]; current?: string; onnavigate?: () => void } = $props();
</script>

<ol class="border-l text-sm">
	{#each items as t (t.id)}
		<li>
			<a
				href="#{t.id}"
				onclick={onnavigate}
				aria-current={current === t.id ? "location" : undefined}
				class="text-muted-foreground hover:text-foreground aria-[current=location]:border-foreground aria-[current=location]:text-foreground -ml-px block border-l-2 border-transparent py-1 pointer-coarse:py-2.5 aria-[current=location]:font-medium {t.level === 3 ? 'pl-6' : 'pl-3'}"
			>{t.text}</a>
		</li>
	{/each}
</ol>
