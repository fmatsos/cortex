<script lang="ts">
	import { account } from "#lib/account.svelte.js";
	import { compile } from "#lib/compile.svelte.js";
	import Icon from "#lib/components/icon.svelte";
	import * as Alert from "#lib/components/ui/alert/index.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import { spaces } from "#lib/spaces.svelte.js";
	import { t } from "#lib/i18n/index.js";

	// "Compile the queue" (the entry of the account menu, preferences-menu.svelte): where its progress and its result are told, so they stay in
	// view when the menu closes. A signed-in visitor of a space that is not read-only asks the server once whether they may start a compile
	// (`cortex serve`, a member of the space: anything else answers 401, 403 or 404 and nothing shows). The live region is always in the DOM
	// (its changes are announced: one at the start, one per source done, one at the end); the visible message is a plain group under the header.
	$effect(() => { if (account.me && spaces.loaded && !spaces.readOnly) void compile.probe(); });
	const summary = $derived(compile.summary);
	const failed = $derived(!!compile.error || (summary?.failed ?? 0) > 0);
</script>

<span class="sr-only" role="status" aria-live="polite" aria-atomic="true">{compile.announce}</span>

{#if compile.available && (compile.running || summary || compile.error)}
	<div class="mx-auto w-full max-w-7xl px-4 pt-4 lg:px-8" data-compile-notice={compile.running ? "running" : "done"}>
		<Alert.Root role="group" aria-label={t("compile.title")} variant={failed && !compile.running ? "destructive" : "default"} class="pr-14">
			<Icon name={compile.running ? "generated" : failed ? "error" : "success"} size={16} />
			<Alert.Description class={failed && !compile.running ? "text-destructive" : ""}>
				{#if compile.running}
					{compile.progress}
				{:else if compile.error}
					{compile.error}
				{:else if summary}
					{t("compile.summary", { done: summary.done, failed: summary.failed })}
					{#if summary.lastError}<span class="mt-1 block break-words text-xs">{summary.lastError}</span>{/if}
				{/if}
			</Alert.Description>
			{#if !compile.running}
				<Alert.Action><Button variant="ghost" size="icon-sm" aria-label={t("common.closeMessage")} onclick={() => compile.dismiss()}><Icon name="clear" size={16} /></Button></Alert.Action>
			{/if}
		</Alert.Root>
	</div>
{/if}
