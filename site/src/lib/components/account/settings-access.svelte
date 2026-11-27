<script lang="ts">
	import { account } from "#lib/account.svelte.js";
	import { ApiError } from "#lib/api.js";
	import ConfirmDialog from "#lib/components/account/confirm-dialog.svelte";
	import SettingsPanel from "#lib/components/account/settings-panel.svelte";
	import { Badge } from "#lib/components/ui/badge/index.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import { spaces, type SpaceDetail } from "#lib/spaces.svelte.js";
	import { t } from "#lib/i18n/index.js";

	// Who may see the space (open: everyone, no member; private: its members, a 404 for anyone else), whether it accepts writes
	// (read-only: visible and searchable, no note, source, compilation or validation; favorites and journeys stay) and where it is
	// stored (set from the command line, never from here). Changing the visibility asks for a confirmation: it changes who can read.
	let { detail, onchange }: { detail: SpaceDetail; onchange: (d: SpaceDetail) => void } = $props();
	const uid = $props.id();
	// svelte-ignore state_referenced_locally
	let visibility = $state<"open" | "private">(detail.visibility), readOnly = $state(detail.readOnly), confirmOpen = $state(false);
	let roError = $state(""), roSaved = $state(""), roPending = $state(false);
	$effect(() => { visibility = detail.visibility; readOnly = detail.readOnly; });

	async function apply(patch: { visibility?: "open" | "private"; read_only?: boolean }) {
		const d = await spaces.setSettings(detail.name, patch);
		if (d) onchange(d);
		if (detail.name === spaces.current) await spaces.load();
	}
	async function saveReadOnly(e: SubmitEvent) {
		e.preventDefault();
		if (roPending) return;
		roPending = true; roError = ""; roSaved = "";
		try { await apply({ read_only: readOnly }); roSaved = t(readOnly ? "spaces.readOnly.on" : "spaces.readOnly.off"); }
		catch (err) { if (err instanceof ApiError && err.status === 401) account.expire(); roError = (err instanceof ApiError && err.detail) || t("spaces.settings.failed"); }
		finally { roPending = false; }
	}
</script>

<SettingsPanel title={t("spaces.visibility.title")}>
	<fieldset class="flex flex-col gap-2">
		<legend class="mb-1 text-sm font-semibold">{t("spaces.visibility.who")}</legend>
		<div class="grid gap-3 sm:grid-cols-2">
			{#each ["private", "open"] as const as v (v)}
				<label class="has-[:checked]:bg-accent has-[:checked]:text-accent-foreground has-[:checked]:border-primary border-input flex cursor-pointer items-start gap-2.5 border p-3">
					<input type="radio" name="{uid}-visibility" value={v} bind:group={visibility} class="accent-primary mt-1 size-4 shrink-0" />
					<span><strong class="block text-sm">{t(v === "private" ? "spaces.visibility.private" : "spaces.visibility.open")}</strong><small class="text-muted-foreground mt-1 block text-xs">{t(v === "private" ? "spaces.visibility.private.hint" : "spaces.visibility.open.hint")}</small></span>
				</label>
			{/each}
		</div>
		<p class="text-muted-foreground text-xs">{detail.visibility === "open" ? t("spaces.visibility.now.open") : t("spaces.visibility.now.private")}</p>
	</fieldset>
	<div class="border-border mt-4 flex justify-end border-t pt-4"><Button variant="outline" disabled={visibility === detail.visibility} onclick={() => (confirmOpen = true)}>{t("spaces.visibility.apply")}</Button></div>
</SettingsPanel>

<ConfirmDialog bind:open={confirmOpen} heading={t(visibility === "open" ? "spaces.visibility.confirm.open" : "spaces.visibility.confirm.private", { name: detail.title || detail.name })} text={t(visibility === "open" ? "spaces.visibility.confirm.open.text" : "spaces.visibility.confirm.private.text")} confirm={t("spaces.visibility.confirm")} failure={t("spaces.settings.failed")} onconfirm={() => apply({ visibility })} />

<SettingsPanel title={t("spaces.readOnly")}>
	{#snippet aside()}{#if detail.readOnly}<Badge variant="caution" size="sm">{t("spaces.readOnly")}</Badge>{/if}{/snippet}
	<form onsubmit={saveReadOnly} class="flex flex-col gap-2">
		<label class="flex items-center gap-2 text-sm font-semibold" for="{uid}-ro"><input id="{uid}-ro" type="checkbox" role="switch" bind:checked={readOnly} aria-describedby="{uid}-ro-text" class="accent-primary size-4" />{t("spaces.readOnly")}</label>
		<p id="{uid}-ro-text" class="text-muted-foreground text-sm">{t("spaces.readOnly.explain")}</p>
		<p class="text-muted-foreground text-xs">{t("spaces.readOnly.independent")}</p>
		<div class="border-border mt-2 flex flex-wrap items-center justify-end gap-3 border-t pt-4">
			<p role={roError ? "alert" : "status"} class="{roError ? 'text-destructive' : 'text-muted-foreground'} mr-auto text-sm empty:hidden">{roError || roSaved}</p>
			<Button type="submit" variant="outline" disabled={roPending || readOnly === detail.readOnly}>{t("spaces.readOnly.save")}</Button>
		</div>
	</form>
</SettingsPanel>

<SettingsPanel title={t("spaces.storage.title")}>
	{#snippet aside()}<Badge variant="outline" size="sm">{t("spaces.storage.cli")}</Badge>{/snippet}
	<p class="text-sm font-semibold">{detail.storage === "own repo" ? t("spaces.storage.repo") : t("spaces.storage.instance")}</p>
	{#if detail.storage === "instance"}<p class="text-muted-foreground mt-1 text-sm"><code>spaces/{detail.name}/</code></p>{/if}
	<p class="text-muted-foreground mt-3 text-xs">{t("spaces.storage.readonly")}</p>
</SettingsPanel>
