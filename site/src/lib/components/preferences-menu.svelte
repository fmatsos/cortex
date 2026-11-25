<script lang="ts">
	import { tick } from "svelte";
	import Icon from "#lib/components/icon.svelte";
	import OfflineStatus from "#lib/components/offline-status.svelte";
	import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
	import { theme, type Mode } from "#lib/theme.svelte.js";
	import { lang, type LangChoice } from "#lib/lang.svelte.js";
	import { defaultLocale, LOCALE_NAMES, t } from "#lib/i18n/index.js";

	// The header's one preferences menu: theme, interface language (never the wiki content) and the offline status.
	// Same stores as before (theme.svelte.ts, lang.svelte.ts); the offline section comes from offline-status.svelte, which
	// owns the service worker state. Label visible from wide header widths (@container), icon alone below, the name stays.
	let { class: className = "" }: { class?: string } = $props();
	const uid = $props.id();
	const THEMES = [["system", "system", "theme.option.system"], ["light", "sun", "theme.option.light"], ["dark", "moon", "theme.option.dark"]] as const;

	// Changing the language re-renders the whole layout (`{#key lang.current}`), trigger included: the focus is given back
	// to the new one once it exists.
	async function pickLang() {
		await tick();
		document.querySelector<HTMLElement>("[data-prefs-trigger]")?.focus();
	}
</script>

<OfflineStatus>
	{#snippet children({ section, refresh, offline, attention })}
		<DropdownMenu.Root onOpenChange={(open) => { if (open) refresh(); }}>
			<DropdownMenu.Trigger variant="outline" data-prefs-trigger class="relative gap-2 px-2 @6xl:px-3 [&_svg:not([class*='size-'])]:size-5 {className}" title={t("prefs.label")}>
				<Icon name="system" size={20} /><span class="sr-only @6xl:not-sr-only">{t("prefs.label")}</span>
				{#if attention}<span aria-hidden="true" class="bg-destructive border-background absolute -top-1 -right-1 size-2.5 border"></span>{/if}
				{#if offline}<span class="sr-only">{t("offline.offline")}</span>{/if}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="w-72 max-h-[min(36rem,calc(100dvh-1rem))]">
				<DropdownMenu.Label id="{uid}-theme">{t("theme.label")}</DropdownMenu.Label>
				<DropdownMenu.RadioGroup aria-labelledby="{uid}-theme" value={theme.mode} onValueChange={(v) => theme.set(v as Mode)}>
					{#each THEMES as [mode, icon, label]}
						<DropdownMenu.RadioItem value={mode}><Icon name={icon} size={16} />{t(label)}</DropdownMenu.RadioItem>
					{/each}
				</DropdownMenu.RadioGroup>
				<DropdownMenu.Separator />
				<DropdownMenu.Label id="{uid}-lang">{t("lang.label")}</DropdownMenu.Label>
				<DropdownMenu.RadioGroup aria-labelledby="{uid}-lang" value={lang.choice} onValueChange={(v) => lang.set(v as LangChoice)}>
					<DropdownMenu.RadioItem value="system" onSelect={pickLang}>{t("lang.default", { name: LOCALE_NAMES[defaultLocale] })}</DropdownMenu.RadioItem>
					<DropdownMenu.RadioItem value="en" lang="en" onSelect={pickLang}>{LOCALE_NAMES.en}</DropdownMenu.RadioItem>
					<DropdownMenu.RadioItem value="fr" lang="fr" onSelect={pickLang}>{LOCALE_NAMES.fr}</DropdownMenu.RadioItem>
				</DropdownMenu.RadioGroup>
				<DropdownMenu.Separator />
				{@render section()}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	{/snippet}
</OfflineStatus>
