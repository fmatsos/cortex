<script lang="ts">
	import { page } from "$app/state";
	import Icon from "#lib/components/icon.svelte";
	import SearchBox from "#lib/components/search-box.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { toRoute } from "#lib/links.js";
	import { t } from "#lib/i18n/index.js";

	// Site error page: shown for an unknown address (404, including via `404.html` on static hosting)
	// and for any client-side error. In the site template (header, search, theme).
	const notFound = $derived(page.status === 404);
	const title = $derived(notFound ? t("error.notFound") : t("error.generic"));
</script>

<svelte:head>
	<title>{title} · Cortex</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<section aria-labelledby="error-title" class="mx-auto max-w-2xl py-6">
	<p class="text-muted-foreground flex items-center gap-2 text-sm"><Icon name="error" size={18} />{t("error.status", { status: page.status })}</p>
	<h1 id="error-title" class="mt-1 text-3xl font-semibold tracking-tight">{title}</h1>
	{#if notFound}
		<p class="text-muted-foreground mt-3">
			{t("error.notFound.text")}{#if page.url.pathname !== "/"}{t("common.colon")}<code class="bg-muted rounded px-1.5 py-0.5 text-sm break-all">{page.url.pathname}</code>{/if}.
			{t("error.notFound.why")}
		</p>
	{:else}
		<p class="text-muted-foreground mt-3">{page.error?.message ?? t("error.loadFailed")} {t("error.checkConnection")}</p>
	{/if}

	<div class="mt-6">
		<h2 class="text-sm font-medium">{t("search.label")}</h2>
		<SearchBox class="mt-2 max-w-xl" />
	</div>

	<div class="touch-gap mt-6 flex flex-wrap gap-2">
		<Button href={toRoute("/")}><Icon name="home" size={16} />{t("offline.fallback.home")}</Button>
		{#if !notFound}<Button variant="outline" onclick={() => location.reload()}><Icon name="retry" size={16} />{t("common.retry")}</Button>{/if}
		<Button href={toRoute("/tags")} variant="outline"><Icon name="tags" size={16} />{t("nav.tags")}</Button>
		<Button href={toRoute("/log")} variant="outline"><Icon name="journal" size={16} />{t("nav.log")}</Button>
		<Button href={toRoute("/graph")} variant="outline"><Icon name="graph" size={16} />{t("nav.graph")}</Button>
	</div>
</section>
