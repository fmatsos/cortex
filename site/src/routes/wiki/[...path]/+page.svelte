<script lang="ts">
	import { afterNavigate } from "$app/navigation";
	import { Badge } from "#lib/components/ui/badge/index.js";
	import Breadcrumb from "#lib/components/breadcrumb.svelte";
	import CitationPreview from "#lib/components/citation-preview.svelte";
	import Icon from "#lib/components/icon.svelte";
	import PageActions from "#lib/components/page-actions.svelte";
	import ReadingHits from "#lib/components/reading-hits.svelte";
	import RelatedPages from "#lib/components/related-pages.svelte";
	import StatusBadge from "#lib/components/status-badge.svelte";
	import TrustIcon from "#lib/components/trust-icon.svelte";
	import Toc from "#lib/components/toc.svelte";
	import TocSheet from "#lib/components/toc-sheet.svelte";
	import TypeBadge from "#lib/components/type-badge.svelte";
	import { NOTES_ID, SOURCES_ID, actor, currentSection, domainOf, originalSource, relatedEntries, showToc, tocItems } from "#lib/article.js";
	import { toPage, toTag } from "#lib/links.js";
	import { t } from "#lib/i18n/index.js";

	let { data } = $props();
	const p = $derived(data.page);
	const day = (iso?: string) => iso?.slice(0, 10);
	const srcOf = $derived(new Map(p.sources.map((s) => [s.id, s])));
	const original = $derived(p.type === "Source" ? originalSource(p.sources) : undefined);
	const stale = $derived(!!p.stale_after && Date.parse(p.stale_after) < Date.now());
	const related = $derived(relatedEntries(p.backlinks, p.related, data.shared));
	// reviewed from this page (cortex serve): shown at once, the rebuilt site carries it afterwards
	let reviewedHere = $state<Record<string, { by: string; at: string }>>({});
	const verified = $derived(reviewedHere[p.id] ?? p.verified);
	const needsReview = $derived(!reviewedHere[p.id] && p.needsReview);

	// Return from a note: to the call actually followed (remembered on click, per page and per note), otherwise the first;
	// a note cited several times additionally has one return per occurrence (a b c).
	let followed = $state<Record<string, string>>({});
	const backTo = (id: string) => followed[`${p.id}|${id}`] ?? `fnref-${id}-1`;
	const letter = (i: number) => (i < 26 ? String.fromCharCode(97 + i) : String(i + 1));

	// Footnote call: a click (or Enter) opens the citation preview in place; without the popover API, or with a modifier
	// key, the link follows its course to the note at the bottom of the page. Capture phase: the default is canceled before
	// the router takes the click. Delegation: only footnote-call links count.
	let preview = $state.raw<ReturnType<typeof CitationPreview>>();
	const onBody = (e: MouseEvent) => {
		const a = (e.target as Element).closest?.(".fn-ref a") as HTMLElement | null;
		const m = a?.id.match(/^fnref-(.+)-\d+$/);
		if (!a || !m) return;
		followed[`${p.id}|${m[1]}`] = a.id;
		const note = p.notes.find((n) => n.id === m[1]);
		if (note && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) && preview?.show(a, note, srcOf.get(note.id))) e.preventDefault();
	};

	// Table of contents: body headings, Notes and Sources; current section = last heading that passed below the header
	const items = $derived(tocItems(p.toc, p.notes.length, p.sources.length));
	const toc = $derived(showToc(items, p.html.length));
	let current = $state("");
	$effect(() => {
		if (!toc) return;
		const hs = items.map((it) => document.getElementById(it.id)).filter((h) => h != null);
		let raf = 0;
		const on = () => {
			raf = 0;
			const atEnd = innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
			current = currentSection(hs.map((h) => ({ id: h.id, top: h.getBoundingClientRect().top })), innerHeight * 0.25, atEnd);
		};
		const tick = () => { raf ||= requestAnimationFrame(on); };
		on();
		addEventListener("scroll", tick, { passive: true });
		return () => { removeEventListener("scroll", tick); cancelAnimationFrame(raf); };
	});

	// Search context: `?q=` is only readable in the browser (prerendered pages); we also know whether we come from the results
	let q = $state(""), fromSearch = $state(false);
	let body = $state<HTMLElement>();
	afterNavigate((nav) => {
		q = nav.to?.url.searchParams.get("q") ?? "";
		fromSearch = nav.type !== "enter" && !!nav.from?.url.pathname.replace(/\/$/, "").endsWith("/search");
	});
</script>

<svelte:head>
	<title>{p.title} · Cortex</title>
	<meta name="description" content={p.description} />
</svelte:head>

<!-- reading column ~72 characters; tables and code blocks scroll horizontally in it -->
<div class="grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem] {toc ? 'pb-16' : ''}">
	<article class="min-w-0">
		<Breadcrumb type={p.type} title={p.title} />
		<header class="mb-6">
			<!-- trust: the stable status stays discreet, what calls for caution is prominent (text and icon together) -->
			<div class="flex flex-wrap items-center gap-2">
				<TypeBadge type={p.type} />
				<StatusBadge status={reviewedHere[p.id] ? "stable" : p.status} />
				{#if p.partial}
					<TrustIcon icon="warning" label={p.type === "Source" ? t("page.partialSource") : t("page.partialContent")} />
				{/if}
				{#if !verified}
					<TrustIcon icon="unverified" label={t("page.neverReviewed")} />
				{:else if needsReview}
					<TrustIcon icon="needs-review" label={t("page.needsReview")} />
				{:else}
					<TrustIcon icon="verified" label={`${t("page.reviewedOn")} ${day(verified.at)} — ${t("page.reviewedBy", { by: verified.by })}`} />
				{/if}
				{#if stale}<TrustIcon icon="stale" label={`${t("page.staleSince")} ${day(p.stale_after)}`} />{/if}
			</div>
			<h1 class="mt-3 text-3xl font-semibold tracking-tight">{p.title}</h1>
			<p class="text-muted-foreground mt-2">{p.description}</p>
			<div class="mt-3"><PageActions id={p.id} md={p.md} original={original && { url: original.url, domain: original.domain }} reviewable={!verified || needsReview} onreviewed={(r) => (reviewedHere[p.id] = r)} /></div>
			{#if p.tags.length}
				<ul class="mt-3 flex flex-wrap gap-1.5" aria-label={t("nav.tags")}>
					{#each p.tags as tag}<li><Badge href={toTag(data.slugs[tag])} variant="secondary">#{tag}</Badge></li>{/each}
				</ul>
			{/if}
		</header>

		<ReadingHits container={body} {q} pageId={p.id} {fromSearch} />

		<!-- delegation: only footnote-call links trigger `onBody` (Enter on a link also produces a click) -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="wiki" bind:this={body} onclickcapture={onBody}>{@html p.html}</div>

		{#if p.notes.length}
			<section class="mt-10 border-t pt-6" aria-labelledby={NOTES_ID}>
				<h2 id={NOTES_ID} class="flex scroll-mt-(--anchor-offset) items-center gap-2 text-lg font-semibold"><Icon name="citation" size={20} />{t("page.notes")}</h2>
				<ol class="mt-3 list-decimal space-y-2 pl-6 text-sm">
					{#each p.notes as n (n.id)}
						{@const s = srcOf.get(n.id)}
						<li id="fn-{n.id}" class="note-item">
							{#if s}<a href="#src-{s.id}" class="text-link underline underline-offset-3">{s.title}</a>{:else}<span class="text-muted-foreground">{t("page.noteWithoutSource", { id: n.id })}</span>{/if}
							{#if n.html}<span class="text-muted-foreground"> — </span>{@html n.html}{/if}
							<a href="#{backTo(n.id)}" aria-label={t("page.backToText")} class="text-link touch-target ml-1 inline-flex items-center px-1 align-middle no-underline"><Icon name="citation-return" size={16} /></a>
							{#if n.refs > 1}
								<span class="text-muted-foreground"><span class="sr-only">{t("page.occurrences")}</span>
									{#each { length: n.refs } as _, i}
										<a href="#fnref-{n.id}-{i + 1}" aria-label={t("page.backToOccurrence", { n: i + 1, total: n.refs })} class="text-link inline-block px-1 py-0.5 pointer-coarse:px-2 pointer-coarse:py-2 no-underline hover:underline">{letter(i)}</a>
									{/each}
								</span>
							{/if}
						</li>
					{/each}
				</ol>
			</section>
		{/if}

		{#if p.sources.length}
			<section class="mt-8 border-t pt-6" aria-labelledby={SOURCES_ID}>
				<h2 id={SOURCES_ID} class="flex scroll-mt-(--anchor-offset) items-center gap-2 text-lg font-semibold"><Icon name="source" size={20} />{t("page.sources")}</h2>
				<ul class="mt-3 space-y-2 text-sm">
					{#each p.sources as s (s.id)}
						<li id="src-{s.id}" class="anchor-target">
							{#if s.url}
								<a href={s.url} rel="noopener noreferrer" class="text-link inline-flex items-center gap-1 font-medium underline underline-offset-3">{s.title}<Icon name="external-link" size={16} /><span class="sr-only"> — {t("common.externalLink")}</span></a>
								{#if domainOf(s.url)}<span class="text-muted-foreground"> ({domainOf(s.url)})</span>{/if}
							{:else}<span class="font-medium">{s.title}</span>{/if}
							{#if s.partial}<Badge variant="caution" class="ml-1 align-middle"><Icon name="warning" size={16} />{t("page.partialExtraction")}</Badge>{/if}
							{#if s.page}<span class="text-muted-foreground"> · {t("page.page")} <a href={toPage(s.page.id)} class="text-link underline underline-offset-3">{s.page.title}</a></span>{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</article>

	<aside class="space-y-8 self-start text-sm" aria-label={t("page.aside")}>
		{#if toc}
			<nav aria-labelledby="h-toc" class="hidden lg:block">
				<h2 id="h-toc" class="mb-2 flex items-center gap-2 font-semibold"><Icon name="toc" size={20} />{t("page.toc")}</h2>
				<Toc {items} {current} />
			</nav>
		{/if}
		<RelatedPages backlinks={p.backlinks} {related} />
		<section aria-labelledby="h-prov" class="bg-muted/50 rounded-lg border p-3">
			<h2 id="h-prov" class="mb-2 flex items-center gap-2 font-semibold"><Icon name="generated" size={20} class="text-muted-foreground" />{t("page.provenance")}</h2>
			<dl class="space-y-2">
				{#if p.generated}
					<div class="flex items-start gap-2">
						<div><dt class="text-muted-foreground text-xs">{t("page.writtenBy")}</dt><dd><span class="font-medium">{actor(p.generated.by)}</span> · <time datetime={p.generated.at}>{day(p.generated.at)}</time></dd></div>
					</div>
				{/if}
				<div class="flex items-start gap-2">
					{#if verified}
						<div><dt class="text-muted-foreground text-xs">{t("page.reviewer")}</dt><dd><span class="font-medium">{actor(verified.by)}</span> · <time datetime={verified.at}>{day(verified.at)}</time></dd></div>
					{:else}
						<div><dt class="sr-only">{t("page.review")}</dt><dd class="text-muted-foreground">{t("page.neverReviewedCap")}</dd></div>
					{/if}
				</div>
			</dl>
		</section>
	</aside>
</div>

{#if toc}<TocSheet {items} {current} />{/if}
<CitationPreview bind:this={preview} />

<style>
	/* tables: the container (`.table-wrap`, added at export) is the scrolling region, keyboard-focusable; the table
	   keeps its formatting (app.css) but no longer scrolls itself. Shadow on the edge that still hides content, headers
	   frozen for tall tables. */
	.wiki :global(.table-wrap) {
		width: fit-content;
		max-width: 100%;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background:
			linear-gradient(to right, var(--card) 30%, transparent) left center / 2rem 100% no-repeat local,
			linear-gradient(to left, var(--card) 30%, transparent) right center / 2rem 100% no-repeat local,
			linear-gradient(to right, color-mix(in oklch, var(--foreground) 22%, transparent), transparent) left center / 0.75rem 100% no-repeat scroll,
			linear-gradient(to left, color-mix(in oklch, var(--foreground) 22%, transparent), transparent) right center / 0.75rem 100% no-repeat scroll var(--card);
	}
	.wiki :global(.table-wrap > table) {
		display: table;
		width: auto;
		max-width: none;
		overflow: visible;
		border: 0;
		border-radius: 0;
		background: none;
	}
	/* words do not break letter by letter (app.css allows it for the body): the table widens and scrolls */
	.wiki :global(.table-wrap th),
	.wiki :global(.table-wrap td) {
		overflow-wrap: normal;
	}
	/* large screen: a tall table scrolls within its frame and keeps its headers; on mobile, only the page scrolls vertically */
	@media (min-width: 640px) {
		.wiki :global(.table-wrap) {
			max-height: min(70vh, 36rem);
		}
		.wiki :global(.table-wrap th) {
			position: sticky;
			top: 0;
			z-index: 1;
		}
	}
	.wiki :global(.table-wrap th) {
		background: var(--muted);
		box-shadow: inset 0 -1px 0 var(--border);
	}
	@media print {
		.wiki :global(.table-wrap) {
			max-height: none;
			overflow: visible;
			background: none;
		}
		.wiki :global(.table-wrap th) {
			position: static;
		}
	}
</style>
