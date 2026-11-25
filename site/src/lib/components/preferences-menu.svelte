<script lang="ts">
	import { onMount, tick } from "svelte";
	import Icon from "#lib/components/icon.svelte";
	import OfflineStatus from "#lib/components/offline-status.svelte";
	import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
	import { account } from "#lib/account.svelte.js";
	import { toRoute } from "#lib/links.js";
	import { theme, type Mode } from "#lib/theme.svelte.js";
	import { lang, type LangChoice } from "#lib/lang.svelte.js";
	import { reading } from "#lib/reading.svelte.js";
	import { defaultLocale, LOCALE_NAMES, t } from "#lib/i18n/index.js";

	// The header's one preferences menu: theme, interface language (never the wiki content), reading comfort and the offline status. On a server
	// with sign-in (account.svelte.ts) it is also the account menu: the button reads "Account" and the menu adds the sign-in
	// methods (signed out) or the identity, the page of the account and "Sign out" (signed in). Where there is no account
	// (static site, server out of reach) nothing of it shows: it stays the preferences menu.
	// Same stores as before (theme.svelte.ts, lang.svelte.ts); the offline section comes from offline-status.svelte, which
	// owns the service worker state. Label visible from wide header widths (@container), icon alone below, the name stays.
	let { class: className = "" }: { class?: string } = $props();
	const uid = $props.id();
	const me = $derived(account.me);
	const label = $derived(account.enabled ? t("account.label") : t("prefs.label"));
	const named = $derived(me ? t("account.named", { name: me.name || t("account.unnamed") }) : label);
	const THEMES = [["system", "system", "theme.option.system"], ["light", "sun", "theme.option.light"], ["dark", "moon", "theme.option.dark"]] as const;

	// Reading comfort (local, off by default): the two options are toggles, the menu stays open to see the effect.
	onMount(() => reading.init());
	const READING = [["reading", "prefs.reading.article"], ["comfort", "prefs.reading.assistant"]] as const;

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
			<DropdownMenu.Trigger variant="outline" data-prefs-trigger class="relative gap-2 px-2 @6xl:px-3 [&_svg:not([class*='size-'])]:size-5 {className}" title={me ? named : label}
				aria-label={me ? (offline ? `${named}, ${t("offline.offline")}` : named) : undefined}>
				<Icon name={account.enabled ? "account" : "system"} size={20} /><span class="sr-only @6xl:not-sr-only">{label}</span>
				{#if attention}<span aria-hidden="true" class="bg-destructive border-background absolute -top-1 -right-1 size-2.5 border"></span>{/if}
				{#if offline}<span class="sr-only">{t("offline.offline")}</span>{/if}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="w-72 max-h-[min(46rem,calc(100dvh-1rem))]">
				{#if me}
					<!-- who is signed in: information, not an action (no menu item role, never takes the focus) -->
					<div role="group" aria-label={t("account.identity")} class="px-2 py-1.5 text-sm">
						<p class="font-semibold break-words">{me.name || t("account.unnamed")}</p>
						{#if me.email}<p class="text-muted-foreground text-xs break-all">{me.email}</p>{/if}
						<p class="text-muted-foreground text-xs">{t("account.via", { provider: account.providerLabel(me.provider) })}</p>
					</div>
					<DropdownMenu.Separator />
				{/if}
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
				<DropdownMenu.Label id="{uid}-reading">{t("prefs.reading")}</DropdownMenu.Label>
				<div role="group" aria-labelledby="{uid}-reading">
					{#each READING as [which, label]}
						{@const checked = which === "reading" ? reading.article : reading.assistant}
						<DropdownMenu.Item role="menuitemcheckbox" aria-checked={checked} closeOnSelect={false} class="pl-8" onSelect={() => (which === "reading" ? reading.setArticle(!checked) : reading.setAssistant(!checked))}>
							{#if checked}<span aria-hidden="true" class="bg-current pointer-events-none absolute left-3 size-2"></span>{/if}
							{t(label)}
						</DropdownMenu.Item>
					{/each}
				</div>
				<DropdownMenu.Separator />
				{@render section()}
				{#if me}
					<DropdownMenu.Separator />
					<DropdownMenu.Item href={toRoute("/account")}><Icon name="account" size={16} />{t("account.mine")}</DropdownMenu.Item>
					<DropdownMenu.Separator />
					<DropdownMenu.Item onSelect={() => void account.signOut()}><Icon name="sign-out" size={16} />{t("account.signOut")}</DropdownMenu.Item>
				{:else if account.methods.length}
					<DropdownMenu.Separator />
					<div role="group" aria-labelledby="{uid}-signin">
						<DropdownMenu.Label id="{uid}-signin">{t("account.signInGroup")}</DropdownMenu.Label>
						{#each account.methods as provider (provider.id)}
							<DropdownMenu.Item onSelect={() => account.signIn(provider.id)}><Icon name="sign-in" size={16} />{t("account.signInWith", { label: provider.label })}</DropdownMenu.Item>
						{/each}
					</div>
				{/if}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	{/snippet}
</OfflineStatus>
