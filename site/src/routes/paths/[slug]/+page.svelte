<script lang="ts">
	import { Button } from "#lib/components/ui/button/index.js";
	import Icon from "#lib/components/icon.svelte";
	import TypeBadge from "#lib/components/type-badge.svelte";
	import { toPageInPath, toPaths } from "#lib/path-links.js";
	import { contentLang, t } from "#lib/i18n/index.js";

	let { data } = $props();
	const p = $derived(data.path);
	const first = $derived(p.steps[0]);
	const link = "text-link link-content inline-flex min-h-6 items-center gap-1.5 underline underline-offset-4";
</script>

<svelte:head>
	<title>{p.title} · {t("paths.title")} · Cortex</title>
	<meta name="description" content={p.goal} />
</svelte:head>

<article>
	<p class="text-sm"><a href={toPaths()} class={link}><Icon name="back" size={16} />{t("paths.all")}</a></p>
	<h1 lang={contentLang} class="font-display mt-3 text-3xl font-semibold tracking-tight">{p.title}</h1>
	<p class="mt-3 max-w-prose"><span class="text-muted-foreground text-sm font-medium">{t("paths.goal")}</span><br /><span lang={contentLang}>{p.goal}</span></p>
	<p class="text-muted-foreground mt-2 text-sm">{t("paths.steps", { count: p.steps.length })}</p>
	{#if p.intro}<div class="wiki mt-4 max-w-prose" lang={contentLang}>{@html p.intro}</div>{/if}
	{#if first}
		<p class="mt-4"><Button href={toPageInPath(first.id, p.slug)}>{t("paths.start")}</Button></p>
	{/if}

	<ol class="mt-8 max-w-prose space-y-6" aria-label={t("paths.stepsList")}>
		{#each p.steps as s, i (s.id)}
			<li class="border-border grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 border-t pt-4">
				<span class="text-muted-foreground text-sm font-medium tabular-nums" aria-hidden="true">{i + 1}</span>
				<div class="min-w-0">
					<p class="sr-only">{t("paths.step", { n: i + 1 })}</p>
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
						<a href={toPageInPath(s.id, p.slug)} class="text-link font-medium underline underline-offset-4 [overflow-wrap:anywhere]" lang={contentLang}>{s.title}</a>
						<TypeBadge type={s.type} />
					</div>
					{#if s.reason}<p class="mt-2 text-sm" lang={contentLang}>{@html s.reason}</p>
					{:else if s.description}<p class="text-muted-foreground mt-2 text-sm" lang={contentLang}>{s.description}</p>{/if}
				</div>
			</li>
		{/each}
	</ol>
</article>
