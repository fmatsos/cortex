<script lang="ts">
	import { ApiError } from "#lib/api.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Dialog from "#lib/components/ui/dialog/index.js";
	import { t } from "#lib/i18n/index.js";

	// Confirmation of a destructive action. The focus starts on Cancel. `onconfirm` returns when it is done (the dialog closes);
	// when it throws the dialog stays open and shows `failure`, or the server's own message when it refused with one (a 409 that explains itself).
	let { open = $bindable(false), heading, text, confirm, failure, onconfirm, onclose }: {
		open?: boolean; heading: string; text: string; confirm: string; failure: string; onconfirm: () => Promise<void>; onclose?: () => void;
	} = $props();
	let pending = $state(false), failed = $state(""); // the message shown, "" when nothing failed
	$effect(() => { if (open) failed = ""; });

	async function run() {
		if (pending) return;
		pending = true; failed = "";
		try { await onconfirm(); open = false; } catch (e) { failed = (e instanceof ApiError && e.status === 409 && e.detail) || failure; } finally { pending = false; }
	}
</script>

<Dialog.Root bind:open title={heading} description={text} {onclose}>
	{#if failed}<p role="alert" class="text-destructive text-sm">{failed}</p>{/if}
	{#snippet actions()}
		<!-- svelte-ignore a11y_autofocus -->
		<Button variant="outline" autofocus onclick={() => (open = false)}>{t("common.cancel")}</Button>
		<Button variant="destructive" disabled={pending} onclick={run}>{confirm}</Button>
	{/snippet}
</Dialog.Root>
