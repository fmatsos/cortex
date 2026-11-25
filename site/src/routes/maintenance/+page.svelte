<script lang="ts">
	import { toPage } from "#lib/links.js";
	import { contentLang, t } from "#lib/i18n/index.js";

	let { data } = $props();
	const m = $derived(data.upkeep);
	const todo = $derived([m.raw.pending, m.orphans.length, m.broken.length, m.stale.length].filter((n) => n > 0).length);
	const code = "bg-muted inline-block max-w-full px-1.5 py-0.5 font-mono text-sm [overflow-wrap:anywhere]";
	const link = "text-link underline underline-offset-4";
</script>

<svelte:head><title>{t("maint.title")} · Cortex</title></svelte:head>

<h1 class="text-3xl font-semibold tracking-tight">{t("maint.title")}</h1>
<p class="text-muted-foreground mt-2 max-w-prose text-sm">{t("maint.lead")}</p>
<p class="mt-4 font-medium">{todo ? t("maint.todo", { count: todo }) : t("maint.allClear")}</p>

{#snippet action(label: string, command: string)}
	<p class="mt-3 text-sm"><span class="font-medium">{t("maint.action")}{t("common.colon")}</span>{label} <code class={code}>{command}</code></p>
{/snippet}

<div class="mt-6 space-y-8">
	<section aria-labelledby="m-raw" class="border-border border-t pt-4">
		<h2 id="m-raw" class="text-lg font-semibold">{t("maint.raw.title")}</h2>
		<p class="text-muted-foreground mt-1 max-w-prose text-sm">{t("maint.raw.why")}</p>
		{#if m.raw.pending}
			<p class="mt-3">{t("maint.raw.count", { count: m.raw.pending })}{#if m.raw.late}{" "}{t("maint.raw.late", { count: m.raw.late, days: m.raw.lateDays })}{/if}</p>
			{@render action(t("maint.raw.action"), "cortex compile --pending")}
		{:else}<p class="mt-3">{t("maint.clear")}</p>{/if}
	</section>

	<section aria-labelledby="m-orphans" class="border-border border-t pt-4">
		<h2 id="m-orphans" class="text-lg font-semibold">{t("maint.orphans.title")} <span class="text-muted-foreground font-normal tabular-nums">({m.orphans.length})</span></h2>
		<p class="text-muted-foreground mt-1 max-w-prose text-sm">{t("maint.orphans.why")}</p>
		{#if m.orphans.length}
			<ul class="mt-3 list-disc space-y-1 pl-5 text-sm" aria-label={t("maint.pages")}>
				{#each m.orphans as p (p.id)}<li><a href={toPage(p.id)} class={link} lang={contentLang}>{p.title}</a></li>{/each}
			</ul>
			{@render action(t("maint.orphans.action"), "cortex links")}
		{:else}<p class="mt-3">{t("maint.clear")}</p>{/if}
	</section>

	<section aria-labelledby="m-broken" class="border-border border-t pt-4">
		<h2 id="m-broken" class="text-lg font-semibold">{t("maint.broken.title")} <span class="text-muted-foreground font-normal tabular-nums">({m.broken.length})</span></h2>
		<p class="text-muted-foreground mt-1 max-w-prose text-sm">{t("maint.broken.why")}</p>
		{#if m.broken.length}
			<ul class="mt-3 space-y-2 text-sm" aria-label={t("maint.pages")}>
				{#each m.broken as b (b.page.id)}
					<li>
						<a href={toPage(b.page.id)} class={link} lang={contentLang}>{b.page.title}</a>
						<ul class="text-muted-foreground mt-1 list-disc pl-5">
							{#each b.targets as target (target)}<li>{t("maint.broken.missing")} <code class={code}>/{target}</code></li>{/each}
						</ul>
					</li>
				{/each}
			</ul>
			{@render action(t("maint.broken.action"), "cortex lint")}
		{:else}<p class="mt-3">{t("maint.clear")}</p>{/if}
	</section>

	<section aria-labelledby="m-stale" class="border-border border-t pt-4">
		<h2 id="m-stale" class="text-lg font-semibold">{t("maint.stale.title")} <span class="text-muted-foreground font-normal tabular-nums">({m.stale.length})</span></h2>
		<p class="text-muted-foreground mt-1 max-w-prose text-sm">{t("maint.stale.why", { days: m.staleDays })}</p>
		{#if m.stale.length}
			<ul class="mt-3 space-y-2 text-sm" aria-label={t("maint.pages")}>
				{#each m.stale as s (s.page.id)}
					<li>
						<a href={toPage(s.page.id)} class={link} lang={contentLang}>{s.page.title}</a>
						<ul class="text-muted-foreground mt-1 list-disc pl-5">
							{#each s.reasons as r (r.kind)}<li>{r.kind === "deprecated" ? t("maint.stale.deprecated") : r.kind === "expired" ? t("maint.stale.expired", { date: r.since ?? "" }) : t("maint.stale.review", { date: r.since ?? "" })}</li>{/each}
						</ul>
					</li>
				{/each}
			</ul>
			{@render action(t("maint.stale.action"), "cortex lint")}
		{:else}<p class="mt-3">{t("maint.clear")}</p>{/if}
	</section>
</div>
