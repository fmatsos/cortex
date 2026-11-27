<script lang="ts">
	import { untrack } from "svelte";
	import { account } from "#lib/account.svelte.js";
	import { ApiError } from "#lib/api.js";
	import SettingsAccess from "#lib/components/account/settings-access.svelte";
	import SettingsDanger from "#lib/components/account/settings-danger.svelte";
	import SettingsIdentity from "#lib/components/account/settings-identity.svelte";
	import SettingsMembers from "#lib/components/account/settings-members.svelte";
	import Icon from "#lib/components/icon.svelte";
	import SpaceBadges from "#lib/components/space-badges.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Empty from "#lib/components/ui/empty/index.js";
	import { toRoute } from "#lib/links.js";
	import { labelOf, spaces, type SpaceDetail } from "#lib/spaces.svelte.js";
	import { t } from "#lib/i18n/index.js";

	// The settings of one space (`?space=<slug>`, else the space of the page), for its owners only. Any space can be reached from any
	// other's account page: the calls go to `/s/<slug>/api/space` at the root of the server. Prerendered as an empty shell.
	let name = $state(""), detail = $state<SpaceDetail | undefined>(), loading = $state(true), failed = $state(false);

	/** Reads the space again (after a change of the members): the page stays where it is, nothing flashes. */
	async function load() {
		failed = false;
		try { detail = name ? await spaces.detail(name) : undefined; spaces.remember(detail); }
		catch (e) { if (e instanceof ApiError && e.status === 401) account.expire(); else failed = true; }
		finally { loading = false; }
	}
	// the account is read by the layout, then the listing: the first read of the space waits for both
	let started = false;
	$effect(() => {
		if (started || !account.ready || !account.me || !spaces.loaded) return;
		started = true;
		untrack(() => { name = new URLSearchParams(location.search).get("space") || spaces.current; void load(); });
	});
	const owner = $derived(detail?.you === "owner");
	const ready = $derived(account.ready && spaces.loaded);
</script>

<svelte:head><title>{detail ? t("spaces.settings.of", { name: labelOf(detail) }) : t("spaces.settings")} · Cortex</title><meta name="robots" content="noindex" /></svelte:head>

<div class="mx-auto flex max-w-4xl flex-col gap-6">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0">
			<h1 class="text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">{detail ? t("spaces.settings.of", { name: labelOf(detail) }) : t("spaces.settings")}</h1>
			{#if detail}
				<p class="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">{detail.name} · <code>/s/{detail.name}/</code> <SpaceBadges content={detail.content} visibility={detail.visibility} readOnly={detail.readOnly} /></p>
			{/if}
		</div>
		<Button href={toRoute("/account")} variant="outline"><Icon name="back" size={16} />{t("spaces.mine")}</Button>
	</div>

	{#if !ready || (account.me && loading)}
		<p class="text-muted-foreground text-sm" role="status"><Icon name="retry" size={16} class="mr-1 inline motion-safe:animate-spin" />{t("account.loading")}</p>
	{:else if !account.me}
		<Empty.Root><Empty.Header><Empty.Media variant="icon"><Icon name="account" size={20} /></Empty.Media><Empty.Title>{t("account.signedOut.title")}</Empty.Title><Empty.Description>{t("account.signedOut.text")}</Empty.Description></Empty.Header></Empty.Root>
	{:else if failed}
		<p role="alert" class="text-destructive text-sm">{t("account.loadFailed")} <Button variant="outline" size="sm" class="ml-2" onclick={load}><Icon name="retry" size={16} />{t("common.retry")}</Button></p>
	{:else if !detail || !owner}
		<p role="alert" class="bg-note-background text-note-foreground px-4 py-3 text-sm">{t("spaces.settings.owners")}</p>
	{:else}
		{#key detail.name}
			<SettingsIdentity {detail} onchange={(d) => { detail = d; spaces.remember(d); }} />
			<SettingsMembers {detail} onrefresh={load} />
			<SettingsAccess {detail} onchange={(d) => { detail = d; spaces.remember(d); }} />
			<SettingsDanger {detail} />
		{/key}
	{/if}
</div>
