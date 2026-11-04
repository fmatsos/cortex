<script lang="ts">
	import { Badge } from "#lib/components/ui/badge/index.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import FavButton from "#lib/components/fav-button.svelte";
	import TypeBadge from "#lib/components/type-badge.svelte";
	import { toPage, toTag } from "#lib/links.js";
	import { STATUS_LABEL } from "#lib/type-meta.js";

	let { data } = $props();
	const p = $derived(data.page);
	let copied = $state<"" | "lien" | "md">("");
	const copy = async (what: "lien" | "md", text: string) => { try { await navigator.clipboard.writeText(text); copied = what; setTimeout(() => (copied = ""), 1800); } catch { /* presse-papiers indisponible */ } };
	const day = (iso?: string) => iso?.slice(0, 10);
	const srcOf = $derived(new Map(p.sources.map((s) => [s.id, s])));

	// Retour d'une note : vers l'appel réellement suivi (mémorisé au clic, par page et par note), sinon le premier ;
	// une note citée plusieurs fois a en plus un retour par occurrence (↩ a b c).
	let followed = $state<Record<string, string>>({});
	const follow = (e: MouseEvent) => {
		const a = (e.target as Element).closest?.(".fn-ref a");
		const m = a?.id.match(/^fnref-(.+)-\d+$/);
		if (a && m) followed[`${p.id}|${m[1]}`] = a.id;
	};
	const backTo = (id: string) => followed[`${p.id}|${id}`] ?? `fnref-${id}-1`;
	const letter = (i: number) => (i < 26 ? String.fromCharCode(97 + i) : String(i + 1));

	// Sommaire : au-delà de 3 titres ; section courante = dernier titre passé sous l'en-tête
	const showToc = $derived(p.toc.length > 3);
	let tocOpen = $state(false), current = $state("");
	$effect(() => {
		if (!showToc) return;
		const hs = p.toc.map((t) => document.getElementById(t.id)).filter((h) => h != null);
		const on = () => { current = hs.findLast((h) => h.getBoundingClientRect().top <= innerHeight * 0.25)?.id ?? ""; };
		on();
		addEventListener("scroll", on, { passive: true });
		return () => removeEventListener("scroll", on);
	});
</script>

{#snippet toc()}
	<ol class="border-l text-sm">
		{#each p.toc as t (t.id)}
			<li>
				<a
					href="#{t.id}"
					onclick={() => (tocOpen = false)}
					aria-current={current === t.id ? "location" : undefined}
					class="text-muted-foreground hover:text-foreground aria-[current=location]:border-foreground aria-[current=location]:text-foreground -ml-px block border-l-2 border-transparent py-1 pointer-coarse:py-2.5 aria-[current=location]:font-medium {t.level === 3 ? 'pl-6' : 'pl-3'}"
				>{t.text}</a>
			</li>
		{/each}
	</ol>
{/snippet}

<svelte:head>
	<title>{p.title} · Second cerveau</title>
	<meta name="description" content={p.description} />
</svelte:head>

<!-- colonne de lecture ~72 caractères ; tableaux et blocs de code y défilent horizontalement -->
<div class="grid gap-10 lg:grid-cols-[minmax(0,72ch)_16rem] lg:justify-center">
	<article class="min-w-0 max-w-[72ch]">
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
				<Button variant="outline" size="sm" onclick={() => copy("lien", location.href)}>{copied === "lien" ? "Lien copié" : "Copier le lien"}</Button>
				<Button variant="outline" size="sm" onclick={() => copy("md", p.md)}>{copied === "md" ? "Markdown copié" : "Copier le Markdown"}</Button>
			</div>
			{#if p.tags.length}
				<ul class="mt-3 flex flex-wrap gap-1.5" aria-label="Tags">
					{#each p.tags as t}<li><Badge href={toTag(data.slugs[t])} variant="secondary">#{t}</Badge></li>{/each}
				</ul>
			{/if}
		</header>

		{#if showToc}
			<details bind:open={tocOpen} class="mb-6 rounded-lg border px-3 py-2 lg:hidden">
				<summary class="text-sm font-semibold py-1 pointer-coarse:py-2.5">Sommaire ({p.toc.length})</summary>
				<div class="mt-2">{@render toc()}</div>
			</details>
		{/if}

		<!-- délégation : seuls les liens d'appel de note déclenchent `follow` (Entrée sur un lien produit aussi un clic) -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="wiki" onclick={follow}>{@html p.html}</div>

		{#if p.notes.length}
			<section class="mt-10 border-t pt-6" aria-labelledby="h-notes">
				<h2 id="h-notes" class="text-lg font-semibold">Notes</h2>
				<ol class="mt-3 list-decimal space-y-2 pl-6 text-sm">
					{#each p.notes as n (n.id)}
						{@const s = srcOf.get(n.id)}
						<li id="fn-{n.id}" class="note-item">
							{#if s}<a href="#src-{s.id}" class="text-link underline underline-offset-3">{s.title}</a>{:else}<span class="text-muted-foreground">source sans entrée sources[] ({n.id})</span>{/if}
							{#if n.html}<span class="text-muted-foreground"> — </span>{@html n.html}{/if}
							<a href="#{backTo(n.id)}" aria-label="Retour au texte" class="text-link ml-1 inline-block px-1 no-underline">↩</a>
							{#if n.refs > 1}
								<span class="text-muted-foreground text-xs"><span class="sr-only">Occurrences :</span>
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
			<section class="mt-8 border-t pt-6" aria-labelledby="h-sources">
				<h2 id="h-sources" class="text-lg font-semibold">Sources</h2>
				<ul class="mt-3 space-y-2 text-sm">
					{#each p.sources as s (s.id)}
						<li id="src-{s.id}" class="anchor-target">
							{#if s.url}<a href={s.url} rel="noopener noreferrer" class="text-link font-medium underline underline-offset-3">{s.title}</a>{:else}<span class="font-medium">{s.title}</span>{/if}
							{#if s.page}<span class="text-muted-foreground"> · page <a href={toPage(s.page.id)} class="text-link underline underline-offset-3">{s.page.title}</a></span>{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</article>

	<aside class="space-y-8 self-start text-sm lg:sticky lg:top-16 lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto" aria-label="Liens">
		{#if showToc}
			<nav aria-labelledby="h-toc" class="hidden lg:block">
				<h2 id="h-toc" class="mb-2 font-semibold">Sommaire</h2>
				{@render toc()}
			</nav>
		{/if}
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
