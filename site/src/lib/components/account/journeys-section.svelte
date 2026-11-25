<script lang="ts">
	import { onMount } from "svelte";
	import { account } from "#lib/account.svelte.js";
	import { ApiError } from "#lib/api.js";
	import { t } from "#lib/i18n/index.js";
	import { exportJourney, journeyActions, journeyQuery, listJourneys, removeJourney, renameJourney, type Journey } from "#lib/journeys.js";
	import { toRoute } from "#lib/links.js";
	import ConfirmDialog from "./confirm-dialog.svelte";
	import { day } from "./format";
	import ListSection from "./list-section.svelte";
	import NameDialog from "./name-dialog.svelte";
	import RowAction from "./row-action.svelte";
	import Row from "./row.svelte";

	// The saved graph journeys: list, open on the map (linked to the saved copy: `journey=<id>`), export as Markdown, rename, delete.
	let items = $state<Journey[]>([]);
	let loading = $state(true), failed = $state(false), exportNote = $state<"" | "failed" | "partial">("");
	let section: { focusHeading: () => void } | undefined;
	let renaming = $state<Journey | null>(null), renameOpen = $state(false);
	let removing = $state<Journey | null>(null), removeOpen = $state(false), refocus = false;

	async function load() {
		loading = true; failed = false; exportNote = "";
		try { items = await listJourneys(); }
		catch (e) { if (e instanceof ApiError && e.status === 401) account.expire(); else failed = true; }
		finally { loading = false; }
	}
	onMount(() => void load());

	const status = $derived(
		exportNote === "failed" ? t("journey.export.failed") : exportNote === "partial" ? t("journey.message.exportedPartial")
		: loading || failed ? "" : t("account.journeys.count", { count: items.length }),
	);
	const canExport = !!journeyActions.export;
	async function exportOne(id: string) {
		exportNote = "";
		try { exportNote = (await exportJourney(id))?.partial ? "partial" : ""; } catch (e) { if (e instanceof ApiError && e.status === 401) account.expire(); else exportNote = "failed"; }
	}
	const sort = (list: Journey[]) => [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
</script>

<ListSection bind:this={section} heading={t("account.journeys")} icon="journey" {status} {loading} {failed} empty={!items.length} emptyTitle={t("account.journeys.empty.title")} emptyText={t("account.journeys.empty.text")} onretry={load}>
	{#each items as j (j.id)}
		<Row title={j.title}>
			{#snippet meta()}{t("account.steps", { count: j.route.length })} · {t("account.updated", { date: day(j.updated_at) })}{/snippet}
			{#snippet actions()}
				<RowAction icon="map" href="{toRoute('/graph')}?{journeyQuery(j.route, j.id)}" label={t("account.journey.open", { title: j.title })} />
				<RowAction icon="download" label={t("account.journey.export", { title: j.title })} unavailable={!canExport} onclick={() => void exportOne(j.id)} />
				<RowAction icon="rename" label={t("account.journey.rename", { title: j.title })} onclick={() => { renaming = j; renameOpen = true; }} />
				<RowAction icon="trash" destructive label={t("account.journey.remove", { title: j.title })} onclick={() => { removing = j; removeOpen = true; }} />
			{/snippet}
		</Row>
	{/each}
</ListSection>

<NameDialog bind:open={renameOpen} heading={t("account.journey.renameTitle")} value={renaming?.title ?? ""} onsave={async (title) => {
	const target = renaming;
	if (!target) return;
	const saved = await renameJourney(target.id, title);
	items = sort(items.map((j) => (j.id === target.id ? { ...j, title: saved.title, updated_at: saved.updated_at } : j)));
}} />
<ConfirmDialog bind:open={removeOpen} heading={t("account.journey.removeTitle")} text={t("account.journey.removeText", { title: removing?.title ?? "" })} confirm={t("account.remove.confirm")} failure={t("account.remove.failed")} onconfirm={async () => {
	const target = removing;
	if (!target) return;
	await removeJourney(target.id);
	items = items.filter((j) => j.id !== target.id);
	refocus = true; // the page behind a modal is inert: the focus moves once the dialog is closed
}} onclose={() => { if (refocus) { refocus = false; section?.focusHeading(); } }} />
