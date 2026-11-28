<script lang="ts">
	import { onMount, tick } from "svelte";
	import { account } from "#lib/account.svelte.js";
	import Icon from "#lib/components/icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Empty from "#lib/components/ui/empty/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import * as Tabs from "#lib/components/ui/tabs/index.js";
	import { Textarea } from "#lib/components/ui/textarea/index.js";
	import ResourceForm from "#lib/components/add/resource-form.svelte";
	import { fromFile, insert, type Insert } from "#lib/markdown-edit.js";
	import { refusal, sendShare } from "#lib/share.js";
	import { spaceApi } from "#lib/space.js";
	import { spaces } from "#lib/spaces.svelte.js";
	import { spaceKey } from "#lib/storage.js";
	import { contentLang, t } from "#lib/i18n/index.js";

	// Add something to the space: a tab per kind the space takes (Note, Resource). A tab is a panel of this list with its own form and its own `as` (what
	// the source is): another kind of addition is one more `Tabs.Trigger`, one more `Tabs.Content` and its own submit. Everything goes through the share
	// route of the space (`POST <space>/share/api`, the phone's and the extension's too, see share.ts): it lands in `inbox/`, is added as a raw source and
	// waits to be compiled. Needs a signed-in visitor and a space that is not read-only; the server decides anyway (409 with its reason). The note's draft
	// stays in this browser (never required) until it is sent; its preview is the wiki's own Markdown rendering, drawn by the server.
	const uid = $props.id();
	const DRAFT = "add-note";
	const MAX_FILE = 2_000_000;

	let tab = $state("note");
	const hasNote = $derived(spaces.accepts("notes")), hasResource = $derived(spaces.accepts("resources"));
	// the tab shown is one of those the space takes (a resources-only space has no Note tab)
	$effect(() => { if ((tab === "note" && !hasNote && hasResource) || (tab === "resource" && !hasResource && hasNote)) tab = hasNote ? "note" : "resource"; });
	let title = $state(""), body = $state(""), why = $state("");
	let mode = $state<"write" | "preview">("write");
	let area = $state<HTMLTextAreaElement | null>(null);
	let titleField = $state<HTMLInputElement | null>(null);
	let file = $state<HTMLInputElement | null>(null);
	let pending = $state(false), submitted = $state(false);
	let info = $state(""), error = $state("");
	let html = $state(""), drawing = $state(false);
	let restored = $state(false);

	const titleError = $derived(submitted && !title.trim() ? t("add.error.title") : "");
	const bodyError = $derived(submitted && !body.trim() ? t("add.error.body") : "");

	// ---- the draft: this space's, in this browser ----------------------------------------------------------------------------
	onMount(() => {
		try {
			const d = JSON.parse(localStorage.getItem(spaceKey(DRAFT)) ?? "null") as Partial<Record<"title" | "body" | "why", unknown>> | null;
			if (d && typeof d === "object") {
				if (typeof d.title === "string") title = d.title;
				if (typeof d.body === "string") body = d.body;
				if (typeof d.why === "string") why = d.why;
			}
		} catch { /* no storage, or a draft that is not ours: start empty */ }
		restored = true;
	});
	$effect(() => {
		const draft = { title, body, why };
		if (!restored) return; // before the stored draft is read, the empty fields would erase it
		try {
			if (title || body || why) localStorage.setItem(spaceKey(DRAFT), JSON.stringify(draft));
			else localStorage.removeItem(spaceKey(DRAFT));
		} catch { /* storage unavailable: the draft lives as long as the page */ }
	});

	// ---- the toolbar ------------------------------------------------------------------------------------------------------------
	const TOOLS: { what: Insert; label: "add.tool.heading" | "add.tool.bold" | "add.tool.italic" | "add.tool.bullets" | "add.tool.link" | "add.tool.checkbox"; glyph: string; class?: string }[] = [
		{ what: "heading", label: "add.tool.heading", glyph: "H" },
		{ what: "bold", label: "add.tool.bold", glyph: "B", class: "font-bold" },
		{ what: "italic", label: "add.tool.italic", glyph: "I", class: "italic" },
		{ what: "bullets", label: "add.tool.bullets", glyph: "•" },
		{ what: "link", label: "add.tool.link", glyph: "Link" },
		{ what: "checkbox", label: "add.tool.checkbox", glyph: "[ ]", class: "font-mono" },
	];
	async function apply(what: Insert) {
		if (!area) return;
		const r = insert(what, body, area.selectionStart, area.selectionEnd, t("add.tool.placeholder"));
		body = r.text;
		await tick(); // the field shows the new text before the selection is put back
		area.focus();
		area.setSelectionRange(r.start, r.end);
	}

	// ---- the preview: the server's rendering of the wiki's pages; where it cannot answer, the text as it is -----------------------
	const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
	let drawn = 0;
	async function draw() {
		const md = (title.trim() ? `# ${title.trim()}\n\n` : "") + body;
		const run = ++drawn;
		if (!md.trim()) { html = ""; drawing = false; return; }
		drawing = true;
		let out = `<p class="whitespace-pre-wrap">${escape(md)}</p>`;
		try {
			const r = await fetch(spaceApi("/api/markdown"), { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ md }) });
			const b = r.ok ? ((await r.json().catch(() => ({}))) as { html?: unknown }) : {};
			if (typeof b.html === "string") out = b.html;
		} catch { /* unreachable: the plain text stands */ }
		if (run !== drawn) return; // an older answer arriving late
		html = out;
		drawing = false;
	}
	function show(next: "write" | "preview") {
		mode = next;
		if (next === "preview") void draw();
		else void tick().then(() => area?.focus());
	}

	// ---- a .md file: its first # heading is the title ------------------------------------------------------------------------------
	async function importFile(e: Event & { currentTarget: HTMLInputElement }) {
		const f = e.currentTarget.files?.[0];
		e.currentTarget.value = ""; // the same file can be chosen again
		if (!f) return;
		info = ""; error = "";
		if (f.size > MAX_FILE) { error = t("add.import.tooBig"); return; }
		try {
			const r = fromFile(await f.text());
			body = r.body;
			if (r.title) title = r.title;
			info = t("add.import.done", { name: f.name });
			if (mode === "preview") void draw();
		} catch { error = t("add.import.failed"); }
	}

	// ---- the send ----------------------------------------------------------------------------------------------------------------------
	async function submit(e: SubmitEvent) {
		e.preventDefault();
		info = ""; error = ""; submitted = true;
		if (pending) return;
		if (!title.trim() || !body.trim()) { (title.trim() ? area : titleField)?.focus(); return; }
		pending = true;
		const r = await sendShare({ title: title.trim(), text: body, note: why, as: "note" });
		if (r.ok) {
			title = ""; body = ""; why = ""; mode = "write"; submitted = false;
			try { localStorage.removeItem(spaceKey(DRAFT)); } catch { /* nothing kept */ }
			info = t("add.note.sent");
		} else {
			// the share route answers in plain text: the space refusing (409: read-only, or it does not hold notes) says why
			error = r.status === 0 ? t("add.offline") : refusal(r) ? t("add.refused", { reason: r.reason }) : t("add.failed", { status: r.status });
			if (r.status === 401) account.expire();
		}
		pending = false;
	}
</script>

<svelte:head><title>{t("add.title")} · Cortex</title><meta name="robots" content="noindex" /></svelte:head>

<div class="mx-auto flex max-w-4xl flex-col gap-6">
	<div>
		<h1 class="text-3xl font-semibold tracking-tight">{t("add.title")}</h1>
		<p class="text-muted-foreground mt-2 text-sm">{t("add.lead")}</p>
	</div>

	{#if !account.ready || !spaces.loaded}
		<p class="text-muted-foreground text-sm" role="status"><Icon name="retry" size={16} class="mr-1 inline motion-safe:animate-spin" />{t("account.loading")}</p>
	{:else if !account.me}
		<Empty.Root>
			<Empty.Header>
				<Empty.Media variant="icon"><Icon name="kind-add" size={20} /></Empty.Media>
				<Empty.Title>{t("add.signedOut.title")}</Empty.Title>
				<Empty.Description>{t("add.signedOut.text")}</Empty.Description>
			</Empty.Header>
		</Empty.Root>
	{:else if !hasNote && !hasResource}
		<Empty.Root>
			<Empty.Header>
				<Empty.Media variant="icon"><Icon name="kind-add" size={20} /></Empty.Media>
				<Empty.Title>{t("add.readOnly.title")}</Empty.Title>
				<Empty.Description>{t("add.readOnly.text")}</Empty.Description>
			</Empty.Header>
		</Empty.Root>
	{:else}
		<Tabs.Root bind:value={tab}>
			<Tabs.List variant="line" aria-label={t("add.tabs.label")}>
				{#if hasNote}<Tabs.Trigger value="note">{t("add.tab.note")}</Tabs.Trigger>{/if}
				{#if hasResource}<Tabs.Trigger value="resource">{t("add.tab.resource")}</Tabs.Trigger>{/if}
			</Tabs.List>
			{#if hasResource}
				<Tabs.Content value="resource" class="pt-4"><ResourceForm /></Tabs.Content>
			{/if}
			{#if hasNote}
			<Tabs.Content value="note" class="pt-4">
				<form onsubmit={submit} novalidate class="border-border bg-card shadow-surface flex flex-col gap-6 border p-4 sm:p-6">
					<div class="flex flex-col gap-2">
						<label for="{uid}-title" class="text-sm font-semibold">{t("add.note.title.label")}</label>
						<Input id="{uid}-title" bind:ref={titleField} bind:value={title} maxlength={200} required autocomplete="off" aria-invalid={titleError ? "true" : undefined} aria-describedby="{uid}-title-error" />
						<p id="{uid}-title-error" role="alert" class="text-destructive text-sm empty:hidden">{titleError}</p>
					</div>

					<div class="flex flex-col gap-2">
						<div class="flex flex-wrap items-end justify-between gap-2">
							<label for="{uid}-body" class="text-sm font-semibold">{t("add.note.body.label")}</label>
							<div class="flex flex-wrap items-center gap-2">
								<Button type="button" variant="outline" size="sm" onclick={() => file?.click()}><Icon name="export-markdown" size={16} />{t("add.import")}</Button>
								<input bind:this={file} type="file" accept=".md,.markdown,text/markdown" hidden onchange={importFile} />
								<div role="group" aria-label={t("add.mode.label")} class="flex gap-1">
									<Button type="button" size="sm" variant={mode === "write" ? "secondary" : "outline"} aria-pressed={mode === "write"} onclick={() => show("write")}>{t("add.mode.write")}</Button>
									<Button type="button" size="sm" variant={mode === "preview" ? "secondary" : "outline"} aria-pressed={mode === "preview"} onclick={() => show("preview")}>{t("add.mode.preview")}</Button>
								</div>
							</div>
						</div>
						<div hidden={mode !== "write"} class="flex flex-col gap-2">
							<div role="toolbar" aria-label={t("add.toolbar.label")} aria-controls="{uid}-body" class="flex flex-wrap gap-1">
								{#each TOOLS as tool (tool.what)}
									<Button type="button" size="sm" variant="outline" title={t(tool.label)} onclick={() => apply(tool.what)}>
										<span aria-hidden="true" class={tool.class}>{tool.glyph}</span><span class="sr-only">{t(tool.label)}</span>
									</Button>
								{/each}
							</div>
							<Textarea id="{uid}-body" bind:ref={area} bind:value={body} rows={14} spellcheck lang={contentLang} class="min-h-64 font-mono" aria-invalid={bodyError ? "true" : undefined} aria-describedby="{uid}-body-hint {uid}-body-error" />
							<p id="{uid}-body-hint" class="text-muted-foreground text-xs">{t("add.note.body.hint")}</p>
							<p id="{uid}-body-error" role="alert" class="text-destructive text-sm empty:hidden">{bodyError}</p>
						</div>
						{#if mode === "preview"}
							<div class="border-border min-h-64 border p-4" aria-busy={drawing || undefined}>
								{#if drawing}
									<p class="text-muted-foreground text-sm" role="status"><Icon name="retry" size={16} class="mr-1 inline motion-safe:animate-spin" />{t("add.preview.loading")}</p>
								{:else if html}
									<div class="wiki" lang={contentLang}>{@html html}</div>
								{:else}
									<p class="text-muted-foreground text-sm">{t("add.preview.empty")}</p>
								{/if}
							</div>
						{/if}
					</div>

					<div class="flex flex-col gap-2">
						<label for="{uid}-why" class="text-sm font-semibold">{t("add.note.why.label")}</label>
						<Input id="{uid}-why" bind:value={why} maxlength={300} autocomplete="off" aria-describedby="{uid}-why-hint" />
						<p id="{uid}-why-hint" class="text-muted-foreground text-xs">{t("add.note.why.hint")}</p>
					</div>

					<div class="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-4">
						<p class="text-muted-foreground text-xs">{t("add.draft")}</p>
						<Button type="submit" disabled={pending}><Icon name="kind-add" size={16} />{t("add.note.submit")}</Button>
					</div>
					<p role="status" class="text-sm empty:hidden {info ? 'text-foreground' : ''}">{pending ? t("add.sending") : info}</p>
					<p role="alert" class="text-destructive text-sm empty:hidden">{error}</p>
				</form>
			</Tabs.Content>
			{/if}
		</Tabs.Root>
	{/if}
</div>
