<script lang="ts">
	import { account } from "#lib/account.svelte.js";
	import { ApiError } from "#lib/api.js";
	import ContentChoices from "#lib/components/account/content-choices.svelte";
	import Icon from "#lib/components/icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Empty from "#lib/components/ui/empty/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { toRoute } from "#lib/links.js";
	import { slugProblem, spaces, type Content } from "#lib/spaces.svelte.js";
	import { t } from "#lib/i18n/index.js";

	// Create a space: a stable address (slug), a display title, what it holds. It is private and its creator is its owner; the server builds
	// its site before it answers, then the visitor is taken to it. Prerendered as an empty shell: everything is known in the browser.
	const uid = $props.id();
	let slug = $state(""), title = $state(""), content = $state<Content[]>(["resources"]);
	let pending = $state(false), error = $state(""), submitted = $state(false), slugTouched = $state(false);
	const taken = $derived([...spaces.names, ...spaces.archived.map((a) => a.name)]);
	const problem = $derived(slug ? slugProblem(slug, taken) : slugTouched ? "invalid" : "");
	const slugError = $derived(problem === "invalid" ? t("spaces.slug.invalid") : problem === "taken" ? t("spaces.slug.taken") : "");

	// the archived names count as taken too (restoring would be refused); they are read once, for whoever may create
	$effect(() => { if (account.me && !spaces.archivedLoaded) void spaces.loadArchived().catch(() => {}); });

	async function create(e: SubmitEvent) {
		e.preventDefault();
		submitted = true; slugTouched = true;
		if (pending || slugProblem(slug, taken) || !content.length) return;
		pending = true; error = "";
		try { location.assign(await spaces.create({ name: slug, title: title.trim() || undefined, content })); }
		catch (err) {
			const status = err instanceof ApiError ? err.status : 0;
			if (status === 401) account.expire();
			error = t(status === 400 ? "spaces.create.invalid" : status === 409 ? "spaces.create.exists" : status === 401 || status === 403 ? "spaces.create.refused" : "spaces.create.failed");
			pending = false;
		}
	}
</script>

<svelte:head><title>{t("spaces.create")} · Cortex</title><meta name="robots" content="noindex" /></svelte:head>

<div class="mx-auto flex max-w-4xl flex-col gap-6">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-3xl font-semibold tracking-tight">{t("spaces.create")}</h1>
			<p class="text-muted-foreground mt-2 text-sm">{t("spaces.create.lead")}</p>
		</div>
		<Button href={toRoute("/account")} variant="outline"><Icon name="back" size={16} />{t("spaces.mine")}</Button>
	</div>

	{#if !account.ready || !spaces.loaded}
		<p class="text-muted-foreground text-sm" role="status"><Icon name="retry" size={16} class="mr-1 inline motion-safe:animate-spin" />{t("account.loading")}</p>
	{:else if account.me && spaces.available && spaces.canCreate}
		<div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
			<form onsubmit={create} novalidate class="border-border bg-card shadow-surface flex flex-col gap-6 border p-4 sm:p-6">
				<div class="flex flex-col gap-2">
					<label for="{uid}-slug" class="text-sm font-semibold">{t("spaces.slug.label")}</label>
					<Input id="{uid}-slug" bind:value={slug} maxlength={40} required autocomplete="off" spellcheck={false} aria-invalid={slugError ? "true" : undefined} aria-describedby="{uid}-slug-hint {uid}-slug-error" onblur={() => (slugTouched = true)} />
					<p id="{uid}-slug-hint" class="text-muted-foreground text-xs">{t("spaces.slug.hint")}</p>
					<p id="{uid}-slug-error" role="alert" class="text-destructive text-sm empty:hidden">{slugError}</p>
				</div>
				<div class="flex flex-col gap-2">
					<label for="{uid}-title" class="text-sm font-semibold">{t("spaces.title.label")}</label>
					<Input id="{uid}-title" bind:value={title} maxlength={120} autocomplete="off" aria-describedby="{uid}-title-hint" />
					<p id="{uid}-title-hint" class="text-muted-foreground text-xs">{t("spaces.title.hint")}</p>
				</div>
				<ContentChoices bind:value={content} invalid={submitted} />
				<div class="flex flex-col gap-2">
					<p class="text-sm font-semibold">{t("spaces.visibility.atCreation")}</p>
					<p class="bg-secondary border-border flex items-center gap-2 border px-3 py-2 text-sm"><Icon name="account" size={18} /><strong>{t("spaces.visibility.private")}</strong><span class="text-muted-foreground ml-auto text-xs">{t("spaces.visibility.onlyYou")}</span></p>
					<p class="text-muted-foreground text-xs">{t("spaces.visibility.notice")}</p>
				</div>
				<div class="flex flex-col gap-2">
					<p class="text-sm font-semibold">{t("spaces.url.label")}</p>
					<output class="bg-secondary border-border border px-3 py-2 text-sm [overflow-wrap:anywhere]" aria-live="polite">/s/<strong>{slug || t("spaces.url.placeholder")}</strong>/</output>
					<p class="text-muted-foreground text-xs">{t("spaces.storage.note")}</p>
				</div>
				<div class="border-border flex flex-wrap items-center justify-end gap-3 border-t pt-4">
					<Button href={toRoute("/account")} variant="outline">{t("common.cancel")}</Button>
					<Button type="submit" disabled={pending}><Icon name="kind-add" size={16} />{t("spaces.create.submit")}</Button>
				</div>
				<p role={error ? "alert" : "status"} class="{error ? 'text-destructive' : 'text-muted-foreground'} text-sm empty:hidden">{pending ? t("spaces.create.pending") : error}</p>
			</form>
			<aside class="bg-secondary border-primary border-t-[3px] p-4 text-sm">
				<h2 class="font-semibold">{t("spaces.create.aside.title")}</h2>
				<p class="text-muted-foreground mt-3">{t("spaces.create.aside.one")}</p>
				<p class="text-muted-foreground mt-3">{t("spaces.create.aside.two")}</p>
			</aside>
		</div>
	{:else}
		<Empty.Root>
			<Empty.Header>
				<Empty.Media variant="icon"><Icon name="space" size={20} /></Empty.Media>
				<Empty.Title>{account.me ? t("spaces.create.denied.title") : t("account.signedOut.title")}</Empty.Title>
				<Empty.Description>{account.me ? t("spaces.create.denied.text") : t("account.signedOut.text")}</Empty.Description>
			</Empty.Header>
		</Empty.Root>
	{/if}
</div>
