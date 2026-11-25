<script lang="ts">
	import { account } from "#lib/account.svelte.js";
	import Icon from "#lib/components/icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Dialog from "#lib/components/ui/dialog/index.js";
	import { t } from "#lib/i18n/index.js";

	// The invitation to sign in that a feature of the account gives (save a conversation, save a journey): one button per
	// provider the server offers. The server brings the visitor back to the page they are on, query included.
	let { open = $bindable(false), heading, text, onclose }: { open?: boolean; heading: string; text: string; onclose?: () => void } = $props();
</script>

<Dialog.Root bind:open title={heading} description={text} {onclose}>
	<div class="flex flex-col gap-2">
		{#each account.methods as provider (provider.id)}
			<Button onclick={() => account.signIn(provider.id)}><Icon name="sign-in" size={16} />{t("account.signInWith", { label: provider.label })}</Button>
		{/each}
	</div>
	{#snippet actions()}
		<Button variant="outline" onclick={() => (open = false)}>{t("common.cancel")}</Button>
	{/snippet}
</Dialog.Root>
