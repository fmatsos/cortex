<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import { loadPathNav, toPageInPath, toPath } from "#lib/path-links.js";
	import { pathOf, pathPosition, type PathNavData } from "#lib/paths.js";
	import { contentLang, t } from "#lib/i18n/index.js";

	// "Previous / Next" of an article read in a reading path (`?path=<slug>` in the address). `full`: the header form (path
	// name, position, the reason for this step); otherwise only the way on, under the text. Nothing shows when the address
	// names no path, the path does not go through this page, or the paths cannot be read.
	let { pageId, slug, full = false }: { pageId: string; slug: string; full?: boolean } = $props();
	let paths = $state<PathNavData[]>([]);
	$effect(() => { if (slug) void loadPathNav().then((v) => { paths = v; }); });
	const path = $derived(pathOf(paths, slug));
	const pos = $derived(path && pathPosition(path, pageId));
	const link = "text-link hover:bg-muted focus-visible:outline-ring touch-target inline-flex min-h-6 max-w-full items-center gap-1 px-1 py-1 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2";
</script>

{#if path && pos}
	<nav aria-label={full ? t("paths.nav.label", { title: path.title }) : t("paths.nav.more", { title: path.title })} class="border-border bg-muted/50 shadow-surface mb-6 border p-3 text-sm {full ? '' : 'mt-8'}" data-path-nav={full ? "top" : "bottom"}>
		{#if full}
			<p class="flex flex-wrap items-baseline gap-x-2"><a href={toPath(path.slug)} class="text-link font-medium underline underline-offset-4" lang={contentLang}>{path.title}</a><span class="text-muted-foreground tabular-nums">{t("paths.nav.position", { n: pos.n, total: pos.total })}</span></p>
			{#if pos.step.reason}<p class="mt-1">{t("paths.nav.reason")} <span lang={contentLang}>{pos.step.reason}</span></p>{/if}
		{/if}
		<div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 {full ? 'mt-2' : ''}">
			{#if pos.prev}
				<a href={toPageInPath(pos.prev.id, path.slug)} rel="prev" class={link}><Icon name="chevron-down" size={16} class="shrink-0 rotate-90" /><span class="min-w-0"><span class="font-medium">{t("paths.nav.prev")}</span><span class="text-muted-foreground ml-1.5" lang={contentLang}>· {pos.prev.title}</span></span></a>
			{:else}<span></span>{/if}
			{#if pos.next}
				<a href={toPageInPath(pos.next.id, path.slug)} rel="next" class="{link} ml-auto text-right"><span class="min-w-0"><span class="font-medium">{t("paths.nav.next")}</span><span class="text-muted-foreground ml-1.5" lang={contentLang}>· {pos.next.title}</span></span><Icon name="chevron-down" size={16} class="shrink-0 -rotate-90" /></a>
			{/if}
		</div>
	</nav>
{/if}
