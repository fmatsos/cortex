<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
	import { toRoute } from "#lib/links.js";
	import { spaces } from "#lib/spaces.svelte.js";
	import { t } from "#lib/i18n/index.js";

	// The space the visitor is in, and a menu to go to another one (a `cortex serve` of several spaces only: `/api/spaces`
	// answers). Hidden when there is nothing to choose: one space and no right to create another. Creating is on the account page.
	const shown = $derived(spaces.available && (spaces.names.length > 1 || spaces.canCreate));
</script>

{#if shown}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger variant="outline" class="gap-2 px-2 [&_svg:not([class*='size-'])]:size-5" title={t("spaces.switch")} aria-label="{t('spaces.switch')}: {spaces.current}">
			<Icon name="space" size={20} /><span class="max-w-32 truncate">{spaces.current}</span><Icon name="chevron-down" size={16} />
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="start" class="w-56">
			<DropdownMenu.Label>{t("spaces.label")}</DropdownMenu.Label>
			{#each spaces.names as name (name)}
				<!-- another space is another static site (its own base path): a full page load, never client-side routing -->
				<DropdownMenu.Item href="/s/{name}/" data-sveltekit-reload aria-current={name === spaces.current ? "true" : undefined} class={name === spaces.current ? "font-semibold" : ""}>
					<Icon name="space" size={16} /><span class="truncate">{name}</span>
				</DropdownMenu.Item>
			{/each}
			{#if spaces.canCreate}
				<DropdownMenu.Separator />
				<DropdownMenu.Item href={toRoute("/account")}>{t("spaces.manage")}</DropdownMenu.Item>
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/if}
