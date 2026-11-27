<script lang="ts">
	import { onMount } from "svelte";
	import { account } from "#lib/account.svelte.js";
	import { ApiError } from "#lib/api.js";
	import Icon from "#lib/components/icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Dialog from "#lib/components/ui/dialog/index.js";
	import { labelOf, spaces, type ArchivedRow } from "#lib/spaces.svelte.js";
	import { contentLang, intlLocale, t } from "#lib/i18n/index.js";

	// The spaces the visitor archived or owned when they were archived (`GET /api/spaces/archived`): hidden from everyone, restorable
	// by their owners only. Restoring serves the space again under its old address; when another space has taken the name meanwhile
	// the server refuses (409) and the dialog says so.
	const uid = $props.id();
	let failed = $state(false), notice = $state(""), target = $state<ArchivedRow | null>(null), open = $state(false), pending = $state(false), error = $state("");
	const owns = $derived(Object.values(spaces.details).some((d) => d?.you === "owner"));

	async function load() {
		failed = false;
		try { await spaces.loadArchived(); } catch (e) { if (e instanceof ApiError && e.status === 401) account.expire(); else failed = true; }
	}
	onMount(() => { void load(); });
	const day = (iso: string) => { const at = new Date(iso); return Number.isNaN(+at) ? "" : at.toLocaleDateString(intlLocale(), { day: "numeric", month: "long", year: "numeric" }); };

	function ask(row: ArchivedRow) { target = row; error = ""; open = true; }
	async function restore() {
		if (!target || pending) return;
		pending = true; error = "";
		const row = target;
		try {
			await spaces.restore(row.name);
			open = false;
			notice = t("spaces.restore.done", { title: row.title || row.name });
			await spaces.load(); // the restored space is back in the lists
		} catch (e) {
			const status = e instanceof ApiError ? e.status : 0;
			if (status === 401) account.expire();
			error = status === 409 ? t("spaces.restore.taken") : status === 404 ? t("spaces.restore.gone") : t("spaces.restore.failed");
		} finally { pending = false; }
	}
</script>

{#if spaces.archivedLoaded && (spaces.archived.length || owns) || failed}
	<section aria-labelledby="{uid}-h" class="border-border bg-card shadow-surface border">
		<header class="border-border flex flex-wrap items-start justify-between gap-3 border-b p-4">
			<div class="min-w-0">
				<h2 id="{uid}-h" class="flex items-center gap-2 text-xl font-semibold tracking-tight"><Icon name="recent" size={22} />{t("spaces.archived")}</h2>
				<p class="text-muted-foreground mt-0.5 text-sm">{t("spaces.archived.lead")}</p>
			</div>
			<span aria-live="polite" class="text-muted-foreground text-sm tabular-nums">{t("spaces.count", { count: spaces.archived.length })}</span>
		</header>
		<p role="status" class="text-accent-foreground bg-accent mx-4 mt-4 px-3 py-2 text-sm empty:hidden">{notice}</p>
		{#if failed}
			<p role="alert" class="text-destructive p-4 text-sm">{t("account.loadFailed")} <Button variant="outline" size="sm" class="ml-2" onclick={load}><Icon name="retry" size={16} />{t("common.retry")}</Button></p>
		{:else if !spaces.archived.length}
			<p class="text-muted-foreground p-4 text-sm">{t("spaces.archived.empty")}</p>
		{:else}
			<ul class="divide-border divide-y">
				{#each spaces.archived as row (row.name)}
					<li class="flex flex-wrap items-center gap-3 p-4">
						<div class="min-w-0 flex-1">
							<p class="font-semibold [overflow-wrap:anywhere]" lang={contentLang}>{labelOf(row)}</p>
							<p class="text-muted-foreground text-xs">{row.name}{#if day(row.archivedAt)}{" · "}{t("spaces.archived.on", { date: day(row.archivedAt) })}{/if}</p>
						</div>
						<Button variant="outline" onclick={() => ask(row)} aria-label={t("spaces.restore.of", { name: labelOf(row) })}><Icon name="recent" size={16} />{t("spaces.restore")}</Button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<Dialog.Root bind:open title={t("spaces.restore.title", { name: target ? labelOf(target) : "" })} description={t("spaces.restore.text")}>
		<p class="bg-secondary border-border border px-3 py-2 text-sm"><code>/s/{target?.name}/</code></p>
		<p role="alert" class="text-destructive text-sm empty:hidden">{error}</p>
		{#snippet actions()}
			<!-- svelte-ignore a11y_autofocus -->
			<Button variant="outline" autofocus onclick={() => (open = false)}>{t("common.cancel")}</Button>
			<Button disabled={pending} onclick={restore}>{t("spaces.restore")}</Button>
		{/snippet}
	</Dialog.Root>
{/if}
