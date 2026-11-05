<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import { fold } from "#lib/fold.js";
	import type { IconName } from "#lib/icons.js";
	import { activeValues, parseQuery, clearOps, toggleFacet, type Op } from "#lib/query.js";
	import type { Facets } from "#lib/search-client.js";
	import { search } from "#lib/search-state.svelte.js";
	import { STATUS_META, TYPES, typeColor } from "#lib/type-meta.js";
	import { t as tr } from "#lib/i18n/index.js";

	/**
	 * Manipulable facets: type, status, state (favorites, review, partial source) and tags, with their page count in the
	 * query context. They read and write the same input as the field (`search.q`): a click adds or removes the matching text
	 * operator (`type:concept`, `#llm`…), and an operator typed by hand lights up the facet.
	 * Type and status are single-choice (two values ANDed would never match anything); the others add up.
	 */
	let { facets, class: className = "" }: { facets: Facets; class?: string } = $props();

	const p = $derived(parseQuery(search.q));
	// compared values folded ("Mémoire" and #memoire are the same tag); the type keeps its canonical form ("Concept")
	const on = (key: Op["key"], v: string) => activeValues(p, key).has(key === "type" ? v : fold(v));
	const toggle = (key: Op["key"], v: string) => { search.q = toggleFacet(search.q, key, v); };
	const anyOps = $derived(p.ops.length > 0);

	let allTags = $state(false);
	const TAGS_SHOWN = 10;
	const tags = $derived(allTags ? facets.tags : facets.tags.slice(0, TAGS_SHOWN));

	type Row = { key: Op["key"]; value: string; label: string; count: number; icon: IconName; color?: string };
	const typeRows = $derived<Row[]>(TYPES.map((t) => ({ key: "type", value: t.type, label: t.plural, count: facets.type[t.type] ?? 0, icon: t.icon, color: typeColor(t.type) })));
	const statusRows = $derived<Row[]>(Object.entries(STATUS_META).map(([s, m]) => ({ key: "status", value: s, label: m.label, count: facets.status[s] ?? 0, icon: m.icon })));
	const flagRows = $derived<Row[]>([
		{ key: "is", value: "fav", label: tr("favs.title"), count: facets.flags.fav, icon: "star" },
		{ key: "is", value: "unverified", label: tr("facets.unverified"), count: facets.flags.unverified, icon: "unverified" },
		{ key: "is", value: "review", label: tr("facets.review"), count: facets.flags.review, icon: "needs-review" },
		{ key: "is", value: "partial", label: tr("facets.partial"), count: facets.flags.partial, icon: "warning" },
	]);
</script>

{#snippet rows(list: Row[])}
	<ul>
		{#each list as r (r.value)}
			{@const pressed = on(r.key, r.value)}
			<li>
				<button
					type="button"
					aria-pressed={pressed}
					disabled={r.count === 0 && !pressed}
					onclick={() => toggle(r.key, r.value)}
					class="hover:bg-muted aria-pressed:bg-accent aria-pressed:text-accent-foreground focus-visible:ring-ring/50 flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11"
				>
					<Icon name={r.icon} size={16} style={r.color ? `color: ${r.color}` : undefined} />
					<span class="min-w-0 flex-1 truncate">{r.label}</span>
					{#if pressed}<Icon name="success" size={16} />{/if}
					<span class="text-muted-foreground tabular-nums">{r.count}</span>
				</button>
			</li>
		{/each}
	</ul>
{/snippet}

<div class="space-y-5 {className}">
	<section aria-labelledby="fc-type">
		<h2 id="fc-type" class="text-muted-foreground mb-1 px-2 text-sm font-semibold">{tr("facets.type")}</h2>
		{@render rows(typeRows)}
	</section>
	<section aria-labelledby="fc-status">
		<h2 id="fc-status" class="text-muted-foreground mb-1 px-2 text-sm font-semibold">{tr("facets.status")}</h2>
		{@render rows(statusRows)}
	</section>
	<section aria-labelledby="fc-state">
		<h2 id="fc-state" class="text-muted-foreground mb-1 px-2 text-sm font-semibold">{tr("facets.state")}</h2>
		{@render rows(flagRows)}
	</section>
	{#if facets.tags.length}
		<section aria-labelledby="fc-tags">
			<h2 id="fc-tags" class="text-muted-foreground mb-1 px-2 text-sm font-semibold">{tr("nav.tags")}</h2>
			{@render rows(tags.map((t) => ({ key: "tag", value: t.tag, label: `#${t.tag}`, count: t.count, icon: "tags" })))}
			{#if facets.tags.length > TAGS_SHOWN}
				<button type="button" class="text-link hover:bg-muted mt-1 inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm underline underline-offset-4 pointer-coarse:min-h-11" aria-expanded={allTags} onclick={() => (allTags = !allTags)}>
					{allTags ? tr("facets.fewerTags") : tr("facets.allTags", { count: facets.tags.length })}
				</button>
			{/if}
		</section>
	{/if}
	{#if anyOps}
		<button type="button" class="hover:bg-muted focus-visible:ring-ring/50 inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm focus-visible:ring-3 pointer-coarse:min-h-11" onclick={() => (search.q = clearOps(search.q))}>
			<Icon name="clear" size={16} />{tr("graph.resetFilters")}
		</button>
	{/if}
</div>
