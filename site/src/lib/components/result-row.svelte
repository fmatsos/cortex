<script lang="ts">
	import { features } from "#lib/features.js";
	import { Badge } from "#lib/components/ui/badge/index.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import Icon from "#lib/components/icon.svelte";
	import StatusBadge from "#lib/components/status-badge.svelte";
	import TrustIcon from "#lib/components/trust-icon.svelte";
	import TypeBadge from "#lib/components/type-badge.svelte";
	import { favs } from "#lib/favs.svelte.js";
	import { typeColor, typeIcon, typeLabel } from "#lib/type-meta.js";
	import { contentLang, t as tr } from "#lib/i18n/index.js";

	/**
	 * Page line shared by the palette, the results, the tag lists and the home page: type, title, trust information
	 * (status, review, partial source), description and found passage. `verified` and `needsReview` are optional: a list
	 * that does not know them shows nothing rather than false information.
	 * `compact`: palette form (one line, truncated excerpts, no link or button: the option carries the action).
	 * `note`: a discreet label on how the page was found ("by meaning"), only when it helps; never a raw score.
	 * `titleHtml`, `descriptionHtml`, `snippetHtml`: HTML already escaped by the engine (<mark> highlighting). They are the only
	 * values rendered as HTML: the page's own `description` and `title` (front matter, written by anyone) are always plain text.
	 * Long descriptions and excerpts are clamped; a button shows the whole text when the clamp hides some of it.
	 */
	type RowDoc = { id: string; type: string; title: string; description?: string; status?: string; verified?: boolean; needsReview?: boolean; partial?: boolean };
	let {
		doc, href, titleHtml, descriptionHtml, snippetHtml, compact = false, selected = false, showFav = false, showType = true, note, onopen,
	}: {
		doc: RowDoc; href?: string; titleHtml?: string; descriptionHtml?: string; snippetHtml?: string;
		compact?: boolean; selected?: boolean; showFav?: boolean; showType?: boolean; note?: string; onopen?: () => void;
	} = $props();
	const fav = $derived(favs.has(doc.id));
	const showStatus = $derived(!!doc.status && doc.status !== "stable");
	const hasDesc = $derived(descriptionHtml !== undefined ? descriptionHtml !== "" : !!doc.description);

	let descEl = $state<HTMLElement | null>(null);
	let snipEl = $state<HTMLElement | null>(null);
	let expanded = $state(false);
	let clamped = $state(false); // the clamp hides some text (measured; stays true once expanded so that the button can fold it back)
	$effect(() => {
		void [descriptionHtml, doc.description, snippetHtml, compact];
		const els = [descEl, snipEl].filter((e): e is HTMLElement => !!e);
		if (compact || !els.length) return;
		const measure = () => { if (!expanded) clamped = els.some((e) => e.scrollHeight > e.clientHeight + 1); };
		measure();
		const ro = new ResizeObserver(measure);
		for (const e of els) ro.observe(e);
		return () => ro.disconnect();
	});
</script>

{#snippet description()}
	{#if descriptionHtml !== undefined}{@html descriptionHtml}{:else}{doc.description}{/if}
{/snippet}

{#snippet title()}
	{#if titleHtml !== undefined}{@html titleHtml}{:else}{doc.title}{/if}
{/snippet}

{#snippet trust()}
	{#if showStatus}<StatusBadge status={doc.status!} />{/if}
	{#if features.review && doc.needsReview}
		<TrustIcon icon="needs-review" label={tr("row.review")} />
	{:else if features.review && doc.verified === false}
		<TrustIcon icon="unverified" label={tr("page.neverReviewed")} />
	{/if}
	{#if doc.partial}<TrustIcon icon="warning" label={tr("row.partialSource")} />{/if}
{/snippet}

{#if compact}
	<div class="flex items-baseline justify-between gap-3">
		<span class="flex min-w-0 items-baseline gap-2 {selected ? 'line-clamp-2' : 'truncate'}">
			<Icon name={typeIcon(doc.type)} size={16} class="relative top-0.5 self-start" style="color: {typeColor(doc.type)}" />
			<span lang={contentLang} class="min-w-0 {selected ? '' : 'truncate'}">{@render title()}</span>
		</span>
		<span class="text-muted-foreground flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-sm">
			<span class="sr-only">{typeLabel(doc.type)} :</span>
			{#if showStatus}<StatusBadge status={doc.status!} />{/if}
			{#if doc.needsReview}<TrustIcon icon="needs-review" label={tr("row.review")} />{/if}
			{#if doc.partial}<TrustIcon icon="warning" label={tr("row.partial")} />{/if}
			{#if note}<Badge variant="stable" size="sm" data-match>{note}</Badge>{/if}
		</span>
	</div>
	{#if snippetHtml || hasDesc}<p lang={contentLang} class="text-muted-foreground mt-0.5 text-sm {selected ? 'line-clamp-3' : 'line-clamp-1'}">{#if snippetHtml}{@html snippetHtml}{:else}{@render description()}{/if}</p>{/if}
{:else}
	<div class="flex items-start gap-2">
		<div class="min-w-0 max-w-[80ch] flex-1">
			<div class="text-base">
				{#if href}<a {href} lang={contentLang} data-row-action="open" class="text-link link-content font-medium underline-offset-4 hover:underline" onclick={onopen}>{@render title()}</a>{:else}<span lang={contentLang} class="font-medium">{@render title()}</span>{/if}
			</div>
			<!-- showType=false in a list already grouped by type (home columns); line hidden if empty -->
			<div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 empty:hidden">
				{#if showType}<TypeBadge type={doc.type} />{/if}
				{@render trust()}
				{#if note}<Badge variant="stable" size="sm" data-match>{note}</Badge>{/if}
			</div>
			{#if hasDesc}<p bind:this={descEl} data-row-description lang={contentLang} class="text-muted-foreground mt-1.5 text-[0.9375rem] leading-relaxed {expanded ? '' : 'line-clamp-2'}">{@render description()}</p>{/if}
			<!-- the found passage is set apart from the description: a rule on the left, never the same grey text -->
			{#if snippetHtml}<p bind:this={snipEl} data-row-snippet lang={contentLang} class="border-border mt-1.5 border-l-2 pl-3 text-[0.9375rem] leading-relaxed {expanded ? '' : 'line-clamp-3'}">{@html snippetHtml}</p>{/if}
			{#if clamped}
				<button type="button" aria-expanded={expanded} class="text-link focus-visible:ring-ring/50 mt-1 inline-flex min-h-6 items-center text-sm underline underline-offset-4 focus-visible:ring-3 pointer-coarse:min-h-11" onclick={() => (expanded = !expanded)}>
					{expanded ? tr("row.less") : tr("row.more")}<span class="sr-only"> : <span lang={contentLang}>{doc.title}</span></span>
				</button>
			{/if}
		</div>
		{#if showFav}
			<Button variant="ghost" size="icon" data-row-action="fav" aria-pressed={fav} aria-label={tr("fav.toggleLabel", { title: doc.title })} title={tr("fav.title")} onclick={() => favs.toggle(doc.id)}>
				<Icon name="star" size={20} filled={fav} class={fav ? "text-favorite" : "text-muted-foreground"} />
			</Button>
		{/if}
	</div>
{/if}
