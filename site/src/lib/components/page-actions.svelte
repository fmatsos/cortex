<script lang="ts">
	import { tick } from "svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import FavButton from "#lib/components/fav-button.svelte";
	import Icon from "#lib/components/icon.svelte";
	import { graphFocus, shareUrl } from "#lib/article.js";
	import { toRoute } from "#lib/links.js";
	import { t } from "#lib/i18n/index.js";

	// Actions of an article: Favorite and the main action (read the original source, on a Source page) stay visible;
	// the secondary actions (copy the link, copy the Markdown, see in the graph) are inline buttons from `sm`
	// and are grouped behind "Actions" on mobile (UI24). Copy feedback goes through a persistent `role="status"`
	// region (UI13); on failure, the text is offered selected in a field for manual copy (UI12).
	let { id, md, original }: { id: string; md: string; original?: { url: string; domain: string } } = $props();

	type What = "link" | "md";
	let copied = $state<"" | What>("");
	let message = $state("");
	let manual = $state<{ what: What; text: string } | null>(null);
	let field = $state<HTMLTextAreaElement>();
	let timer: ReturnType<typeof setTimeout> | undefined;

	const copy = async (what: What) => {
		const text = what === "link" ? shareUrl(location.href) : md;
		clearTimeout(timer);
		try {
			await navigator.clipboard.writeText(text);
			manual = null;
			copied = what;
			message = ""; // cleared then set again: the same repeated confirmation is re-announced
			await tick();
			message = what === "link" ? t("actions.copied.link") : t("actions.copied.md");
			timer = setTimeout(() => { copied = ""; message = ""; }, 3000);
			closeMenu(true);
		} catch {
			copied = "";
			manual = { what, text };
			message = what === "link" ? t("actions.copyFailed.link") : t("actions.copyFailed.md");
			closeMenu();
			await tick();
			field?.focus();
			field?.select();
		}
	};

	// "Actions" menu (mobile): toggle button, Escape and outside click close it again
	let open = $state(false);
	let root = $state<HTMLElement>();
	let trigger = $state<HTMLElement | null>(null);
	const closeMenu = (refocus = false) => {
		if (!open) return;
		open = false;
		if (refocus) trigger?.focus();
	};
</script>

<svelte:window onpointerdown={(e) => { if (open && root && !root.contains(e.target as Node)) closeMenu(); }} />

<div class="flex flex-wrap items-center gap-2">
	<FavButton {id} />
	{#if original}
		<Button href={original.url} rel="noopener noreferrer" size="sm">
			<Icon name="external-link" size={16} />
			{t("actions.readOriginal")}
			{#if original.domain}<span class="font-normal opacity-90">({original.domain})</span>{/if}
			<span class="sr-only"> — {t("common.externalLink")}</span>
		</Button>
	{/if}

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={root}
		class="relative sm:contents"
		onkeydown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); closeMenu(true); } }}
		onfocusout={(e) => { if (open && !root?.contains(e.relatedTarget as Node | null)) open = false; }}
	>
		<Button bind:ref={trigger} variant="outline" size="sm" class="sm:hidden" aria-expanded={open} aria-controls="page-actions-menu" onclick={() => (open = !open)}>
			<Icon name="chevron-down" size={16} class={open ? "rotate-180" : undefined} />
			{t("actions.menu")}
		</Button>
		<div
			id="page-actions-menu"
			class={[
				"sm:contents",
				open ? "bg-popover absolute top-full left-0 z-20 mt-1 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-1.5 rounded-lg border p-2 shadow-md" : "hidden",
			]}
		>
			<Button variant="outline" size="sm" class="justify-start sm:justify-center" onclick={() => copy("link")}>
				<Icon name={copied === "link" ? "success" : "copy-link"} size={16} />
				{copied === "link" ? t("common.linkCopied") : t("actions.copyLink")}
			</Button>
			<Button variant="outline" size="sm" class="justify-start sm:justify-center" onclick={() => copy("md")}>
				<Icon name={copied === "md" ? "success" : "copy-markdown"} size={16} />
				{copied === "md" ? t("actions.mdCopied") : t("actions.copyMd")}
			</Button>
			<Button variant="outline" size="sm" class="justify-start sm:justify-center" href="{toRoute('/graph')}{graphFocus(id)}">
				<Icon name="graph" size={16} />
				{t("actions.viewInGraph")}
			</Button>
		</div>
	</div>
</div>

<p role="status" class="text-muted-foreground mt-2 text-sm empty:mt-0">{message}</p>
{#if manual}
	<div class="mt-2 max-w-xl">
		<label for="manual-copy" class="text-sm font-medium">{manual.what === "link" ? t("actions.manual.link") : t("actions.manual.md")}</label>
		<textarea
			id="manual-copy"
			bind:this={field}
			readonly
			rows={manual.what === "link" ? 2 : 6}
			value={manual.text}
			class="border-input bg-card mt-1 block w-full rounded-md border px-3 py-2 font-mono text-sm"
		></textarea>
		<Button variant="ghost" size="sm" class="mt-1" onclick={() => { manual = null; message = ""; }}>{t("common.close")}</Button>
	</div>
{/if}
