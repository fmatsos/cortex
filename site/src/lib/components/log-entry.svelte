<script lang="ts">
	import { untrack } from "svelte";
	import Icon from "#lib/components/icon.svelte";
	import KindBadge from "#lib/components/kind-badge.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { dayLabel, hourOf, type LogEntry } from "#lib/log-view.js";
	import { toPage, toRoute } from "#lib/links.js";
	import { kindColor, kindLabel, typeColor, typeIcon } from "#lib/type-meta.js";

	// A log entry: type, time, direct link, text (summary of a few lines then expandable detail if the text
	// is long), references always visible. Without JavaScript, the text stays whole: the summary is only applied once mounted.
	let { entry, target = false }: { entry: LogEntry; target?: boolean } = $props();
	const hour = $derived(hourOf(entry.at));
	const textId = $derived(`${entry.id}-texte`);

	let box = $state<HTMLElement>();
	let mounted = $state(false);
	let open = $state(false);
	let overflow = $state(false); // the text exceeds the summary: the button only appears in that case

	$effect(() => {
		const el = box;
		if (!el) return;
		mounted = true;
		// measure only when collapsed: expanded, the whole text no longer "overflows" anything
		const measure = () => {
			if (!untrack(() => open)) overflow = el.scrollHeight > el.clientHeight + 1;
		};
		const t = setTimeout(measure);
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => {
			clearTimeout(t);
			ro.disconnect();
		};
	});
</script>

<li id={entry.id} tabindex="-1" class="entry relative scroll-mt-24"
	class:target>
	<span class="bg-background absolute top-2 -left-[1.9rem] flex size-3 items-center justify-center rounded-full" aria-hidden="true">
		<span class="size-2.5 rounded-full" style:background={kindColor(entry.kind)}></span>
	</span>
	<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
		<KindBadge kind={entry.kind} />
		{#if hour}<time datetime={entry.at} class="text-muted-foreground text-sm tabular-nums">{hour}</time>{/if}
		<a href="{toRoute('/log')}#{entry.id}" class="permalink touch-target text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex size-6 items-center justify-center rounded-md focus-visible:ring-3" aria-label="Lien direct vers cette entrée : {kindLabel(entry.kind)} du {dayLabel(entry.at.slice(0, 10))}{hour ? ` à ${hour}` : ''}">
			<Icon name="copy-link" size={16} />
		</a>
	</div>
	<!-- focus on a link hidden by the summary expands the entry -->
	<div
		id={textId}
		bind:this={box}
		class="wiki mt-1.5 text-[0.95rem] {mounted && !open ? 'clamped' : ''}"
		onfocusin={() => { if (overflow) open = true; }}
	><span class="sr-only">{kindLabel(entry.kind)} : </span>{@html entry.html}</div>
	{#if overflow}
		<Button variant="ghost" size="sm" class="-ml-2.5 mt-0.5" aria-expanded={open} aria-controls={textId} onclick={() => (open = !open)}>
			{open ? "Réduire" : "Lire la suite"}
			<Icon name="chevron-down" size={16} class="motion-safe:transition-transform {open ? 'rotate-180' : ''}" />
		</Button>
	{/if}
	{#if entry.pages.length || entry.sources.length}
		<ul class="touch-gap mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Références de l'entrée">
			{#each entry.pages as p (p.id)}
				<li class="flex items-center gap-1.5">
					<Icon name={typeIcon(p.type)} size={16} style="color: {typeColor(p.type)}" />
					<a href={toPage(p.id)} class="text-link underline-offset-4 hover:underline">{p.title}</a>
				</li>
			{/each}
			{#each entry.sources as s (s.id)}
				<li class="flex items-center gap-1.5">
					<Icon name="source" size={16} class="text-muted-foreground" />
					<span class="text-muted-foreground">Source</span>
					{#if s.page}
						<a href={toPage(s.page.id)} class="text-link underline-offset-4 hover:underline">{s.page.title}</a>
					{:else}
						<code class="bg-muted rounded px-1.5 py-0.5 text-sm [overflow-wrap:anywhere]">{s.id}</code>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</li>

<style>
	.clamped {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		overflow: hidden;
	}
	.entry:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 4px;
		border-radius: var(--radius);
	}
	.entry.target {
		background: color-mix(in oklch, var(--muted) 70%, transparent);
		border-radius: var(--radius);
		box-shadow: -0.5rem 0 0 0.25rem color-mix(in oklch, var(--muted) 70%, transparent), 0.5rem 0 0 0.25rem color-mix(in oklch, var(--muted) 70%, transparent);
	}
</style>
