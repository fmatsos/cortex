<script lang="ts">
	import Icon from "#lib/components/icon.svelte";
	import type { IconName } from "#lib/icons.js";
	import type { Block } from "#lib/assistant.svelte.js";
	import { toPage } from "#lib/links.js";
	import { t } from "#lib/i18n/index.js";

	// One display block of an answer (src/answer-blocks.ts). Every text field arrives as sanitized HTML from the server; its
	// links are relative to the site root, `fix` makes them right wherever the assistant is open.
	let { block, fix }: { block: Block; fix: (html: string) => string } = $props();
	const uid = $props.id();
	let tab = $state(0);
	const TONES: Record<string, { icon: IconName; cls: string; label: string }> = {
		info: { icon: "note", cls: "border-l-primary bg-muted/50", label: "assistant.tone.info" },
		warning: { icon: "warning", cls: "border-l-warning-foreground bg-warning-background text-warning-foreground", label: "assistant.tone.warning" },
		success: { icon: "success", cls: "border-l-link bg-muted/50", label: "assistant.tone.success" },
		danger: { icon: "error", cls: "border-l-destructive bg-destructive/10 text-destructive", label: "assistant.tone.danger" },
	};
	// arrows, Home and End move between tabs (WAI-ARIA tabs pattern, automatic activation)
	function tabKey(e: KeyboardEvent, n: number) {
		const to = e.key === "ArrowRight" ? (tab + 1) % n : e.key === "ArrowLeft" ? (tab + n - 1) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
		if (to < 0) return;
		e.preventDefault();
		tab = to;
		document.getElementById(`${uid}-tab-${to}`)?.focus();
	}
</script>

{#snippet heading(title?: string)}
	{#if title}<p class="mb-2 text-sm font-semibold">{@html title}</p>{/if}
{/snippet}

<div class="answer-block my-4">
	{#if block.type === "callout"}
		{@const tone = TONES[block.tone] ?? TONES.info}
		<div class="rounded-md border border-l-4 px-3 py-2 {tone.cls}" role="note" aria-label={t(tone.label)}>
			<p class="flex items-center gap-2 text-sm font-semibold"><Icon name={tone.icon} size={16} />{#if block.title}{@html block.title}{:else}{t(tone.label)}{/if}</p>
			<div class="wiki text-sm">{@html fix(block.html)}</div>
		</div>
	{:else if block.type === "table"}
		{@render heading(block.title)}
		<div class="wiki overflow-x-auto">
			<table>
				<thead><tr>{#each block.columns as c, i (i)}<th scope="col">{@html fix(c)}</th>{/each}</tr></thead>
				<tbody>{#each block.rows as row, r (r)}<tr>{#each row as cell, i (i)}<td>{@html fix(cell)}</td>{/each}</tr>{/each}</tbody>
			</table>
		</div>
	{:else if block.type === "steps"}
		{@render heading(block.title)}
		<ol class="space-y-3">
			{#each block.items as s, i (i)}
				<li class="flex gap-3">
					<span class="bg-primary text-primary-foreground inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold" aria-hidden="true">{i + 1}</span>
					<div class="min-w-0"><p class="font-medium">{@html s.title}</p>{#if s.html}<div class="wiki text-sm">{@html fix(s.html)}</div>{/if}</div>
				</li>
			{/each}
		</ol>
	{:else if block.type === "tabs"}
		<div role="tablist" class="flex flex-wrap gap-1 border-b">
			{#each block.tabs as x, i (i)}
				<button type="button" role="tab" id="{uid}-tab-{i}" aria-selected={tab === i} aria-controls="{uid}-panel" tabindex={tab === i ? 0 : -1}
					class="-mb-px min-h-9 border-b-2 px-3 text-sm pointer-coarse:min-h-11 {tab === i ? 'border-primary font-semibold' : 'text-muted-foreground hover:text-foreground border-transparent'}"
					onclick={() => (tab = i)} onkeydown={(e) => tabKey(e, block.tabs.length)}>{@html x.label}</button>
			{/each}
		</div>
		<div role="tabpanel" id="{uid}-panel" aria-labelledby="{uid}-tab-{tab}" tabindex="0" class="wiki pt-3">{@html fix(block.tabs[tab]?.html ?? "")}</div>
	{:else if block.type === "facts"}
		{@render heading(block.title)}
		<dl class="grid gap-2 sm:grid-cols-2">
			{#each block.items as f, i (i)}
				<div class="rounded-md border px-3 py-2"><dt class="text-muted-foreground text-xs">{@html f.label}</dt><dd class="font-semibold">{@html fix(f.html)}</dd></div>
			{/each}
		</dl>
	{:else if block.type === "pages"}
		{@render heading(block.title)}
		<ul class="space-y-2">
			{#each block.items as p (p.id)}
				<li class="rounded-md border px-3 py-2"><a href={toPage(p.id)} class="font-medium underline underline-offset-4">{@html p.title}</a><p class="text-muted-foreground text-sm">{@html fix(p.html)}</p></li>
			{/each}
		</ul>
	{/if}
</div>
