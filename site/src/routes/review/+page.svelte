<script lang="ts">
	import { onMount } from "svelte";
	import Icon from "#lib/components/icon.svelte";
	import TypeBadge from "#lib/components/type-badge.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { longDay } from "#lib/changes.js";
	import { toPage, toRoute } from "#lib/links.js";
	import { spaceApi } from "#lib/space.js";
	import { loadDone, queueHref, saveQueue } from "#lib/review-queue.js";
	import { contentLang, t } from "#lib/i18n/index.js";

	// Review queue, read-only: the list never validates anything, and never in bulk. A page is opened, read, then validated
	// by its own « Mark as reviewed » button, which only exists where `/api/verify` answers (`cortex serve`).
	let { data } = $props();
	let done = $state(new Set<string>()); // validated from this tab since the build: they leave the queue until the site is rebuilt
	let probe = $state<"none" | "ok" | "read-only">("none"); // 409: a read-only space
	const api = $derived(probe === "ok");
	const pending = $derived(data.items.filter((i) => !done.has(i.id)));
	const never = $derived(pending.filter((i) => i.reason === "never").length);
	const modified = $derived(pending.length - never);

	onMount(() => {
		done = loadDone();
		fetch(spaceApi("/api/verify"), { method: "HEAD" }).then((r) => { probe = r.status === 204 ? "ok" : r.status === 409 ? "read-only" : "none"; }, () => {});
	});
	// the article reached from here offers the next page of this very list
	$effect(() => saveQueue(pending.map(({ id, title }) => ({ id, title }))));
	const day = (iso?: string) => (iso ? longDay(iso.slice(0, 10)) : "");
</script>

<svelte:head>
	<title>{t("review.title")} · Cortex</title>
	{#if !data.enabled}<meta name="robots" content="noindex" />{/if}
</svelte:head>

<h1 class="text-3xl font-semibold tracking-tight">{t("review.title")}</h1>

{#if !data.enabled}
	<p class="text-muted-foreground mt-4">{t("review.off")}</p>
	<p class="mt-3"><a href={toRoute("/")} class="text-link link-content underline underline-offset-4">{t("nav.home")}</a></p>
{:else}
	<p class="text-muted-foreground mt-3 max-w-prose">{t("review.lead")} {api ? t("review.hint.api") : probe === "read-only" ? t("spaces.readOnly.reason") : t("review.hint.static")}</p>

	{#if pending.length}
		<div class="mt-4 flex flex-wrap items-center gap-3">
			<h2 class="text-lg font-semibold">{t("review.count", { count: pending.length })}{" "}<span class="text-muted-foreground text-sm font-normal">({t("review.split", { never, modified })})</span></h2>
			<Button href={queueHref(toPage(pending[0]!.id))} variant="outline"><Icon name="needs-review" size={16} />{t("review.start")}</Button>
		</div>
		<ol class="divide-border mt-4 divide-y border-y">
			{#each pending as i (i.id)}
				<li class="flex flex-col gap-1 py-3">
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
						<a href={queueHref(toPage(i.id))} lang={contentLang} class="text-link link-content min-w-0 font-medium [overflow-wrap:anywhere] underline-offset-4 hover:underline">{i.title}</a>
						<TypeBadge type={i.type} />
					</div>
					<p class="text-muted-foreground flex items-center gap-1.5 text-sm">
						<Icon name={i.reason === "never" ? "unverified" : "needs-review"} size={16} />
						<span>
							{#if i.reason === "never"}
								{t("review.never")}{#if i.at}{t("common.colon")}{t("review.written", { date: day(i.at) })}{/if}
							{:else}
								{t("review.modified")}{t("common.colon")}{t("review.reviewedOn", { date: day(i.verifiedAt) })}{#if i.at}, {t("review.modifiedOn", { date: day(i.at) })}{/if}
							{/if}
						</span>
					</p>
				</li>
			{/each}
		</ol>
	{:else}
		<p class="mt-4">{t("review.none")}</p>
	{/if}
{/if}
