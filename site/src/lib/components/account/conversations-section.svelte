<script lang="ts">
	import { onMount } from "svelte";
	import { account } from "#lib/account.svelte.js";
	import { assistant } from "#lib/assistant.svelte.js";
	import { ApiError } from "#lib/api.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { conversationActions, exportConversation, listConversations, removeConversation, renameConversation, resumeConversation, type ConversationSummary } from "#lib/conversations.js";
	import { t } from "#lib/i18n/index.js";
	import ConfirmDialog from "./confirm-dialog.svelte";
	import { day } from "./format";
	import ListSection from "./list-section.svelte";
	import NameDialog from "./name-dialog.svelte";
	import RowAction from "./row-action.svelte";
	import Row from "./row.svelte";

	// The saved assistant conversations: list, search (250 ms after the last keystroke, a late answer never replaces a newer
	// one), resume, export, rename, delete. Resume and export belong to phase C (conversations.ts): disabled until it plugs in.
	const DEBOUNCE_MS = 250;
	const uid = $props.id();
	let items = $state<ConversationSummary[]>([]);
	let loading = $state(true), failed = $state(false), exportFailed = $state(false);
	let q = $state(""), searched = $state(""); // typed / used for the list on screen
	let seq = 0, timer: ReturnType<typeof setTimeout>, ctl: AbortController | undefined;
	let section: { focusHeading: () => void } | undefined;
	let renaming = $state<ConversationSummary | null>(null), renameOpen = $state(false);
	let removing = $state<ConversationSummary | null>(null), removeOpen = $state(false), refocus = false;

	async function load(query: string) {
		ctl?.abort();
		ctl = new AbortController();
		const mine = ++seq;
		loading = true; failed = false; exportFailed = false;
		try {
			const list = await listConversations(query, ctl.signal);
			if (mine !== seq) return;
			items = list; searched = query.trim();
		} catch (e) {
			if (mine !== seq || (e as Error).name === "AbortError") return;
			if (e instanceof ApiError && e.status === 401) account.expire(); else failed = true;
		} finally {
			if (mine === seq) loading = false;
		}
	}
	onMount(() => { void load(""); return () => { clearTimeout(timer); ctl?.abort(); }; });
	const typed = () => { clearTimeout(timer); timer = setTimeout(() => void load(q), DEBOUNCE_MS); };

	const status = $derived(
		exportFailed ? t("assistant.export.failed")
		: loading || failed ? ""
		: searched && !items.length ? t("account.conversations.noMatch", { q: searched })
		: items.length || searched ? t("account.conversations.count", { count: items.length }) : "",
	);
	const sort = (list: ConversationSummary[]) => [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
	// resuming needs the assistant's panel (a server that answers questions); the export only needs the account
	const canResume = $derived(assistant.api && !!conversationActions.resume), canExport = !!conversationActions.export;
	async function exportOne(id: string) {
		exportFailed = false;
		try { await exportConversation(id); } catch (e) { if (e instanceof ApiError && e.status === 401) account.expire(); else exportFailed = true; }
	}
</script>

<ListSection bind:this={section} heading={t("account.conversations")} icon="conversation" {status} {loading} {failed} empty={!items.length && !searched} emptyTitle={t("account.conversations.empty.title")} emptyText={t("account.conversations.empty.text")} onretry={() => load(q)}>
	{#snippet tools()}
		<div role="search" class="w-full sm:w-72">
			<label for="{uid}-q" class="sr-only">{t("account.conversations.search")}</label>
			<Input id="{uid}-q" type="search" bind:value={q} oninput={typed} placeholder={t("account.conversations.search")} autocomplete="off" onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter") { clearTimeout(timer); void load(q); } }} />
		</div>
	{/snippet}
	{#each items as c (c.id)}
		<Row title={c.title}>
			{#snippet meta()}{t("account.exchanges", { count: c.exchanges })} · {t("account.updated", { date: day(c.updated_at) })}{/snippet}
			{#snippet actions()}
				<RowAction icon="play" label={t("account.conversation.resume", { title: c.title })} unavailable={!canResume} onclick={() => void resumeConversation(c.id)} />
				<RowAction icon="download" label={t("account.conversation.export", { title: c.title })} unavailable={!canExport} onclick={() => void exportOne(c.id)} />
				<RowAction icon="rename" label={t("account.conversation.rename", { title: c.title })} onclick={() => { renaming = c; renameOpen = true; }} />
				<RowAction icon="trash" destructive label={t("account.conversation.remove", { title: c.title })} onclick={() => { removing = c; removeOpen = true; }} />
			{/snippet}
		</Row>
	{/each}
</ListSection>

<NameDialog bind:open={renameOpen} heading={t("account.conversation.renameTitle")} value={renaming?.title ?? ""} onsave={async (title) => {
	const target = renaming;
	if (!target) return;
	const saved = await renameConversation(target.id, title);
	assistant.renamed(target.id, saved.title); // the assistant may hold this very conversation
	items = sort(items.map((c) => (c.id === target.id ? { ...c, title: saved.title, updated_at: saved.updated_at } : c)));
}} />
<ConfirmDialog bind:open={removeOpen} heading={t("account.conversation.removeTitle")} text={t("account.conversation.removeText", { title: removing?.title ?? "" })} confirm={t("account.remove.confirm")} failure={t("account.remove.failed")} onconfirm={async () => {
	const target = removing;
	if (!target) return;
	await removeConversation(target.id);
	assistant.forget(target.id);
	items = items.filter((c) => c.id !== target.id);
	refocus = true; // the page behind a modal is inert: the focus moves once the dialog is closed
}} onclose={() => { if (refocus) { refocus = false; section?.focusHeading(); } }} />
