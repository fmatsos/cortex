<script lang="ts">
	import { account } from "#lib/account.svelte.js";
	import { ApiError } from "#lib/api.js";
	import ContentChoices from "#lib/components/account/content-choices.svelte";
	import SettingsPanel from "#lib/components/account/settings-panel.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { spaces, type Content, type SpaceDetail } from "#lib/spaces.svelte.js";
	import { t } from "#lib/i18n/index.js";

	// Title (editable, the address does not change), slug (read-only: it is the folder, the URL and the key of what the browser keeps),
	// and what the space holds. Only what changed is sent.
	let { detail, onchange }: { detail: SpaceDetail; onchange: (d: SpaceDetail) => void } = $props();
	const uid = $props.id();
	// svelte-ignore state_referenced_locally
	let title = $state(detail.title ?? ""), content = $state<Content[]>([...detail.content]);
	let pending = $state(false), error = $state(""), saved = $state(""), submitted = $state(false);

	async function save(e: SubmitEvent) {
		e.preventDefault();
		submitted = true; saved = ""; error = "";
		if (pending || !content.length) return;
		const patch: { title?: string | null; content?: Content[] } = {};
		const next = title.replace(/\s+/g, " ").trim();
		if (next !== (detail.title ?? "")) patch.title = next || null;
		if (content.join() !== detail.content.join()) patch.content = content;
		if (!Object.keys(patch).length) { saved = t("spaces.settings.unchanged"); return; }
		pending = true;
		try {
			const d = await spaces.setSettings(detail.name, patch);
			if (d) { onchange(d); title = d.title ?? ""; content = [...d.content]; }
			if (detail.name === spaces.current) await spaces.load();
			saved = t("spaces.settings.saved");
		} catch (err) {
			const status = err instanceof ApiError ? err.status : 0;
			if (status === 401) account.expire();
			error = (err instanceof ApiError && err.detail) || t("spaces.settings.failed");
		} finally { pending = false; }
	}
</script>

<SettingsPanel title={t("spaces.settings.identity")}>
	<form onsubmit={save} novalidate class="flex flex-col gap-6">
		<div class="flex flex-col gap-2">
			<label for="{uid}-title" class="text-sm font-semibold">{t("spaces.title.label")}</label>
			<Input id="{uid}-title" bind:value={title} maxlength={120} autocomplete="off" aria-describedby="{uid}-title-hint" />
			<p id="{uid}-title-hint" class="text-muted-foreground text-xs">{t("spaces.title.used")}</p>
		</div>
		<div class="flex flex-col gap-2">
			<label for="{uid}-slug" class="text-sm font-semibold">{t("spaces.slug.readonly")}</label>
			<Input id="{uid}-slug" value="{detail.name} · /s/{detail.name}/" readonly aria-describedby="{uid}-slug-hint" />
			<p id="{uid}-slug-hint" class="text-muted-foreground text-xs">{t("spaces.slug.immutable")}</p>
		</div>
		<ContentChoices bind:value={content} invalid={submitted} />
		<div class="border-border flex flex-wrap items-center justify-end gap-3 border-t pt-4">
			<p role={error ? "alert" : "status"} class="{error ? 'text-destructive' : 'text-muted-foreground'} mr-auto text-sm empty:hidden">{error || saved}</p>
			<Button type="submit" disabled={pending}>{t("common.save")}</Button>
		</div>
	</form>
</SettingsPanel>
