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
	import Toc from "#lib/components/toc.svelte";
	import TocSheet from "#lib/components/toc-sheet.svelte";
	import TypeBadge from "#lib/components/type-badge.svelte";
	import { NOTES_ID, SOURCES_ID, actor, currentSection, domainOf, originalSource, relatedEntries, showToc, tocItems } from "#lib/article.js";
	import { toPage, toTag } from "#lib/links.js";

	let { data } = $props();
	const p = $derived(data.page);
	const day = (iso?: string) => iso?.slice(0, 10);
	const srcOf = $derived(new Map(p.sources.map((s) => [s.id, s])));
	const original = $derived(p.type === "Source" ? originalSource(p.sources) : undefined);
	const stale = $derived(!!p.stale_after && Date.parse(p.stale_after) < Date.now());
	const related = $derived(relatedEntries(p.backlinks, p.related, data.shared));

	// Retour d'une note : vers l'appel réellement suivi (mémorisé au clic, par page et par note), sinon le premier ;
	// une note citée plusieurs fois a en plus un retour par occurrence (a b c).
	let followed = $state<Record<string, string>>({});
	const backTo = (id: string) => followed[`${p.id}|${id}`] ?? `fnref-${id}-1`;
	const letter = (i: number) => (i < 26 ? String.fromCharCode(97 + i) : String(i + 1));

	// Appel de note : un clic (ou Entrée) ouvre l'aperçu de la citation sur place ; sans l'API popover, ou avec une touche
	// modificatrice, le lien suit son cours vers la note en bas de page. Phase de capture : le défaut est annulé avant
	// que le routeur ne prenne le clic. Délégation : seuls les liens d'appel de note comptent.
	let preview = $state.raw<ReturnType<typeof CitationPreview>>();
	const onBody = (e: MouseEvent) => {
		const a = (e.target as Element).closest?.(".fn-ref a") as HTMLElement | null;
		const m = a?.id.match(/^fnref-(.+)-\d+$/);
		if (!a || !m) return;
		followed[`${p.id}|${m[1]}`] = a.id;
		const note = p.notes.find((n) => n.id === m[1]);
		if (note && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) && preview?.show(a, note, srcOf.get(note.id))) e.preventDefault();
	};

	// Sommaire : titres du corps, Notes et Sources ; section courante = dernier titre passé sous l'en-tête
	const items = $derived(tocItems(p.toc, p.notes.length, p.sources.length));
	const toc = $derived(showToc(items, p.html.length));
	let current = $state("");
	$effect(() => {
		if (!toc) return;
		const hs = items.map((t) => document.getElementById(t.id)).filter((h) => h != null);
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

	// Contexte de recherche : `?q=` n'est lisible que dans le navigateur (pages prérendues) ; on sait aussi si l'on vient des résultats
	let q = $state(""), fromSearch = $state(false);
	let body = $state<HTMLElement>();
	afterNavigate((nav) => {
		q = nav.to?.url.searchParams.get("q") ?? "";
		fromSearch = nav.type !== "enter" && !!nav.from?.url.pathname.replace(/\/$/, "").endsWith("/search");
	});
</script>

<svelte:head>
	<title>{p.title} · Second cerveau</title>
	<meta name="description" content={p.description} />
</svelte:head>

<!-- colonne de lecture ~72 caractères ; tableaux et blocs de code y défilent horizontalement -->
<div class="grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem] {toc ? 'pb-16' : ''}">
	<article class="min-w-0">
		<Breadcrumb type={p.type} title={p.title} />
		<header class="mb-6">
			<!-- confiance : le statut stable reste discret, ce qui demande de la prudence est saillant (texte et icône ensemble) -->
			<div class="flex flex-wrap items-center gap-2">
				<TypeBadge type={p.type} />
				<StatusBadge status={p.status} />
				{#if p.partial}
					<Badge variant="caution"><Icon name="warning" size={16} />{p.type === "Source" ? "Source partielle" : "Contenu partiel"}</Badge>
				{/if}
				{#if !p.verified}
					<Badge variant="outline"><Icon name="unverified" size={16} />jamais relue</Badge>
				{:else if p.needsReview}
					<Badge variant="caution"><Icon name="needs-review" size={16} />modifiée depuis la relecture · à relire</Badge>
				{:else}
					<Badge variant="outline" title="Relue par {p.verified.by}"><Icon name="verified" size={16} />relue le <time datetime={p.verified.at}>{day(p.verified.at)}</time></Badge>
				{/if}
				{#if stale}<Badge variant="destructive"><Icon name="stale" size={16} />périmée depuis <time datetime={p.stale_after}>{day(p.stale_after)}</time></Badge>{/if}
			</div>
			<h1 class="mt-3 text-3xl font-semibold tracking-tight">{p.title}</h1>
			<p class="text-muted-foreground mt-2">{p.description}</p>
			<div class="mt-3"><PageActions id={p.id} md={p.md} original={original && { url: original.url, domain: original.domain }} /></div>
			{#if p.tags.length}
				<ul class="mt-3 flex flex-wrap gap-1.5" aria-label="Tags">
					{#each p.tags as t}<li><Badge href={toTag(data.slugs[t])} variant="secondary">#{t}</Badge></li>{/each}
				</ul>
			{/if}
		</header>

		<ReadingHits container={body} {q} pageId={p.id} {fromSearch} />

		<!-- délégation : seuls les liens d'appel de note déclenchent `onBody` (Entrée sur un lien produit aussi un clic) -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="wiki" bind:this={body} onclickcapture={onBody}>{@html p.html}</div>

		{#if p.notes.length}
			<section class="mt-10 border-t pt-6" aria-labelledby={NOTES_ID}>
				<h2 id={NOTES_ID} class="flex scroll-mt-(--anchor-offset) items-center gap-2 text-lg font-semibold"><Icon name="citation" size={20} />Notes</h2>
				<ol class="mt-3 list-decimal space-y-2 pl-6 text-sm">
					{#each p.notes as n (n.id)}
						{@const s = srcOf.get(n.id)}
						<li id="fn-{n.id}" class="note-item">
							{#if s}<a href="#src-{s.id}" class="text-link underline underline-offset-3">{s.title}</a>{:else}<span class="text-muted-foreground">source sans entrée sources[] ({n.id})</span>{/if}
							{#if n.html}<span class="text-muted-foreground"> — </span>{@html n.html}{/if}
							<a href="#{backTo(n.id)}" aria-label="Retour au texte" class="text-link touch-target ml-1 inline-flex items-center px-1 align-middle no-underline"><Icon name="citation-return" size={16} /></a>
							{#if n.refs > 1}
								<span class="text-muted-foreground"><span class="sr-only">Occurrences :</span>
									{#each { length: n.refs } as _, i}
										<a href="#fnref-{n.id}-{i + 1}" aria-label="Retour à l'occurrence {i + 1} sur {n.refs}" class="text-link inline-block px-1 py-0.5 pointer-coarse:px-2 pointer-coarse:py-2 no-underline hover:underline">{letter(i)}</a>
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
				<h2 id={SOURCES_ID} class="flex scroll-mt-(--anchor-offset) items-center gap-2 text-lg font-semibold"><Icon name="source" size={20} />Sources</h2>
				<ul class="mt-3 space-y-2 text-sm">
					{#each p.sources as s (s.id)}
						<li id="src-{s.id}" class="anchor-target">
							{#if s.url}
								<a href={s.url} rel="noopener noreferrer" class="text-link inline-flex items-center gap-1 font-medium underline underline-offset-3">{s.title}<Icon name="external-link" size={16} /><span class="sr-only"> — lien externe</span></a>
								{#if domainOf(s.url)}<span class="text-muted-foreground"> ({domainOf(s.url)})</span>{/if}
							{:else}<span class="font-medium">{s.title}</span>{/if}
							{#if s.partial}<Badge variant="caution" class="ml-1 align-middle"><Icon name="warning" size={16} />extraction partielle</Badge>{/if}
							{#if s.page}<span class="text-muted-foreground"> · page <a href={toPage(s.page.id)} class="text-link underline underline-offset-3">{s.page.title}</a></span>{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</article>

	<aside class="space-y-8 self-start text-sm" aria-label="Liens">
		{#if toc}
			<nav aria-labelledby="h-toc" class="hidden lg:block">
				<h2 id="h-toc" class="mb-2 flex items-center gap-2 font-semibold"><Icon name="toc" size={20} />Sommaire</h2>
				<Toc {items} {current} />
			</nav>
		{/if}
		<RelatedPages backlinks={p.backlinks} {related} />
		<section aria-labelledby="h-prov" class="bg-muted/50 rounded-lg border p-3">
			<h2 id="h-prov" class="mb-2 flex items-center gap-2 font-semibold"><Icon name="generated" size={20} class="text-muted-foreground" />Provenance</h2>
			<dl class="space-y-2">
				{#if p.generated}
					<div class="flex items-start gap-2">
						<div><dt class="text-muted-foreground text-xs">Rédigée par</dt><dd><span class="font-medium">{actor(p.generated.by)}</span> · <time datetime={p.generated.at}>{day(p.generated.at)}</time></dd></div>
					</div>
				{/if}
				<div class="flex items-start gap-2">
					{#if p.verified}
						<div><dt class="text-muted-foreground text-xs">Relue par</dt><dd><span class="font-medium">{actor(p.verified.by)}</span> · <time datetime={p.verified.at}>{day(p.verified.at)}</time></dd></div>
					{:else}
						<div><dt class="sr-only">Relecture</dt><dd class="text-muted-foreground">Jamais relue</dd></div>
					{/if}
				</div>
			</dl>
		</section>
	</aside>
</div>

{#if toc}<TocSheet {items} {current} />{/if}
<CitationPreview bind:this={preview} />

<style>
	/* tableaux : le conteneur (`.table-wrap`, ajouté à l'export) est la région défilante, focalisable au clavier ; le tableau
	   garde sa mise en forme (app.css) mais ne défile plus lui-même. Ombre sur le bord qui cache encore du contenu, en-têtes
	   figés pour les tableaux hauts. */
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
	/* les mots ne se coupent pas lettre à lettre (app.css l'autorise pour le corps) : le tableau s'élargit et défile */
	.wiki :global(.table-wrap th),
	.wiki :global(.table-wrap td) {
		overflow-wrap: normal;
	}
	/* grand écran : un tableau haut défile dans son cadre et garde ses en-têtes ; sur mobile, la page seule défile verticalement */
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
