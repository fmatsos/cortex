<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { refusal, sendShare, type ShareResult } from "#lib/share.js";
	import { t } from "#lib/i18n/index.js";

	// The Resource tab of the Add page: a link, or files (several at once, chosen or dropped), each with the optional "why I keep it". A link is sent as
	// JSON like the extension does (`{ url, note, as: "resource" }`), the files as one multipart request (`as: "resource"`): the server names them, checks
	// their type and size (415, 413) and answers 409 when the space does not take resources. Which types it takes is the server's list (scripts/share-server.ts,
	// UPLOAD_TYPES); `ACCEPT` only narrows the file picker to the same ones.
	const ACCEPT = ".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain";
	const uid = $props.id();

	let url = $state(""), why = $state("");
	let files = $state<File[]>([]);
	let picker = $state<HTMLInputElement | null>(null);
	let urlField = $state<HTMLInputElement | null>(null);
	let dragging = $state(false), pending = $state(false), submitted = $state(false);
	let results = $state<{ ok: boolean; text: string }[]>([]);

	const link = $derived(url.trim());
	const urlError = $derived(submitted && link && !/^https?:\/\/\S+$/i.test(link) ? t("add.resource.badUrl") : "");
	const emptyError = $derived(submitted && !link && !files.length ? t("add.resource.empty") : "");

	const size = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);
	function add(list: Iterable<File>) {
		for (const f of list) if (!files.some((g) => g.name === f.name && g.size === f.size)) files.push(f);
	}
	function dropped(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		add(e.dataTransfer?.files ?? []);
	}

	/** What the share route answered, as a line of the result list. */
	const line = (what: string, r: ShareResult, ok: string) =>
		r.ok ? { ok: true, text: ok } : { ok: false, text: `${what}${t("common.colon")}${r.status === 0 ? t("add.resource.offline") : refusal(r) ? t("add.refused", { reason: r.reason }) : t("add.resource.failed", { status: r.status })}` };

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		submitted = true; results = [];
		if (pending) return;
		if (link && urlError) { urlField?.focus(); return; }
		if (!link && !files.length) return;
		pending = true;
		const note = why.trim();
		try {
			if (link) {
				const r = await sendShare({ url: link, note, as: "resource" });
				results.push(line(link, r, t("add.resource.sentLink", { url: link })));
				if (r.ok) url = "";
			}
			if (files.length) {
				const form = new FormData();
				form.set("note", note); form.set("as", "resource");
				for (const f of files) form.append("file", f);
				const r = await sendShare(form);
				results.push(line(t("add.resource.files", { count: files.length }), r, t("add.resource.sentFiles", { count: files.length })));
				if (r.ok) files = [];
			}
			if (results.every((r) => r.ok)) { why = ""; submitted = false; }
		} finally { pending = false; }
	}
</script>

<form onsubmit={submit} novalidate class="border-border bg-card shadow-surface flex flex-col gap-6 border p-4 sm:p-6">
	<div class="flex flex-col gap-2">
		<label for="{uid}-url" class="text-sm font-semibold">{t("add.resource.url.label")}</label>
		<Input id="{uid}-url" bind:ref={urlField} bind:value={url} type="url" inputmode="url" autocomplete="off" spellcheck={false} aria-invalid={urlError ? "true" : undefined} aria-describedby="{uid}-url-hint {uid}-url-error" />
		<p id="{uid}-url-hint" class="text-muted-foreground text-xs">{t("add.resource.url.hint")}</p>
		<p id="{uid}-url-error" role="alert" class="text-destructive text-sm empty:hidden">{urlError}</p>
	</div>

	<div class="flex flex-col gap-2">
		<p id="{uid}-files" class="text-sm font-semibold">{t("add.resource.files.label")}</p>
		<div
			role="group"
			aria-labelledby="{uid}-files"
			class="border-input flex flex-wrap items-center gap-3 border border-dashed p-4 {dragging ? 'bg-muted' : ''}"
			ondragover={(e) => { e.preventDefault(); dragging = true; }}
			ondragleave={() => (dragging = false)}
			ondrop={dropped}
		>
			<Button type="button" variant="outline" size="sm" aria-describedby="{uid}-files-hint" onclick={() => picker?.click()}><Icon name="kind-ingest" size={16} />{t("add.resource.choose")}</Button>
			<span class="text-muted-foreground text-sm">{t("add.resource.drop")}</span>
			<input bind:this={picker} type="file" multiple accept={ACCEPT} hidden onchange={(e) => { add(e.currentTarget.files ?? []); e.currentTarget.value = ""; }} />
		</div>
		<p id="{uid}-files-hint" class="text-muted-foreground text-xs">{t("add.resource.files.hint")}</p>
		{#if files.length}
			<ul class="flex flex-col gap-1 text-sm">
				{#each files as f (f.name + f.size)}
					<li class="bg-secondary border-border flex items-center justify-between gap-3 border px-3 py-1">
						<span class="[overflow-wrap:anywhere]">{f.name} <span class="text-muted-foreground text-xs">({size(f.size)})</span></span>
						<Button type="button" variant="ghost" size="icon-sm" aria-label={t("add.resource.remove", { name: f.name })} onclick={() => (files = files.filter((g) => g !== f))}><Icon name="close-selection" size={16} /></Button>
					</li>
				{/each}
			</ul>
		{/if}
		<p role="alert" class="text-destructive text-sm empty:hidden">{emptyError}</p>
	</div>

	<div class="flex flex-col gap-2">
		<label for="{uid}-why" class="text-sm font-semibold">{t("add.resource.why.label")}</label>
		<Input id="{uid}-why" bind:value={why} maxlength={300} autocomplete="off" aria-describedby="{uid}-why-hint" />
		<p id="{uid}-why-hint" class="text-muted-foreground text-xs">{t("add.resource.why.hint")}</p>
	</div>

	<div class="border-border flex justify-end border-t pt-4">
		<Button type="submit" disabled={pending}><Icon name="kind-add" size={16} />{t("add.resource.submit")}</Button>
	</div>
	<p role="status" class="text-sm empty:hidden">{pending ? t("add.sending") : ""}</p>
	<ul aria-label={t("add.title")} class="flex flex-col gap-1 text-sm empty:hidden">
		{#each results as r, i (i)}
			<li role={r.ok ? "status" : "alert"} class={r.ok ? "" : "text-destructive"}>{r.text}</li>
		{/each}
	</ul>
</form>
