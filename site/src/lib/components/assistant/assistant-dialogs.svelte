<script lang="ts">
	import { account } from "#lib/account.svelte.js";
	import { assistant } from "#lib/assistant.svelte.js";
	import { defaultTitle } from "#lib/assistant-session.js";
	import NameDialog from "#lib/components/account/name-dialog.svelte";
	import SignInDialog from "#lib/components/account/sign-in-dialog.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Dialog from "#lib/components/ui/dialog/index.js";
	import { t } from "#lib/i18n/index.js";
	import type { AssistantFlow } from "./assistant-flow.svelte.js";

	// The dialogs of the assistant's header: the name of a conversation saved for the first time, the invitation to sign in,
	// the confirmation of a new conversation and of a resumed one. They sit beside the panel's own <dialog>, not inside it: the
	// Escape of one must not reach the panel's handler (which closes the docked panel).
	let { flow }: { flow: AssistantFlow } = $props();

	// a choice that closes its dialog first, so that what it starts (another dialog, a new conversation) finds the page free
	const choose = (close: () => void, go: () => void) => () => { close(); go(); };
</script>

<NameDialog bind:open={flow.saveOpen} heading={t("assistant.saveDialog.title")} description={t("assistant.saveDialog.text")} label={t("assistant.saveDialog.label")} confirm={t("assistant.saveDialog.confirm")} failure={t("assistant.save.failed")}
	value={assistant.saved?.title || defaultTitle()} onsave={(title) => flow.submitName(title)} onclose={() => { flow.cancelSave(); flow.closed(); }} />

<SignInDialog bind:open={flow.signInOpen} heading={t("assistant.signInDialog.title")} text={t("assistant.signInDialog.text")} onclose={() => flow.closed()} />

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
