<script lang="ts">
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Dialog from "#lib/components/ui/dialog/index.js";
	import { t } from "#lib/i18n/index.js";

	// Confirmation of a destructive action. The focus starts on Cancel. `onconfirm` returns when it is done (the dialog closes);
	// when it throws the dialog stays open and shows `failure`.
	let { open = $bindable(false), heading, text, confirm, failure, onconfirm, onclose }: {
		open?: boolean; heading: string; text: string; confirm: string; failure: string; onconfirm: () => Promise<void>; onclose?: () => void;
	} = $props();
	let pending = $state(false), failed = $state(false);
	$effect(() => { if (open) failed = false; });

	async function run() {
		if (pending) return;
		pending = true; failed = false;
		try { await onconfirm(); open = false; } catch { failed = true; } finally { pending = false; }
	}
</script>

<Dialog.Root bind:open title={heading} description={text} {onclose}>
	{#if failed}<p role="alert" class="text-destructive text-sm">{failure}</p>{/if}
	{#snippet actions()}
		<!-- svelte-ignore a11y_autofocus -->
		<Button variant="outline" autofocus onclick={() => (open = false)}>{t("common.cancel")}</Button>
		<Button variant="destructive" disabled={pending} onclick={run}>{confirm}</Button>
	{/snippet}
</Dialog.Root>
