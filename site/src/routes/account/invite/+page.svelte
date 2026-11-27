<script lang="ts">
	import { onMount } from "svelte";
	import { account } from "#lib/account.svelte.js";
	import { api, ApiError } from "#lib/api.js";
	import Icon from "#lib/components/icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { spaceName } from "#lib/space.js";
	import { t } from "#lib/i18n/index.js";

	// Accepting an invitation to a space: `/s/<space>/account/invite/?token=…`. The server serves this page (before the check that hides a private
	// space) once the token is valid; the visitor signs in, then `POST /api/invites/<token>/accept` makes them a member and they go in. The token is
	// the secret: it stays out of the address bar's history once spent, and the page is never cached nor sent as a referrer.
	let token = $state(""), space = $state(""), pending = $state(false), problem = $state<"" | "invalid" | "failed">("");
	onMount(() => { token = new URL(location.href).searchParams.get("token") ?? ""; space = spaceName(); });
	const me = $derived(account.me);

	async function join() {
		if (pending) return;
		pending = true; problem = "";
		try {
			const r = await api<{ url: string }>(`/api/invites/${encodeURIComponent(token)}/accept`, { method: "POST" });
			location.replace(r.url);
		} catch (e) {
			const status = e instanceof ApiError ? e.status : 0;
			if (status === 401) account.expire();
			problem = status === 404 ? "invalid" : "failed";
			pending = false;
		}
	}
</script>

<svelte:head><title>{t("invite.title", { name: space })} · Cortex</title><meta name="robots" content="noindex" /><meta name="referrer" content="no-referrer" /></svelte:head>

<div class="mx-auto flex max-w-xl flex-col gap-4">
	<h1 class="text-3xl font-semibold tracking-tight">{t("invite.title", { name: space })}</h1>
	{#if !account.ready}
		<p class="text-muted-foreground text-sm" role="status"><Icon name="retry" size={16} class="mr-1 inline motion-safe:animate-spin" />{t("account.loading")}</p>
	{:else if !token || !space || problem === "invalid"}
		<p role="alert" class="bg-warning-background text-warning-foreground flex items-center gap-2 border px-3 py-2 text-sm"><Icon name="warning" size={20} />{t("invite.invalid")}</p>
	{:else if me}
		<p>{t("invite.signedIn", { name: me.name || me.email || t("account.unnamed") })}</p>
		<div><Button disabled={pending} onclick={join}><Icon name="sign-in" size={16} />{pending ? t("invite.joining") : t("invite.join", { name: space })}</Button></div>
		<p role="alert" class="text-destructive text-sm empty:hidden">{problem === "failed" ? t("invite.failed") : ""}</p>
	{:else if account.methods.length}
		<p>{t("invite.signedOut")}</p>
		<div class="flex flex-wrap gap-2">
			{#each account.methods as provider (provider.id)}
				<Button onclick={() => account.signIn(provider.id)}><Icon name="sign-in" size={16} />{t("account.signInWith", { label: provider.label })}</Button>
			{/each}
		</div>
	{:else}
		<p role="alert" class="text-muted-foreground text-sm">{t("invite.unavailable")}</p>
	{/if}
</div>
