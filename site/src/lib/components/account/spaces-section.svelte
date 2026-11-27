<script lang="ts">
	import { onMount } from "svelte";
	import Icon from "#lib/components/icon.svelte";
	import SpaceBadges from "#lib/components/space-badges.svelte";
	import { Badge } from "#lib/components/ui/badge/index.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import { toRoute } from "#lib/links.js";
	import { labelOf, spaces } from "#lib/spaces.svelte.js";
	import { t } from "#lib/i18n/index.js";

	// "My spaces": every space the visitor may open, in a table (title and slug, what it holds, who can see it, where it is stored,
	// read-only), with "Open" and, for the owners, "Settings". Creating one has its own page. The visibility, members and storage are
	// a member's knowledge (the space's own `GET /api/space`): a space this visitor reads without being a member shows as open.
	const uid = $props.id();
	const rows = $derived(spaces.list);
	onMount(() => { void spaces.ensure(spaces.names); });
	const detailOf = (n: string) => spaces.details[n] ?? undefined;
	const slugUrl = (n: string) => `/s/${n}/`;
</script>

<section aria-labelledby="{uid}-h" class="border-border bg-card shadow-surface border">
	<header class="border-border flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b p-4">
		<div class="min-w-0">
			<h2 id="{uid}-h" class="flex items-center gap-2 text-xl font-semibold tracking-tight"><Icon name="space" size={22} />{t("spaces.mine")}</h2>
			<p aria-live="polite" class="text-muted-foreground mt-0.5 text-sm tabular-nums">{t("spaces.count", { count: rows.length })}</p>
		</div>
		{#if spaces.canCreate}<Button href={toRoute("/account/new")}><Icon name="kind-add" size={16} />{t("spaces.create")}</Button>{/if}
	</header>
	{#if !rows.length}
		<p class="text-muted-foreground p-4 text-sm">{t("spaces.empty.text")}</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full border-collapse text-left text-sm">
				<caption class="sr-only">{t("spaces.table.caption")}</caption>
				<thead class="max-md:sr-only">
					<tr class="bg-secondary text-muted-foreground text-xs">
						<th scope="col" class="px-4 py-3 font-medium">{t("spaces.col.space")}</th>
						<th scope="col" class="px-4 py-3 font-medium">{t("spaces.col.access")}</th>
						<th scope="col" class="px-4 py-3 font-medium">{t("spaces.col.storage")}</th>
						<th scope="col" class="px-4 py-3 font-medium">{t("spaces.col.actions")}</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as space (space.name)}
						{@const d = detailOf(space.name)}
						{@const content = space.content.length ? space.content : (d?.content ?? [])}
						<tr class="border-border border-t max-md:grid max-md:grid-cols-2 max-md:gap-x-2 max-md:p-2">
							<td class="px-4 py-4 align-middle max-md:col-span-full max-md:p-2">
								<a href={slugUrl(space.name)} data-sveltekit-reload class="text-link link-content inline-flex items-center gap-1.5 text-base font-semibold [overflow-wrap:anywhere] underline-offset-4 hover:underline"><Icon name="space" size={18} />{labelOf(space)}</a>
								<span class="text-muted-foreground mt-1 block text-xs">{space.name} · <code>/s/{space.name}/</code></span>
								<span class="mt-1.5 flex flex-wrap gap-1"><SpaceBadges {content} readOnly={space.readOnly || (d?.readOnly ?? false)} current={space.name === spaces.current} /></span>
							</td>
							<td class="px-4 py-4 align-middle max-md:p-2 max-md:before:text-muted-foreground max-md:before:mb-1 max-md:before:block max-md:before:text-xs max-md:before:content-[attr(data-label)]" data-label={t("spaces.col.visibility")}>
								<SpaceBadges visibility={d?.visibility ?? "open"} size="default" />
								<span class="text-muted-foreground mt-1 block text-xs">{d ? (d.visibility === "open" ? t("spaces.people.open") : t("spaces.people.members", { count: d.members.length })) : t("spaces.people.open")}</span>
							</td>
							<td class="px-4 py-4 align-middle max-md:p-2 max-md:before:text-muted-foreground max-md:before:mb-1 max-md:before:block max-md:before:text-xs max-md:before:content-[attr(data-label)]" data-label={t("spaces.col.storage")}>
								{#if d}{d.storage === "own repo" ? t("spaces.storage.repo") : t("spaces.storage.instance")}{:else}<span class="text-muted-foreground">{t("spaces.storage.unknown")}</span>{/if}
							</td>
							<td class="px-4 py-4 align-middle max-md:col-span-full max-md:p-2" data-label={t("spaces.col.actions")}>
								<div class="flex flex-wrap gap-1.5">
									<Button href={slugUrl(space.name)} data-sveltekit-reload variant="outline" size="icon" aria-label={t("spaces.open", { name: labelOf(space) })} title={t("spaces.open", { name: labelOf(space) })}><Icon name="external-link" size={18} /></Button>
									{#if d?.you === "owner"}
										<Button href="{toRoute('/account/settings')}?space={encodeURIComponent(space.name)}" variant="outline" aria-label={t("spaces.settings.of", { name: labelOf(space) })}>{t("spaces.settings")}</Button>
									{:else if d}
										<Badge variant="outline">{t("spaces.role.member")}</Badge>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
	<p class="text-muted-foreground border-border border-t p-4 text-xs">{t("spaces.note")}</p>
</section>
