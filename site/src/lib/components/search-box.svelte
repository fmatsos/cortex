<script lang="ts">
	import { onMount } from "svelte";
	import { afterNavigate, goto } from "$app/navigation";
	import FilterChips from "#lib/components/filter-chips.svelte";
	import { Input } from "#lib/components/ui/input/index.js";
	import { favs } from "#lib/favs.svelte.js";
	import { toPage, toRoute } from "#lib/links.js";
	import { fold } from "#lib/fold.js";
	import { parseQuery, wantsFav } from "#lib/query.js";
	import { type Engine, esc, loadEngine, search, suggest } from "#lib/search-client.js";
	import { theme } from "#lib/theme.svelte.js";
	import { typeLabel } from "#lib/type-meta.js";
	import type { SearchDoc } from "#lib/types.js";

	// Palette de commandes : filtres (#tag, type:, status:, is:), termes, pages et commandes globales.
	// global : ⌘K / Ctrl+K et « / » donnent le focus (champ de l'en-tête) ; live : sur la page de résultats,
	// où la liste complète est déjà affichée, la liste déroulante ne propose que des suggestions.
	let { value = $bindable(""), global = false, live = false, class: className = "" } = $props();

	let engine = $state<Engine>();
	let open = $state(false);
	let active = $state(-1);
	let input = $state<HTMLInputElement | null>(null);
	let mac = $state(false);
	let notice = $state("");
	let failed = $state(false); // l'index de recherche n'a pas pu être chargé
	const uid = $props.id(); // identifiant stable : le HTML prérendu est identique à chaque export
	const listId = `sb-${uid}`;

	onMount(() => { mac = /mac|iphone|ipad/i.test(navigator.platform); });
	const warm = () => { failed = false; loadEngine().then((e) => (engine = e), () => (failed = true)); };
	// depuis l'en-tête, une navigation vers /search/ (envoi, précédent, suivant) reprend la requête de l'URL
	afterNavigate((nav) => {
		if (global && !nav.shallow && nav.to?.url.pathname === toRoute("/search")) value = nav.to.url.searchParams.get("q") ?? "";
	});
	const abs = (rel: string) => new URL(rel, location.href).href;
	const flash = (m: string) => { notice = m; setTimeout(() => (notice = ""), 1800); };

	type Item = { key: string; kind: "filtre" | "terme" | "page" | "commande" | "tous"; html: string; sub?: string; snippet?: string; doc?: SearchDoc; run: (newTab?: boolean) => void };
	const commands = $derived<Item[]>([
		["c:graph", "Aller au graphe", () => goto(toRoute("/graph"))],
		["c:log", "Aller au journal", () => goto(toRoute("/log"))],
		["c:favs", "Aller aux favoris", () => goto(`${toRoute("/")}#favoris`)],
		["c:tags", "Aller aux tags", () => goto(toRoute("/tags"))],
		["c:home", "Aller à l'accueil", () => goto(toRoute("/"))],
		["c:theme", `Changer de thème (actuel : ${theme.label})`, () => theme.cycle()],
	].map(([key, label, go]) => ({ key: key as string, kind: "commande" as const, html: label as string, run: () => { if (key !== "c:theme") open = false; (go as () => void)(); } })));

	const items = $derived.by<Item[]>(() => {
		if (!open) return [];
		const out: Item[] = [];
		const q = value.trim();
		const has = (id: string) => favs.has(id);
		const filter = (f: { label: string; insert: string; count?: number; hint?: string }): Item => ({
			key: `f:${f.insert}`, kind: "filtre", html: f.label,
			sub: f.count !== undefined ? `${f.count} page${f.count > 1 ? "s" : ""}` : f.hint,
			run: () => { value = f.insert; input?.focus(); },
		});
		if (!q) {
			if (!live) out.push(...commands);
			if (engine) out.push(...suggest(engine, "", has).filters.map(filter));
			return out;
		}
		if (!engine) return out;
		const { filters, terms, titles } = suggest(engine, value, has);
		out.push(...filters.map(filter));
		for (const t of terms) out.push({ key: `t:${t}`, kind: "terme", html: t, run: () => { value = t; input?.focus(); } });
		const seen = new Set<string>();
		const page = (d: SearchDoc, html: string, snippet?: string) => {
			if (seen.has(d.id) || seen.size >= 6) return;
			seen.add(d.id);
			out.push({ key: `p:${d.id}`, kind: "page", html, snippet, sub: typeLabel(d.type), doc: d, run: (newTab) => { open = false; newTab ? window.open(abs(toPage(d.id)), "_blank", "noopener") : goto(toPage(d.id)); } });
		};
		const { hits, total } = live ? { hits: [], total: 0 } : search(engine, value, has, 6);
		const found = new Map(hits.map((h) => [h.doc.id, h.snippet]));
		for (const d of titles) page(d, esc(d.title), found.get(d.id) ?? esc(d.description));
		for (const h of hits) page(h.doc, h.title, h.snippet);
		const toks = fold(q).split(/\s+/);
		if (!live) for (const c of commands) if (toks.every((t) => fold(c.html).includes(t))) out.push(c);
		// accès toujours visible (pied collant) à la liste complète, avec son total exact
		if (total > 0) out.push({ key: "all", kind: "tous", html: `Tous les résultats pour « ${esc(q)} »`, sub: `${total} page${total > 1 ? "s" : ""}`, run: () => submit() });
		return out;
	});

	const submit = () => {
		open = false;
		if (live) return;
		if (value.trim()) goto(`${toRoute("/search")}?q=${encodeURIComponent(value.trim())}`);
	};
	const copy = async (d: SearchDoc) => {
		try { await navigator.clipboard.writeText(abs(toPage(d.id))); flash("Lien copié"); } catch { flash("Copie impossible"); }
	};
	// message à la place d'une liste vide (dans la palette seulement : la page de résultats affiche les siens)
	const state = $derived.by(() => {
		if (live || !open || !value.trim()) return undefined;
		if (failed) return "error";
		if (!engine) return "loading";
		if (items.length) return undefined;
		return wantsFav(parseQuery(value)) && !favs.ids.length ? "nofav" : "none";
	});
	const reset = () => { value = ""; input?.focus(); };
	// l'option active doit exister dans la liste affichée (la liste peut changer sans saisie) et rester visible
	const act = $derived(open && active < items.length ? active : -1);
	const cur = $derived(items[act]);
	$effect(() => { if (cur) document.getElementById(`${listId}-${act}`)?.scrollIntoView({ block: "nearest" }); });

	function onkeydown(e: KeyboardEvent) {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			if (!items.length) return;
			e.preventDefault();
			open = true;
			const n = items.length, d = e.key === "ArrowDown" ? 1 : -1;
			active = act < 0 ? (d > 0 ? 0 : n - 1) : (act + d + n) % n;
		} else if (e.key === "Enter") {
			e.preventDefault();
			if (open && cur) cur.run(e.ctrlKey || e.metaKey);
			else submit();
		} else if (e.key === "Escape") {
			if (open && items.length) open = false;
			else value = "";
			active = -1;
		} else if (e.altKey && cur?.doc) {
			// actions sur le résultat sélectionné (code de touche : Alt+lettre produit un autre caractère sous macOS)
			if (e.code === "KeyF") { e.preventDefault(); favs.toggle(cur.doc.id); }
			else if (e.code === "KeyC") { e.preventDefault(); copy(cur.doc); }
		}
	}

	function globalKeys(e: KeyboardEvent) {
		const typing = /^(input|textarea|select)$/i.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
		if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
			e.preventDefault();
			input?.focus();
			input?.select();
		}
	}
	const mod = $derived(mac ? "⌘" : "Ctrl");
</script>

<svelte:window onkeydown={global ? globalKeys : undefined} />

<div class="relative {className}">
	<Input
		bind:ref={input}
		type="search"
		bind:value
		placeholder="Rechercher, #tag, type:…"
		aria-label="Rechercher dans le wiki"
		role="combobox"
		aria-expanded={open && items.length > 0}
		aria-controls={listId}
		aria-autocomplete="list"
		aria-activedescendant={act >= 0 ? `${listId}-${act}` : undefined}
		autocomplete="off"
		spellcheck="false"
		class="pr-14"
		onfocus={() => { if (!engine) warm(); open = true; }}
		onblur={() => { open = false; active = -1; }}
		oninput={() => { if (!engine && !failed) warm(); open = true; active = -1; }}
		{onkeydown}
	/>
	{#if global && !value}
		<kbd class="text-muted-foreground pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border px-1.5 text-xs sm:block">{mod} K</kbd>
	{/if}
	{#if open && (items.length || (!live && value.trim()))}
		<div class="bg-popover text-popover-foreground absolute right-0 z-50 mt-1 w-[min(34rem,calc(100vw-2rem))] rounded-lg border p-1 shadow-lg">
			{#if !live}<FilterChips bind:value class="px-1.5 pt-1 pb-1.5" />{/if}
			<ul id={listId} role="listbox" aria-label="Suggestions" class="max-h-96 scroll-pb-10 overflow-auto">
				{#each items as item, i (item.key)}
					{@const sel = i === act}
					<!-- mousedown plutôt que click : le champ garde le focus, donc la liste ne se ferme pas avant l'action -->
					<li id="{listId}-{i}" role="option" aria-selected={sel} class="cursor-pointer rounded-md px-2 py-1.5 text-sm {sel ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'} {item.kind === 'tous' ? `sticky bottom-0 mt-1 border-t font-medium ${sel ? '' : 'bg-popover'}` : ''}" onmousedown={(e) => { e.preventDefault(); item.run(e.ctrlKey || e.metaKey); }}>
						<div class="flex items-baseline justify-between gap-3">
							<span class="min-w-0 {sel ? 'line-clamp-2' : 'truncate'}">
								{#if item.kind === "terme"}<span class="text-muted-foreground">Terme · </span>{:else if item.kind === "filtre"}<span class="text-muted-foreground">Filtre · </span>{:else if item.kind === "commande"}<span class="text-muted-foreground">Commande · </span>{/if}
								{#if item.doc && favs.has(item.doc.id)}<span aria-label="favori" class="text-amber-500">★ </span>{/if}{@html item.html}
							</span>
							<span class="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
								{#if item.doc?.status === "draft"}<span class="rounded border px-1">brouillon</span>{/if}
								{#if item.doc?.needsReview}<span class="rounded border border-amber-500/60 px-1">à relire</span>{/if}
								{#if item.sub}<span>{item.sub}</span>{/if}
							</span>
						</div>
						{#if item.snippet}<p class="text-muted-foreground mt-0.5 text-xs {sel ? 'line-clamp-2' : 'line-clamp-1'}">{@html item.snippet}</p>{/if}
						{#if sel && item.doc}
							<div class="text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
								<span><kbd class="rounded border px-1">↵</kbd> ouvrir</span>
								<span><kbd class="rounded border px-1">{mod} ↵</kbd> nouvel onglet</span>
								<button type="button" tabindex="-1" class="hover:text-foreground" onmousedown={(e) => { e.preventDefault(); e.stopPropagation(); favs.toggle(item.doc!.id); }}><kbd class="rounded border px-1">Alt F</kbd> {favs.has(item.doc.id) ? "retirer des favoris" : "favori"}</button>
								<button type="button" tabindex="-1" class="hover:text-foreground" onmousedown={(e) => { e.preventDefault(); e.stopPropagation(); copy(item.doc!); }}><kbd class="rounded border px-1">Alt C</kbd> copier le lien</button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
			{#if state}
				<div class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-3 text-sm" role="status">
					{#if state === "loading"}Chargement de l'index…
					{:else if state === "error"}Index de recherche indisponible.<button type="button" tabindex="-1" class="text-foreground underline underline-offset-4" onmousedown={(e) => { e.preventDefault(); warm(); }}>Réessayer</button>
					{:else}
						{state === "nofav" ? "Aucun favori : ajoutez-en avec l'étoile ★ d'une page." : `Aucun résultat pour « ${value.trim()} ».`}
						<button type="button" tabindex="-1" class="text-foreground underline underline-offset-4" onmousedown={(e) => { e.preventDefault(); reset(); }}>Réinitialiser</button>
					{/if}
				</div>
			{/if}
			{#if notice}<p class="text-muted-foreground px-2 py-1 text-xs" role="status">{notice}</p>{/if}
		</div>
	{/if}
</div>
