<script lang="ts">
	import { Badge } from "#lib/components/ui/badge/index.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import FavButton from "#lib/components/fav-button.svelte";
	import TypeBadge from "#lib/components/type-badge.svelte";
	import { toPage, toTag } from "#lib/links.js";
	import { STATUS_LABEL } from "#lib/type-meta.js";

	let { data } = $props();
	const p = $derived(data.page);
	let copied = $state(false);
	const copyLink = async () => { try { await navigator.clipboard.writeText(location.href); copied = true; setTimeout(() => (copied = false), 1800); } catch { /* presse-papiers indisponible */ } };
	const day = (iso?: string) => iso?.slice(0, 10);
	const srcOf = $derived(new Map(p.sources.map((s) => [s.id, s])));
</script>

<svelte:head>
	<title>{p.title} · Second cerveau</title>
	<meta name="description" content={p.description} />
</svelte:head>

<div class="grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem]">
	<article class="min-w-0">
		<header class="mb-6">
			<div class="flex flex-wrap items-center gap-2">
				<TypeBadge type={p.type} />
				<Badge variant={p.status === "deprecated" ? "destructive" : p.status === "stable" ? "default" : "secondary"}>{STATUS_LABEL[p.status] ?? p.status}</Badge>
				{#if !p.verified}
					<Badge variant="outline">jamais relue</Badge>
				{:else if p.needsReview}
					<Badge variant="outline">modifiée depuis la relecture · à relire</Badge>
				{:else}
					<Badge variant="outline" title="Relue par {p.verified.by}">relue le {day(p.verified.at)}</Badge>
				{/if}
				{#if p.stale_after && Date.parse(p.stale_after) < Date.now()}<Badge variant="destructive">périmée depuis {day(p.stale_after)}</Badge>{/if}
			</div>
			<h1 class="mt-3 text-3xl font-semibold tracking-tight">{p.title}</h1>
			<p class="text-muted-foreground mt-2">{p.description}</p>
			<div class="mt-3 flex flex-wrap gap-2">
				<FavButton id={p.id} />
				<Button variant="outline" size="sm" onclick={copyLink}>{copied ? "Lien copié" : "Copier le lien"}</Button>
			</div>
			{#if p.tags.length}
				<ul class="mt-3 flex flex-wrap gap-1.5" aria-label="Tags">
					{#each p.tags as t}<li><Badge href={toTag(data.slugs[t])} variant="secondary">#{t}</Badge></li>{/each}
				</ul>
			{/if}
		</header>

		<div class="wiki">{@html p.html}</div>

		{#if p.notes.length}
			<section class="mt-10 border-t pt-6" aria-labelledby="h-notes">
				<h2 id="h-notes" class="text-lg font-semibold">Notes</h2>
				<ol class="mt-3 list-decimal space-y-2 pl-6 text-sm">
					{#each p.notes as n (n.id)}
						{@const s = srcOf.get(n.id)}
						<li id="fn-{n.id}">
							{#if s}<a href="#src-{s.id}" class="text-link underline underline-offset-3">{s.title}</a>{:else}<span class="text-muted-foreground">source sans entrée sources[] ({n.id})</span>{/if}
							{#if n.html}<span class="text-muted-foreground"> — </span>{@html n.html}{/if}
							<a href="#fnref-{n.id}-1" aria-label="Retour au texte" class="text-link ml-1 no-underline">↩</a>
						</li>
					{/each}
				</ol>
			</section>
		{/if}

		{#if p.sources.length}
			<section class="mt-8 border-t pt-6" aria-labelledby="h-sources">
				<h2 id="h-sources" class="text-lg font-semibold">Sources</h2>
				<ul class="mt-3 space-y-2 text-sm">
					{#each p.sources as s (s.id)}
						<li id="src-{s.id}" class="scroll-mt-20">
							{#if s.url}<a href={s.url} rel="noopener noreferrer" class="text-link font-medium underline underline-offset-3">{s.title}</a>{:else}<span class="font-medium">{s.title}</span>{/if}
							{#if s.page}<span class="text-muted-foreground"> · page <a href={toPage(s.page.id)} class="text-link underline underline-offset-3">{s.page.title}</a></span>{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</article>

	<aside class="space-y-8 text-sm" aria-label="Liens">
		{#if p.backlinks.length}
			<section aria-labelledby="h-back">
				<h2 id="h-back" class="mb-2 font-semibold">Rétroliens ({p.backlinks.length})</h2>
				<ul class="space-y-1.5">
					{#each p.backlinks as l (l.id)}<li><a href={toPage(l.id)} class="text-link underline underline-offset-3">{l.title}</a></li>{/each}
				</ul>
			</section>
		{/if}
		{#if p.related.length}
			<section aria-labelledby="h-rel">
				<h2 id="h-rel" class="mb-2 font-semibold">Pages liées</h2>
				<ul class="space-y-1.5">
					{#each p.related as l (l.id)}
						<li><a href={toPage(l.id)} class="text-link underline underline-offset-3" title={l.reasons.join(", ")}>{l.title}</a></li>
					{/each}
				</ul>
			</section>
		{/if}
		<dl class="text-muted-foreground space-y-1 text-xs">
			{#if p.generated}<div><dt class="inline">Généré par</dt> <dd class="inline">{p.generated.by}, {day(p.generated.at)}</dd></div>{/if}
			{#if p.verified}<div><dt class="inline">Relu par</dt> <dd class="inline">{p.verified.by}, {day(p.verified.at)}</dd></div>{/if}
		</dl>
	</aside>
</div>
