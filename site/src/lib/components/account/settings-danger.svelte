<script lang="ts">
	import { account } from "#lib/account.svelte.js";
	import { ApiError } from "#lib/api.js";
	import SettingsPanel from "#lib/components/account/settings-panel.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Dialog from "#lib/components/ui/dialog/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { toRoute } from "#lib/links.js";
	import { spaces, type SpaceDetail } from "#lib/spaces.svelte.js";
	import { t } from "#lib/i18n/index.js";

	// Archive: the space leaves the switcher, the search and the web for everyone, its contents are kept and its owners can restore it.
	// The slug has to be typed. A space that is its own git repository is refused by the server (archiving it from the web could lose
	// unpushed work): its message is shown as it is.
	let { detail }: { detail: SpaceDetail } = $props();
	const uid = $props.id();
	let open = $state(false), typed = $state(""), pending = $state(false), error = $state("");
	$effect(() => { if (open) { typed = ""; error = ""; } });

	async function archive(e: SubmitEvent) {
		e.preventDefault();
		if (typed !== detail.name || pending) return;
		pending = true; error = "";
		try {
			await spaces.archive(detail.name, typed);
			// the space's own site is gone when it is the one we are on: back to the server's landing space, else to the account page
			location.assign(detail.name === spaces.current ? "/" : toRoute("/account"));
		} catch (err) {
			const status = err instanceof ApiError ? err.status : 0;
			if (status === 401) account.expire();
			error = (err instanceof ApiError && err.detail) || t("spaces.archive.failed");
			pending = false;
		}
	}
</script>

<SettingsPanel title={t("spaces.danger")} danger>
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div class="min-w-0 flex-1">
			<h3 class="font-semibold">{t("spaces.archive.title")}</h3>
			<p class="text-muted-foreground mt-1 text-sm">{t("spaces.archive.lead")}</p>
		</div>
		<Button variant="outline" class="text-destructive border-destructive hover:text-destructive" onclick={() => (open = true)}>{t("spaces.archive")}</Button>
	</div>
</SettingsPanel>

<Dialog.Root bind:open title={t("spaces.archive.ask", { name: detail.title || detail.name })} description={t("spaces.archive.text")}>
	{#if detail.readOnly}<p class="bg-note-background text-note-foreground px-3 py-2 text-sm">{t("spaces.archive.keepsReadOnly")}</p>{/if}
	<form id="{uid}-form" onsubmit={archive} class="flex flex-col gap-2">
		<label for="{uid}-confirm" class="text-sm">{t("spaces.archive.type", { name: detail.name })}</label>
		<Input id="{uid}-confirm" bind:value={typed} autocomplete="off" spellcheck={false} aria-describedby="{uid}-error" />
		<p id="{uid}-error" role="alert" class="text-destructive text-sm empty:hidden">{error}</p>
	</form>
	{#snippet actions()}
		<!-- svelte-ignore a11y_autofocus -->
		<Button variant="outline" autofocus onclick={() => (open = false)}>{t("common.cancel")}</Button>
		<Button type="submit" form="{uid}-form" variant="destructive" disabled={typed !== detail.name || pending}>{t("spaces.archive.confirm")}</Button>
	{/snippet}
</Dialog.Root>
