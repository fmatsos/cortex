<script lang="ts">
	import { goto } from "$app/navigation";
	import { account } from "#lib/account.svelte.js";
	import ConfirmDialog from "#lib/components/account/confirm-dialog.svelte";
	import ConversationsSection from "#lib/components/account/conversations-section.svelte";
	import JourneysSection from "#lib/components/account/journeys-section.svelte";
	import Icon from "#lib/components/icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Empty from "#lib/components/ui/empty/index.js";
	import { toRoute } from "#lib/links.js";
	import { t } from "#lib/i18n/index.js";

	// The account page: identity, sign-out and deletion, then the saved conversations and journeys. Prerendered as an empty
	// shell; everything else is loaded in the browser (the account only exists on a `cortex serve` with sign-in).
	let deleting = $state(false);
	const me = $derived(account.me);
</script>

<svelte:head><title>{t("account.mine")} · Cortex</title><meta name="robots" content="noindex" /></svelte:head>

<div class="mx-auto flex max-w-4xl flex-col gap-6">
	<h1 class="text-3xl font-semibold tracking-tight">{t("account.mine")}</h1>

	{#if !account.ready}
		<p class="text-muted-foreground text-sm" role="status"><Icon name="retry" size={16} class="mr-1 inline motion-safe:animate-spin" />{t("account.loading")}</p>
	{:else if me}
		<section aria-label={t("account.identity")} class="border-border bg-card shadow-surface flex flex-col gap-4 border p-4 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex min-w-0 items-center gap-3">
				<span class="bg-muted text-muted-foreground border-border flex size-12 shrink-0 items-center justify-center border"><Icon name="account" size={28} /></span>
				<div class="min-w-0">
					<p class="text-lg font-semibold break-words">{me.name}</p>
					{#if me.email}<p class="text-muted-foreground text-sm break-all">{me.email}</p>{/if}
					<p class="text-muted-foreground text-sm">{t("account.via", { provider: account.providerLabel(me.provider) })}</p>
				</div>
			</div>
			<div class="flex flex-wrap gap-2">
				<Button variant="outline" onclick={() => void account.signOut()}><Icon name="sign-out" size={16} />{t("account.signOut")}</Button>
				<Button variant="outline" class="text-destructive hover:text-destructive" onclick={() => (deleting = true)}><Icon name="trash" size={16} />{t("account.delete")}</Button>
			</div>
		</section>

		<ConversationsSection />
		<JourneysSection />

		<ConfirmDialog bind:open={deleting} heading={t("account.delete.title")} text={t("account.delete.text")} confirm={t("account.delete.confirm")} failure={t("account.delete.failed")} onconfirm={async () => {
			await account.remove();
			void goto(toRoute("/"), { invalidateAll: true });
		}} />
	{:else}
		<Empty.Root>
			<Empty.Header>
				<Empty.Media variant="icon"><Icon name="account" size={20} /></Empty.Media>
				<Empty.Title>{account.methods.length ? t("account.signedOut.title") : t("account.unavailable.title")}</Empty.Title>
				<Empty.Description>{account.methods.length ? t("account.signedOut.text") : t("account.unavailable.text")}</Empty.Description>
			</Empty.Header>
			{#if account.methods.length}
				<Empty.Content>
					<div class="flex flex-wrap justify-center gap-2">
						{#each account.methods as provider (provider.id)}
							<Button onclick={() => account.signIn(provider.id)}><Icon name="sign-in" size={16} />{t("account.signInWith", { label: provider.label })}</Button>
						{/each}
					</div>
				</Empty.Content>
			{/if}
		</Empty.Root>
	{/if}
</div>
