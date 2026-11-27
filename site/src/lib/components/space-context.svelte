<script lang="ts">
	import { account } from "#lib/account.svelte.js";
	import Icon from "#lib/components/icon.svelte";
	import SpaceBadges from "#lib/components/space-badges.svelte";
	import { toRoute } from "#lib/links.js";
	import { labelOf, spaces } from "#lib/spaces.svelte.js";
	import { t } from "#lib/i18n/index.js";

	// The context bar of a space (`cortex serve` of several spaces): which space this page belongs to, what it holds, and, when
	// it is read-only, why the writing actions are off. Absent on a static site and on a server of one space.
	const here = $derived(spaces.available ? spaces.info : undefined);
	// open or private is a member's knowledge (the detail of the space): read for the current space once it is shown
	$effect(() => { if (here && account.me) void spaces.ensure([here.name]); });
	const detail = $derived(here ? spaces.details[here.name] : undefined);
</script>

{#if here}
	<div class="border-border/60 border-b">
		<div class="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-xs lg:px-8">
			<nav aria-label={t("spaces.context")} class="text-muted-foreground flex min-w-0 items-center gap-1.5">
				<Icon name="space" size={16} />
				<a href={toRoute("/")} class="hover:text-foreground min-w-0 truncate underline-offset-4 hover:underline">{labelOf(here)}</a>
				<span aria-hidden="true">·</span><span class="truncate">{here.name}</span>
			</nav>
			<span class="ml-auto flex flex-wrap gap-1.5 max-sm:ml-0 max-sm:w-full"><SpaceBadges content={here.content} visibility={detail?.visibility} readOnly={here.readOnly} /></span>
		</div>
		{#if here.readOnly}
			<p id="read-only-reason" role="note" class="bg-note-background text-note-foreground border-border/60 border-t">
				<span class="mx-auto block max-w-7xl px-4 py-2 text-sm lg:px-8">{t("spaces.readOnly.reason")} {t("spaces.readOnly.kept")}</span>
			</p>
		{/if}
	</div>
{/if}
