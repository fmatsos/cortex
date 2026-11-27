<script lang="ts">
	import { onMount, tick } from "svelte";
	import Icon from "#lib/components/icon.svelte";
	import TypeBadge from "#lib/components/type-badge.svelte";
	import { Badge } from "#lib/components/ui/badge/index.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import { dayOfMs, FIRST_DAYS, FIRST_MAX, longDay, parseSeen, since, watermark } from "#lib/changes.js";
	import { dayLabel, groupDays } from "#lib/log-view.js";
	import { toPage, toRoute } from "#lib/links.js";
	import { spaceKey } from "#lib/storage.js";
	import { contentLang, t } from "#lib/i18n/index.js";

	// « Since my last visit »: the reference point is the newest change date the visitor has seen, kept in this browser only
	// (localStorage, never required). Nothing moves it but the button: no automatic « seen », no reading history per page.
	let { data } = $props();
	let seen = $state<number>();
	let persisted = $state(true);
	let preview = $state(false); // the recent window again, without touching the reference point
	let confirmed = $state(false);
	let heading = $state<HTMLElement | null>(null);

	onMount(() => {
		try { seen = parseSeen(localStorage.getItem(spaceKey("changes-seen"))); } catch { persisted = false; }
	});

	const newest = $derived(watermark(data.changes));
	const view = $derived(since(data.changes, preview ? undefined : seen));
	const days = $derived(groupDays(view.items.map((i) => ({ at: new Date(i.at).toISOString(), i }))));
	const upToDate = $derived(seen !== undefined && !preview && !view.items.length);
	// the button is useful while there is something to mark: a window shown to a first visitor, or changes newer than the reference
	const canMark = $derived(newest !== undefined && (seen === undefined || newest > seen) && view.items.length > 0);

	async function markSeen() {
		if (newest === undefined) return;
		try { localStorage.setItem(spaceKey("changes-seen"), String(newest)); persisted = true; } catch { persisted = false; }
		seen = newest; // kept for this visit even when storage refuses
		preview = false;
		confirmed = true;
		await tick();
		heading?.focus(); // the button leaves the page with the list it marked: the focus follows the new state
	}
</script>

<svelte:head><title>{t("changes.title")} · Cortex</title></svelte:head>

<h1 class="text-3xl font-semibold tracking-tight">{t("changes.title")}</h1>

{#if newest === undefined}
	<p class="text-muted-foreground mt-4">{t("changes.empty")}</p>
{:else}
	<p class="text-muted-foreground mt-3 max-w-prose">
		{#if view.recent}
			{t("changes.lead.first", { days: FIRST_DAYS, max: FIRST_MAX })}
		{:else}
			{t("changes.lead.since", { day: longDay(dayOfMs(seen!)) })}
		{/if}
		{t("changes.local")}
	</p>

	<div class="mt-4 flex flex-wrap items-center gap-3">
		<h2 bind:this={heading} id="changes-state" tabindex="-1" class="text-lg font-semibold outline-none">
			{#if confirmed && upToDate}{t("changes.confirmed")}{:else if upToDate}{t("changes.upToDate", { day: longDay(dayOfMs(seen!)) })}{:else}{t("changes.count", { count: view.items.length })}{/if}
		</h2>
		{#if canMark}
			<Button variant="outline" onclick={markSeen}><Icon name="success" size={16} />{t("changes.markSeen")}</Button>
		{/if}
		{#if seen !== undefined}
			<Button variant="ghost" aria-pressed={preview} onclick={() => (preview = !preview)}>
				<Icon name="recent" size={16} />{preview ? t("changes.backToNew") : t("changes.showRecent")}
			</Button>
		{/if}
	</div>
	{#if !persisted}<p class="text-warning-foreground mt-2 text-sm" role="status">{t("changes.notPersisted")}</p>{/if}

	{#if view.items.length}
		<ol class="mt-6 space-y-8">
			{#each days as d (d.day)}
				<li>
					<h2 class="text-base font-semibold first-letter:uppercase"><time datetime={d.day} class="tabular-nums">{dayLabel(d.day)}</time></h2>
					<ul class="border-border mt-3 ml-1 space-y-3 border-l pl-5">
						{#each d.entries as e (e.i.id)}
							<li class="flex flex-wrap items-center gap-x-3 gap-y-1">
								<Badge variant="secondary">{e.i.kind === "created" ? t("changes.created") : t("changes.modified")}</Badge>
								<a href={toPage(e.i.id)} lang={contentLang} class="text-link link-content min-w-0 font-medium [overflow-wrap:anywhere] underline-offset-4 hover:underline">{e.i.title}</a>
								<TypeBadge type={e.i.type} />
							</li>
						{/each}
					</ul>
				</li>
			{/each}
		</ol>
	{/if}
{/if}

<p class="mt-8 text-sm"><a href={toRoute("/log")} class="text-link link-content underline underline-offset-4">{t("changes.seeLog")}</a></p>
