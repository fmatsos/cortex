<script lang="ts">
	import { tick, untrack } from "svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Dialog from "#lib/components/ui/dialog/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { t } from "#lib/i18n/index.js";

	// The name of a saved item, in one field (120 characters at most): renaming one on the account page, naming a conversation
	// or a journey the first time it is saved. The name is selected when the dialog opens: typing replaces it, Enter keeps it.
	// `onsave` returns when the server accepted the name; when it throws the dialog stays open and says so. Escape cancels.
	// The defaults are those of a rename; a first save gives its own text, label, button and failure message.
	let { open = $bindable(false), heading, description, label, confirm, failure, value, onsave, onclose }: {
		open?: boolean; heading: string; description?: string; label?: string; confirm?: string; failure?: string; value: string;
		onsave: (title: string) => Promise<void>; onclose?: () => void;
	} = $props();
	const uid = $props.id();
	let draft = $state(""), pending = $state(false), failed = $state(false), input = $state<HTMLInputElement | null>(null);
	$effect(() => {
		if (!open) return;
		draft = untrack(() => value);
		failed = false;
		// after the dialog has taken the focus
		void tick().then(tick).then(() => { input?.focus(); input?.select(); });
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const title = draft.replace(/\s+/g, " ").trim();
		if (!title || pending) return;
		pending = true; failed = false;
		try { await onsave(title); open = false; } catch { failed = true; } finally { pending = false; }
	}
</script>

<Dialog.Root bind:open title={heading} {description} {onclose}>
	<form id="{uid}-form" onsubmit={submit} class="flex flex-col gap-1.5">
		<label for="{uid}-title" class="text-sm font-medium">{label ?? t("account.rename.label")}</label>
		<Input id="{uid}-title" bind:ref={input} bind:value={draft} maxlength={120} required autocomplete="off" />
		{#if failed}<p role="alert" class="text-destructive text-sm">{failure ?? t("account.rename.failed")}</p>{/if}
	</form>
	{#snippet actions()}
		<Button variant="outline" onclick={() => (open = false)}>{t("common.cancel")}</Button>
		<Button type="submit" form="{uid}-form" disabled={pending || !draft.trim()}>{confirm ?? t("account.rename.save")}</Button>
	{/snippet}
</Dialog.Root>
