<script lang="ts">
	import { tick } from "svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import FavButton from "#lib/components/fav-button.svelte";
	import Icon from "#lib/components/icon.svelte";
	import { graphFocus, shareUrl } from "#lib/article.js";
	import { toRoute } from "#lib/links.js";

	// Actions d'un article : Favori et l'action principale (lire la source originale, sur une page Source) restent visibles ;
	// les actions secondaires (copier le lien, copier le Markdown, voir dans le graphe) sont des boutons en ligne dès `sm`
	// et se regroupent derrière « Actions » sur mobile (UI24). Les retours de copie passent par une région `role="status"`
	// persistante (UI13) ; en cas d'échec, le texte est proposé sélectionné dans un champ pour une copie manuelle (UI12).
	let { id, md, original }: { id: string; md: string; original?: { url: string; domain: string } } = $props();

	type What = "lien" | "md";
	let copied = $state<"" | What>("");
	let message = $state("");
	let manual = $state<{ what: What; text: string } | null>(null);
	let field = $state<HTMLTextAreaElement>();
	let timer: ReturnType<typeof setTimeout> | undefined;

	const copy = async (what: What) => {
		const text = what === "lien" ? shareUrl(location.href) : md;
		const name = what === "lien" ? "Lien" : "Markdown";
		clearTimeout(timer);
		try {
			await navigator.clipboard.writeText(text);
			manual = null;
			copied = what;
			message = ""; // vidé puis reposé : une même confirmation répétée est ré-annoncée
			await tick();
			message = `${name} copié dans le presse-papiers.`;
			timer = setTimeout(() => { copied = ""; message = ""; }, 3000);
			closeMenu(true);
		} catch {
			copied = "";
			manual = { what, text };
			message = `Copie impossible : le navigateur refuse l'accès au presse-papiers. ${what === "lien" ? "Le lien" : "Le Markdown"} est sélectionné ci-dessous, copiez-le avec Ctrl+C.`;
			closeMenu();
			await tick();
			field?.focus();
			field?.select();
		}
	};

	// menu « Actions » (mobile) : bouton à bascule, Échap et clic extérieur le referment
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
			Lire la source originale
			{#if original.domain}<span class="font-normal opacity-90">({original.domain})</span>{/if}
			<span class="sr-only"> — lien externe</span>
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
			Actions
		</Button>
		<div
			id="page-actions-menu"
			class={[
				"sm:contents",
				open ? "bg-popover absolute top-full left-0 z-20 mt-1 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-1.5 rounded-lg border p-2 shadow-md" : "hidden",
			]}
		>
			<Button variant="outline" size="sm" class="justify-start sm:justify-center" onclick={() => copy("lien")}>
				<Icon name={copied === "lien" ? "success" : "copy-link"} size={16} />
				{copied === "lien" ? "Lien copié" : "Copier le lien"}
			</Button>
			<Button variant="outline" size="sm" class="justify-start sm:justify-center" onclick={() => copy("md")}>
				<Icon name={copied === "md" ? "success" : "copy-markdown"} size={16} />
				{copied === "md" ? "Markdown copié" : "Copier le Markdown"}
			</Button>
			<Button variant="outline" size="sm" class="justify-start sm:justify-center" href="{toRoute('/graph')}{graphFocus(id)}">
				<Icon name="graph" size={16} />
				Voir dans le graphe
			</Button>
		</div>
	</div>
</div>

<p role="status" class="text-muted-foreground mt-2 text-sm empty:mt-0">{message}</p>
{#if manual}
	<div class="mt-2 max-w-xl">
		<label for="manual-copy" class="text-sm font-medium">{manual.what === "lien" ? "Lien à copier" : "Markdown à copier"}</label>
		<textarea
			id="manual-copy"
			bind:this={field}
			readonly
			rows={manual.what === "lien" ? 2 : 6}
			value={manual.text}
			class="border-input bg-card mt-1 block w-full rounded-md border px-3 py-2 font-mono text-sm"
		></textarea>
		<Button variant="ghost" size="sm" class="mt-1" onclick={() => { manual = null; message = ""; }}>Fermer</Button>
	</div>
{/if}
