<script lang="ts">
	import { tick } from "svelte";
	import { account } from "#lib/account.svelte.js";
	import { assistant } from "#lib/assistant.svelte.js";
	import { defaultTitle } from "#lib/assistant-session.js";
	import Icon from "#lib/components/icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Dialog from "#lib/components/ui/dialog/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { t } from "#lib/i18n/index.js";
	import type { AssistantFlow } from "./assistant-flow.svelte.js";

	// The dialogs of the assistant's header: the name of a conversation saved for the first time, the invitation to sign in,
	// the confirmation of a new conversation and of a resumed one. They sit beside the panel's own <dialog>, not inside it: the
	// Escape of one must not reach the panel's handler (which closes the docked panel).
	let { flow }: { flow: AssistantFlow } = $props();
	const uid = $props.id();

	// ---- name ----
	let draft = $state(""), pending = $state(false), failed = $state(false), input = $state<HTMLInputElement | null>(null);
	$effect(() => {
		if (!flow.saveOpen) return;
		draft = assistant.saved?.title || defaultTitle();
		failed = false;
		// the name is selected: typing replaces it, Enter keeps it (after the dialog has taken the focus)
		void tick().then(tick).then(() => { input?.focus(); input?.select(); });
	});
	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const title = draft.replace(/\s+/g, " ").trim();
		if (!title || pending) return;
		pending = true; failed = false;
		try { await flow.submitName(title); flow.saveOpen = false; } catch { failed = true; } finally { pending = false; }
	}

	// a choice that closes its dialog first, so that what it starts (another dialog, a new conversation) finds the page free
	const choose = (close: () => void, go: () => void) => () => { close(); go(); };
</script>

<Dialog.Root bind:open={flow.saveOpen} title={t("assistant.saveDialog.title")} description={t("assistant.saveDialog.text")} onclose={() => { flow.cancelSave(); flow.closed(); }}>
	<form id="{uid}-name" onsubmit={submit} class="flex flex-col gap-1.5">
		<label for="{uid}-title" class="text-sm font-medium">{t("assistant.saveDialog.label")}</label>
		<Input id="{uid}-title" bind:ref={input} bind:value={draft} maxlength={120} required autocomplete="off" />
		{#if failed}<p role="alert" class="text-destructive text-sm">{t("assistant.save.failed")}</p>{/if}
	</form>
	{#snippet actions()}
		<Button variant="outline" onclick={() => (flow.saveOpen = false)}>{t("common.cancel")}</Button>
		<Button type="submit" form="{uid}-name" disabled={pending || !draft.trim()}>{t("assistant.saveDialog.confirm")}</Button>
	{/snippet}
</Dialog.Root>

<Dialog.Root bind:open={flow.signInOpen} title={t("assistant.signInDialog.title")} description={t("assistant.signInDialog.text")} onclose={() => flow.closed()}>
	<div class="flex flex-col gap-2">
		{#each account.methods as provider (provider.id)}
			<Button onclick={() => account.signIn(provider.id)}><Icon name="sign-in" size={16} />{t("account.signInWith", { label: provider.label })}</Button>
		{/each}
	</div>
	{#snippet actions()}
		<Button variant="outline" onclick={() => (flow.signInOpen = false)}>{t("common.cancel")}</Button>
	{/snippet}
</Dialog.Root>

<Dialog.Root bind:open={flow.newOpen} title={t("assistant.newDialog.title")} description={account.me ? t("assistant.newDialog.unsaved") : t("assistant.newDialog.anonymous")} onclose={() => flow.closed()}>
	{#snippet actions()}
		<!-- svelte-ignore a11y_autofocus -->
		<Button variant="outline" autofocus onclick={() => (flow.newOpen = false)}>{t("common.cancel")}</Button>
		<Button variant="outline" onclick={choose(() => (flow.newOpen = false), () => flow.reset())}>{t("assistant.new")}</Button>
		{#if account.me}
			<Button onclick={choose(() => (flow.newOpen = false), () => flow.saveAndReset())}>{t("assistant.newDialog.saveFirst")}</Button>
		{:else}
			<Button onclick={choose(() => (flow.newOpen = false), () => void flow.exportAndReset())}>{t("assistant.newDialog.exportFirst")}</Button>
		{/if}
	{/snippet}
</Dialog.Root>

<Dialog.Root bind:open={flow.resumeOpen} title={t("assistant.resumeDialog.title")} description={t("assistant.resumeDialog.text", { title: flow.waiting?.conversation.title ?? "" })} onclose={() => flow.closed()}>
	{#snippet actions()}
		<!-- svelte-ignore a11y_autofocus -->
		<Button variant="outline" autofocus onclick={() => (flow.resumeOpen = false)}>{t("common.cancel")}</Button>
		<Button variant="outline" onclick={choose(() => (flow.resumeOpen = false), () => flow.apply())}>{t("assistant.resumeDialog.discard")}</Button>
		<Button onclick={choose(() => (flow.resumeOpen = false), () => flow.saveAndResume())}>{t("assistant.resumeDialog.saveFirst")}</Button>
	{/snippet}
</Dialog.Root>
