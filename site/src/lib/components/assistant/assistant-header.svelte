<script lang="ts">
	import { account } from "#lib/account.svelte.js";
	import { assistant } from "#lib/assistant.svelte.js";
	import Icon from "#lib/components/icon.svelte";
	import { t } from "#lib/i18n/index.js";
	import type { AssistantFlow } from "./assistant-flow.svelte.js";
	import HeaderAction from "./header-action.svelte";

	// The panel's header: the title with the state of the conversation beneath it, then four square icon buttons
	// (save, export as Markdown, new conversation, close) and, under them, the short message that says what just happened.
	let { flow, onclose }: { flow: AssistantFlow; onclose: () => void } = $props();
	const signedIn = $derived(!!account.me);
	// the state is shown with an account only (without one nothing is saved anywhere) and once there is an exchange to speak of
	const state = $derived(!signedIn || !assistant.complete.length ? "" : assistant.dirty ? "unsaved" : "saved");
</script>

<header class="border-b">
	<div class="flex items-center gap-2 px-4 py-2">
		<div class="min-w-0 flex-1">
			<h2 id="assistant-title" class="truncate text-base leading-tight font-semibold">{t("assistant.title")}</h2>
			<!-- always present, so that a change of its text is announced -->
			<p aria-live="polite" data-conversation-state={state || "none"} class="text-muted-foreground flex min-h-4 items-center gap-1.5 text-xs leading-4">
				{#if state}
					<span aria-hidden="true" class="size-2 shrink-0 {state === 'unsaved' ? 'bg-warning-foreground' : 'bg-muted-foreground'}"></span>
					<span class={state === "unsaved" ? "text-foreground" : ""}>{t(`assistant.state.${state}`)}</span>
				{/if}
			</p>
		</div>
		<div role="group" aria-label={t("assistant.actions")} class="flex shrink-0 items-center">
			{#if account.enabled}
				<HeaderAction icon="save" label={signedIn ? t("assistant.save") : t("assistant.save.signIn")} disabled={!assistant.canSave || flow.busy} onclick={() => flow.save()} />
			{/if}
			<HeaderAction icon="export-markdown" label={t("assistant.export")} disabled={!assistant.canSave} onclick={() => void flow.export()} />
			<HeaderAction icon="new-conversation" label={t("assistant.new")} disabled={!assistant.turns.length || assistant.pending} onclick={() => flow.startNew()} />
			<HeaderAction icon="clear" label={t("assistant.close")} onclick={onclose} />
		</div>
	</div>
	<div aria-live="polite" data-flow-message>
		{#if flow.message}
			<div class="flex items-start gap-2 border-t px-4 py-1.5 text-sm {flow.message.kind === 'error' ? 'bg-warning-background text-warning-foreground' : 'bg-muted'}">
				<Icon name={flow.message.kind === "error" ? "error" : "success"} size={16} class="mt-0.5" />
				<span class="min-w-0 flex-1 break-words">{flow.message.text}</span>
				<button type="button" class="hover:bg-background/60 -mr-2 inline-flex size-6 shrink-0 items-center justify-center pointer-coarse:size-9" aria-label={t("assistant.message.dismiss")} title={t("assistant.message.dismiss")} onclick={() => flow.dismiss()}><Icon name="clear" size={14} /></button>
			</div>
		{/if}
	</div>
</header>
