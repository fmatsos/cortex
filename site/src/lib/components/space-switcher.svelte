<script lang="ts">
	import { account } from "#lib/account.svelte.js";
	import Icon from "#lib/components/icon.svelte";
	import SpaceBadges from "#lib/components/space-badges.svelte";
	import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
	import { toRoute } from "#lib/links.js";
	import { labelOf, spaces } from "#lib/spaces.svelte.js";
	import { t } from "#lib/i18n/index.js";

	// The space the visitor is in, and a menu to go to another one (a `cortex serve` of several spaces only: `/api/spaces`
	// answers) for a signed-in visitor: the title is the main label, the slug the secondary one. Hidden when there is nothing to
	// choose: one space and no right to create another. Creating and managing are on the account page.
	const shown = $derived(account.me !== null && spaces.available && !!spaces.info && (spaces.list.length > 1 || spaces.canCreate));
	const here = $derived(spaces.info);
	// the visibility and the members are read from each space when the menu opens (a member only: the others are open to this visitor)
	const detailOf = (name: string) => spaces.details[name] ?? undefined;
	const people = (name: string) => { const d = detailOf(name); return !d ? "" : d.visibility === "open" ? t("spaces.people.open") : t("spaces.people.members", { count: d.members.length }); };
</script>

{#if shown && here}
	<DropdownMenu.Root onOpenChange={(open) => { if (open) void spaces.ensure(spaces.names); }}>
		<DropdownMenu.Trigger variant="outline" class="max-w-[11rem] gap-2 pl-3 px-2 shadow-[inset_3px_0_var(--primary)] [&_svg:not([class*='size-'])]:size-5" title="{labelOf(here)} · {here.name}" aria-label={t("spaces.switch.current", { title: labelOf(here), name: here.name })}>
			<Icon name="space" size={20} /><span class="min-w-0 truncate font-semibold">{labelOf(here)}</span><Icon name="chevron-down" size={16} />
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="start" class="w-80 max-w-[calc(100vw-2rem)]">
			<DropdownMenu.Label class="border-border border-b pb-2">{t("spaces.label")}<span class="text-muted-foreground block text-xs font-normal">{t("spaces.menu.hint")}</span></DropdownMenu.Label>
			{#each spaces.list as space (space.name)}
				{@const d = detailOf(space.name)}
				<!-- another space is another static site (its own base path): a full page load, never client-side routing -->
				<DropdownMenu.Item href="/s/{space.name}/" data-sveltekit-reload aria-current={space.name === here.name ? "true" : undefined} title={labelOf(space)}
					class="h-auto items-start gap-3 border-l-[3px] py-2.5 {space.name === here.name ? 'border-l-primary bg-accent text-accent-foreground' : 'border-l-transparent'}">
					<Icon name={(space.content.length ? space.content : (d?.content ?? [])).includes("notes") ? "journal" : "space"} size={20} class="mt-0.5 shrink-0" />
					<span class="flex min-w-0 flex-1 flex-col gap-0.5">
						<span class="truncate font-semibold">{labelOf(space)}</span>
						<span class="text-muted-foreground truncate text-xs">{space.name}{#if people(space.name)}{" · "}{people(space.name)}{/if}</span>
						<span class="mt-0.5 flex flex-wrap gap-1"><SpaceBadges content={space.content.length ? space.content : (d?.content ?? [])} readOnly={space.readOnly || (d?.readOnly ?? false)} /></span>
					</span>
					<span class="flex shrink-0 flex-col items-end gap-1">
						{#if d}<SpaceBadges visibility={d.visibility} />{/if}
						{#if space.name === here.name}<Icon name="success" size={16} /><span class="sr-only">{t("spaces.current")}</span>{/if}
					</span>
				</DropdownMenu.Item>
			{/each}
			<DropdownMenu.Separator />
			{#if spaces.canCreate}
				<DropdownMenu.Item href={toRoute("/account/new")}><Icon name="kind-add" size={16} />{t("spaces.create")}</DropdownMenu.Item>
			{/if}
			<DropdownMenu.Item href={toRoute("/account")}><Icon name="account" size={16} />{t("spaces.manage")}</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/if}
