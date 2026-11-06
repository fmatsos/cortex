<script lang="ts">
	import ChipButton from "#lib/components/chip-button.svelte";
	import Icon from "#lib/components/icon.svelte";
	import { Badge } from "#lib/components/ui/badge/index.js";
	import { toPage } from "#lib/links.js";
	import { QUEUE_KINDS, queueKind, typeColor, typeIcon } from "#lib/type-meta.js";
	import { t } from "#lib/i18n/index.js";

	let { data } = $props();
	let kind = $state("");

	const open = $derived(data.entries.filter((e) => e.status === "open"));
	const closed = $derived(data.entries.filter((e) => e.status !== "open"));
	const counts = $derived(new Map(QUEUE_KINDS.map((k) => [k.kind, open.filter((e) => e.kind === k.kind).length])));
	const kindsShown = $derived(QUEUE_KINDS.filter((k) => counts.get(k.kind) || kind === k.kind));
	const shown = $derived(open.filter((e) => !kind || e.kind === kind));
	const day = (at: string) => at.slice(0, 10);
</script>

{#snippet badge(k: string)}
	{@const meta = queueKind(k)}
	<Badge variant="outline" title={meta?.description} style="background: color-mix(in oklch, var({meta?.color ?? '--type-other'}) 14%, transparent); border-color: color-mix(in oklch, var({meta?.color ?? '--type-other'}) 45%, transparent)">
		{#if meta}<Icon name={meta.icon} size={16} style="color: var({meta.color})" />{/if}
		{meta?.label ?? k}
	</Badge>
{/snippet}

<svelte:head><title>{t("queue.title")} · Cortex</title></svelte:head>

<h1 class="text-3xl font-semibold tracking-tight">{t("queue.title")}</h1>
<p class="text-muted-foreground mt-2 max-w-prose text-sm">{t("queue.intro")}</p>

{#if data.entries.length}
	{#if open.length}
		<ul class="touch-gap mt-4 flex flex-wrap gap-2" aria-label={t("queue.kindFilter")}>
			<li><ChipButton pressed={kind === ""} onclick={() => (kind = "")}>{t("queue.all")} <span class="text-muted-foreground">{open.length}</span></ChipButton></li>
			{#each kindsShown as k (k.kind)}
				<li>
					<ChipButton pressed={kind === k.kind} onclick={() => (kind = kind === k.kind ? "" : k.kind)}>
						<Icon name={k.icon} size={16} style="color: var({k.color})" />
						{k.label} <span class="text-muted-foreground">{counts.get(k.kind) ?? 0}</span>
					</ChipButton>
				</li>
			{/each}
		</ul>
		<p class="text-muted-foreground mt-4 text-sm" role="status">{t("queue.entries", { count: shown.length })}</p>
		{#if shown.length}
			<ol class="mt-4 space-y-8">
				{#each shown as e (e.n)}
					<li id="q-{e.n}" class="scroll-mt-24">
						<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
							<span class="text-muted-foreground text-sm tabular-nums">#{e.n}</span>
							{@render badge(e.kind)}
							<time datetime={e.at} class="text-muted-foreground text-sm tabular-nums">{day(e.at)}</time>
						</div>
						<h2 class="mt-1 text-lg font-semibold">{e.title}</h2>
						<div class="wiki mt-1 text-[0.95rem]">{@html e.html}</div>
						{#if e.pages.length || e.sources.length}
							<ul class="touch-gap mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label={t("queue.pages")}>
								{#each e.pages as p (p.id)}
									<li class="flex items-center gap-1.5">
										<Icon name={typeIcon(p.type)} size={16} style="color: {typeColor(p.type)}" />
										<a href={toPage(p.id)} class="text-link underline-offset-4 hover:underline">{p.title}</a>
									</li>
								{/each}
								{#each e.sources as s (s.id)}
									<li class="flex items-center gap-1.5">
										<Icon name="source" size={16} class="text-muted-foreground" />
										{#if s.page}
											<a href={toPage(s.page.id)} class="text-link underline-offset-4 hover:underline">{s.page.title}</a>
										{:else}
											<code class="bg-muted rounded px-1.5 py-0.5 text-sm [overflow-wrap:anywhere]">{s.id}</code>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
						{#if e.proposal}
							<details class="mt-2">
								<summary class="text-muted-foreground hover:text-foreground cursor-pointer text-sm">{t("queue.proposal")}</summary>
								<div class="wiki mt-2 text-[0.95rem]">{@html e.proposal}</div>
							</details>
						{/if}
					</li>
				{/each}
			</ol>
		{:else}
			<p class="text-muted-foreground mt-6">{t("queue.noMatch")}</p>
		{/if}
	{:else}
		<p class="text-muted-foreground mt-6">{t("queue.empty")}</p>
	{/if}

	{#if closed.length}
		<details class="mt-10">
			<summary class="text-muted-foreground hover:text-foreground cursor-pointer text-sm">{t("queue.closed")} ({closed.length})</summary>
			<ul class="mt-3 space-y-1 text-sm">
				{#each closed as e (e.n)}
					<li><span class="tabular-nums">#{e.n}</span> {e.title} <span class="text-muted-foreground">: {e.status === "done" ? t("queue.done") : t("queue.dismissed")}{#if e.closedAt} ({day(e.closedAt)}){/if}</span></li>
				{/each}
			</ul>
		</details>
	{/if}
{:else}
	<p class="text-muted-foreground mt-6">{t("queue.empty")}</p>
{/if}
