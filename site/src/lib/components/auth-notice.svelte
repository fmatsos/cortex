<script lang="ts">
	import { account } from "#lib/account.svelte.js";
	import Icon from "#lib/components/icon.svelte";
	import * as Alert from "#lib/components/ui/alert/index.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import { t } from "#lib/i18n/index.js";

	// The return of a sign-in that did not open a session (`?auth=refused|error`, read and cleared from the URL by
	// account.takeNotice): one dismissible message under the header. The alert role announces it when it appears.
</script>

{#if account.notice}
	<div class="mx-auto w-full max-w-7xl px-4 pt-4 lg:px-8">
		<Alert.Root variant="destructive" class="pr-14">
			<Icon name="error" size={16} />
			<Alert.Description class="text-destructive">{t(account.notice === "refused" ? "account.notice.refused" : "account.notice.error")}</Alert.Description>
			<Alert.Action><Button variant="ghost" size="icon-sm" aria-label={t("common.closeMessage")} onclick={() => account.dismissNotice()}><Icon name="clear" size={16} /></Button></Alert.Action>
		</Alert.Root>
	</div>
{/if}
