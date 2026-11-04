<script lang="ts">
	import { page } from "$app/state";
	import Icon from "#lib/components/icon.svelte";
	import SearchBox from "#lib/components/search-box.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { toRoute } from "#lib/links.js";

	// Page d'erreur du site : affichée pour une adresse inconnue (404, y compris via `404.html` sur l'hébergement statique)
	// et pour toute erreur côté client. Dans le gabarit du site (en-tête, recherche, thème).
	const notFound = $derived(page.status === 404);
	const title = $derived(notFound ? "Page introuvable" : "Une erreur est survenue");
</script>

<svelte:head>
	<title>{title} · Second cerveau</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<section aria-labelledby="titre-erreur" class="mx-auto max-w-2xl py-6">
	<p class="text-muted-foreground flex items-center gap-2 text-sm"><Icon name="error" size={18} />Erreur {page.status}</p>
	<h1 id="titre-erreur" class="mt-1 text-3xl font-semibold tracking-tight">{title}</h1>
	{#if notFound}
		<p class="text-muted-foreground mt-3">
			Cette adresse ne correspond à aucune page du wiki{#if page.url.pathname !== "/"} : <code class="bg-muted rounded px-1.5 py-0.5 text-sm break-all">{page.url.pathname}</code>{/if}.
			La page a pu être renommée, supprimée ou le lien est incomplet.
		</p>
	{:else}
		<p class="text-muted-foreground mt-3">{page.error?.message ?? "Le chargement de la page a échoué."} Vérifiez votre connexion, puis réessayez.</p>
	{/if}

	<div class="mt-6">
		<h2 class="text-sm font-medium">Rechercher dans le wiki</h2>
		<SearchBox class="mt-2 max-w-xl" />
	</div>

	<div class="touch-gap mt-6 flex flex-wrap gap-2">
		<Button href={toRoute("/")}><Icon name="home" size={16} />Retour à l'accueil</Button>
		{#if !notFound}<Button variant="outline" onclick={() => location.reload()}><Icon name="retry" size={16} />Réessayer</Button>{/if}
		<Button href={toRoute("/tags")} variant="outline"><Icon name="tags" size={16} />Tags</Button>
		<Button href={toRoute("/log")} variant="outline"><Icon name="journal" size={16} />Journal</Button>
		<Button href={toRoute("/graph")} variant="outline"><Icon name="graph" size={16} />Graphe</Button>
	</div>
</section>
