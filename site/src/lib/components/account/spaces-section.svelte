<script lang="ts">
	import { ApiError } from "#lib/api.js";
	import { account } from "#lib/account.svelte.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import * as NativeSelect from "#lib/components/ui/native-select/index.js";
	import { t } from "#lib/i18n/index.js";
	import { spaces } from "#lib/spaces.svelte.js";
	import ListSection from "./list-section.svelte";
	import RowAction from "./row-action.svelte";
	import Row from "./row.svelte";

	// The spaces the visitor can open (`GET /api/spaces`), and a small form to create one (private to them). The server builds the
	// new space's site before it answers: the visitor is then taken to it.
	const uid = $props.id();
	let name = $state(""), kind = $state<"" | "notes">(""), pending = $state(false), error = $state("");

	async function create(e: SubmitEvent) {
		e.preventDefault();
		if (pending || !name) return;
		pending = true; error = "";
		try { location.assign(await spaces.create(name, kind || undefined)); }
		catch (err) {
			const status = err instanceof ApiError ? err.status : 0;
			if (status === 401) account.expire();
			error = t(status === 400 ? "spaces.create.invalid" : status === 409 ? "spaces.create.exists" : status === 401 || status === 403 ? "spaces.create.refused" : "spaces.create.failed");
			pending = false;
		}
	}
</script>

<ListSection heading={t("spaces.label")} icon="space" status={t("spaces.count", { count: spaces.names.length })} loading={false} failed={false} empty={!spaces.names.length} emptyTitle={t("spaces.empty.title")} emptyText={t("spaces.empty.text")} onretry={() => void spaces.load()}>
	{#snippet tools()}
		{#if spaces.canCreate}
			<form onsubmit={create} class="flex flex-col gap-1.5">
				<label for="{uid}-name" class="text-sm font-medium">{t("spaces.create")}</label>
				<div class="flex flex-wrap items-end gap-2">
					<Input id="{uid}-name" bind:value={name} pattern="[a-z0-9][a-z0-9\-]*" maxlength={40} required autocomplete="off" spellcheck={false} aria-describedby="{uid}-hint" class="w-48" />
					<div class="flex flex-col gap-1.5">
						<label for="{uid}-kind" class="text-sm font-medium">{t("spaces.create.kind")}</label>
						<NativeSelect.Root id="{uid}-kind" bind:value={kind}>
							<NativeSelect.Option value="">{t("spaces.create.kind.watch")}</NativeSelect.Option>
							<NativeSelect.Option value="notes">{t("spaces.create.kind.notes")}</NativeSelect.Option>
						</NativeSelect.Root>
					</div>
					<Button type="submit" disabled={pending || !name}>{t("spaces.create.submit")}</Button>
				</div>
				<p id="{uid}-hint" class="text-muted-foreground text-xs">{t("spaces.create.hint")}</p>
				<p role={error ? "alert" : "status"} class="{error ? 'text-destructive' : 'text-muted-foreground'} text-sm">{pending ? t("spaces.create.pending") : error}</p>
			</form>
		{/if}
	{/snippet}
	{#each spaces.names as space (space)}
		<Row title={space}>
			{#snippet meta()}{space === spaces.current ? t("spaces.current") : ""}{/snippet}
			{#snippet actions()}
				<RowAction icon="space" href="/s/{space}/" label={t("spaces.open", { name: space })} />
			{/snippet}
		</Row>
	{/each}
</ListSection>
