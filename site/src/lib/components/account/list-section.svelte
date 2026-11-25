<script lang="ts">
	import type { Snippet } from "svelte";
	import Icon from "#lib/components/icon.svelte";
	import type { IconName } from "#lib/icons.js";
	import * as Alert from "#lib/components/ui/alert/index.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Empty from "#lib/components/ui/empty/index.js";
	import { t } from "#lib/i18n/index.js";

	// The shell of a list of the account page (conversations, journeys): a surface with its heading, a count announced in an
	// `aria-live` region that exists from the first render, an optional tool (the search field), and one of the four states:
	// loading, failed (with Retry), empty, or the rows. `focusHeading()` gives the focus back after a deletion removed the
	// row that held it.
	let { heading, icon, status, loading, failed, empty, emptyTitle, emptyText, onretry, tools, children }: {
		heading: string; icon: IconName; status: string; loading: boolean; failed: boolean; empty: boolean; emptyTitle: string; emptyText: string;
		onretry: () => void; tools?: Snippet; children: Snippet;
	} = $props();
	const uid = $props.id();
	let title = $state<HTMLElement | null>(null);
	export const focusHeading = () => title?.focus();
</script>

<section aria-labelledby="{uid}-h" class="border-border bg-card shadow-surface border">
	<header class="border-border flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b p-4">
		<div class="min-w-0">
			<h2 id="{uid}-h" bind:this={title} tabindex="-1" class="flex items-center gap-2 text-xl font-semibold tracking-tight outline-none"><Icon name={icon} size={22} />{heading}</h2>
			<p aria-live="polite" class="text-muted-foreground mt-0.5 text-sm tabular-nums">{status}</p>
		</div>
		{@render tools?.()}
	</header>
	{#if failed}
		<div class="p-4">
			<Alert.Root variant="destructive">
				<Icon name="error" size={16} />
				<Alert.Title>{t("account.loadFailed")}</Alert.Title>
				<Alert.Description class="text-destructive"><Button variant="outline" size="sm" class="mt-2" onclick={onretry}><Icon name="retry" size={16} />{t("common.retry")}</Button></Alert.Description>
			</Alert.Root>
		</div>
	{:else if loading && empty}
		<p class="text-muted-foreground p-4 text-sm"><Icon name="retry" size={16} class="mr-1 inline motion-safe:animate-spin" />{t("account.loading")}</p>
	{:else if empty && emptyTitle}
		<div class="p-4">
			<Empty.Root>
				<Empty.Header>
					<Empty.Media variant="icon"><Icon name={icon} size={20} /></Empty.Media>
					<Empty.Title>{emptyTitle}</Empty.Title>
					<Empty.Description>{emptyText}</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		</div>
	{:else}
		<ul class="divide-border divide-y">{@render children()}</ul>
	{/if}
</section>
