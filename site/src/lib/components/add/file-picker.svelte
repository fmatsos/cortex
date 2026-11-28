<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { t } from "#lib/i18n/index.js";

	// Files to send with an addition: chosen with the button or dropped on the zone, listed with a button to take each one back out. Which types the
	// server takes is its own list (scripts/share-server.ts, UPLOAD_TYPES); `ACCEPT` only narrows the file picker to the same ones.
	const ACCEPT = ".pdf,.md,.markdown,.txt,.png,.jpg,.jpeg,.webp,.gif,.docx,.odt,.rtf,.epub,.html,.htm,application/pdf,text/markdown,text/plain,image/png,image/jpeg,image/webp,image/gif";
	let { files = $bindable([]), label, hint, error = "" }: { files?: File[]; label: string; hint: string; error?: string } = $props();
	const uid = $props.id();
	let picker = $state<HTMLInputElement | null>(null);
	let dragging = $state(false);

	const size = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);
	function add(list: Iterable<File>) {
		for (const f of list) if (!files.some((g) => g.name === f.name && g.size === f.size)) files.push(f);
	}
</script>

<div class="flex flex-col gap-2">
	<p id="{uid}-label" class="text-sm font-semibold">{label}</p>
	<div
		role="group"
		aria-labelledby="{uid}-label"
		class="border-input flex flex-wrap items-center gap-3 border border-dashed p-4 {dragging ? 'bg-muted' : ''}"
		ondragover={(e) => { e.preventDefault(); dragging = true; }}
		ondragleave={() => (dragging = false)}
		ondrop={(e) => { e.preventDefault(); dragging = false; add(e.dataTransfer?.files ?? []); }}
	>
		<Button type="button" variant="outline" size="sm" aria-describedby="{uid}-hint" onclick={() => picker?.click()}><Icon name="kind-ingest" size={16} />{t("add.resource.choose")}</Button>
		<span class="text-muted-foreground text-sm">{t("add.resource.drop")}</span>
		<input bind:this={picker} type="file" multiple accept={ACCEPT} hidden onchange={(e) => { add(e.currentTarget.files ?? []); e.currentTarget.value = ""; }} />
	</div>
	<p id="{uid}-hint" class="text-muted-foreground text-xs">{hint}</p>
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
	<p role="alert" class="text-destructive text-sm empty:hidden">{error}</p>
</div>
