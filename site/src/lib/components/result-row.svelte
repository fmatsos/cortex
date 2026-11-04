<script lang="ts">
	import { Badge } from "#lib/components/ui/badge/index.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import Icon from "#lib/components/icon.svelte";
	import StatusBadge from "#lib/components/status-badge.svelte";
	import TypeBadge from "#lib/components/type-badge.svelte";
	import { favs } from "#lib/favs.svelte.js";
	import { typeColor, typeIcon, typeLabel } from "#lib/type-meta.js";

	/**
	 * Ligne de page commune à la palette, aux résultats, aux listes de tags et à l'accueil : type, titre, informations de confiance
	 * (statut, relecture, source partielle), description et passage trouvé. `verified` et `needsReview` sont facultatifs : une liste
	 * qui ne les connaît pas n'affiche rien plutôt qu'une fausse information.
	 * `compact` : forme de la palette (une ligne, extraits tronqués, aucun lien ni bouton : l'option porte l'action).
	 * `titleHtml`, `descriptionHtml`, `snippetHtml` : HTML déjà échappé par le moteur (surlignage <mark>).
	 */
	type RowDoc = { id: string; type: string; title: string; description?: string; status?: string; verified?: boolean; needsReview?: boolean; partial?: boolean };
	let {
		doc, href, titleHtml, descriptionHtml, snippetHtml, compact = false, selected = false, showFav = false, onopen,
	}: {
		doc: RowDoc; href?: string; titleHtml?: string; descriptionHtml?: string; snippetHtml?: string;
		compact?: boolean; selected?: boolean; showFav?: boolean; onopen?: () => void;
	} = $props();
	const fav = $derived(favs.has(doc.id));
	const showStatus = $derived(!!doc.status && doc.status !== "stable");
	const desc = $derived(descriptionHtml ?? doc.description ?? "");
</script>

{#snippet title()}
	{#if titleHtml !== undefined}{@html titleHtml}{:else}{doc.title}{/if}
{/snippet}

{#snippet trust()}
	{#if showStatus}<StatusBadge status={doc.status!} />{/if}
	{#if doc.needsReview}
		<Badge variant="caution"><Icon name="needs-review" size={16} />à relire</Badge>
	{:else if doc.verified === false}
		<span class="text-muted-foreground inline-flex min-h-6 items-center gap-1 text-sm"><Icon name="unverified" size={16} />jamais relue</span>
	{/if}
	{#if doc.partial}<Badge variant="outline"><Icon name="warning" size={16} class="text-warning-foreground" />source partielle</Badge>{/if}
{/snippet}

{#if compact}
	<div class="flex items-baseline justify-between gap-3">
		<span class="flex min-w-0 items-baseline gap-2 {selected ? 'line-clamp-2' : 'truncate'}">
			<Icon name={typeIcon(doc.type)} size={16} class="relative top-0.5 self-start" style="color: {typeColor(doc.type)}" />
			<span class="min-w-0 {selected ? '' : 'truncate'}">{@render title()}</span>
		</span>
		<span class="text-muted-foreground flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-sm">
			<span class="sr-only">{typeLabel(doc.type)} :</span>
			{#if showStatus}<StatusBadge status={doc.status!} />{/if}
			{#if doc.needsReview}<Badge variant="caution"><Icon name="needs-review" size={16} />à relire</Badge>{/if}
			{#if doc.partial}<Badge variant="outline"><Icon name="warning" size={16} class="text-warning-foreground" />partielle</Badge>{/if}
		</span>
	</div>
	{#if snippetHtml || desc}<p class="text-muted-foreground mt-0.5 text-sm {selected ? 'line-clamp-3' : 'line-clamp-1'}">{@html snippetHtml ?? desc}</p>{/if}
{:else}
	<div class="flex items-start gap-2">
		<div class="min-w-0 flex-1">
			<div class="text-base">
				{#if href}<a {href} class="text-link link-content font-medium underline-offset-4 hover:underline" onclick={onopen}>{@render title()}</a>{:else}<span class="font-medium">{@render title()}</span>{/if}
			</div>
			<div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
				<TypeBadge type={doc.type} />
				{@render trust()}
			</div>
			{#if desc}<p class="text-muted-foreground mt-1.5 text-[0.9375rem] leading-relaxed">{@html desc}</p>{/if}
			{#if snippetHtml}<p class="mt-1.5 text-[0.9375rem] leading-relaxed">{@html snippetHtml}</p>{/if}
		</div>
		{#if showFav}
			<Button variant="ghost" size="icon" aria-pressed={fav} aria-label="Favori : {doc.title}" title="Favoris propres à ce navigateur" onclick={() => favs.toggle(doc.id)}>
				<Icon name="star" size={20} filled={fav} class={fav ? "text-favorite" : "text-muted-foreground"} />
			</Button>
		{/if}
	</div>
{/if}
