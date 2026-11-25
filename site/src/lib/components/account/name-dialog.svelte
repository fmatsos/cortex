<script lang="ts">
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Dialog from "#lib/components/ui/dialog/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { t } from "#lib/i18n/index.js";

	// Renames a saved item: one field, Enter saves, Escape cancels. `onsave` returns when the server accepted the title;
	// when it throws the dialog stays open and says so.
	let { open = $bindable(false), heading, value, onsave }: { open?: boolean; heading: string; value: string; onsave: (title: string) => Promise<void> } = $props();
	const uid = $props.id();
	let draft = $state(""), pending = $state(false), failed = $state(false);
	$effect(() => { if (open) { draft = value; failed = false; } });

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const title = draft.replace(/\s+/g, " ").trim();
		if (!title || pending) return;
		pending = true; failed = false;
		try { await onsave(title); open = false; } catch { failed = true; } finally { pending = false; }
	}
</script>

<Dialog.Root bind:open title={heading}>
	<form id="{uid}-form" onsubmit={submit} class="flex flex-col gap-1.5">
		<label for="{uid}-title" class="text-sm font-medium">{t("account.rename.label")}</label>
		<Input id="{uid}-title" bind:value={draft} maxlength={120} required autocomplete="off" />
		{#if failed}<p role="alert" class="text-destructive text-sm">{t("account.rename.failed")}</p>{/if}
	</form>
	{#snippet actions()}
		<Button variant="outline" onclick={() => (open = false)}>{t("common.cancel")}</Button>
		<Button type="submit" form="{uid}-form" disabled={pending || !draft.trim()}>{t("account.rename.save")}</Button>
	{/snippet}
</Dialog.Root>
