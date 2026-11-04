<script lang="ts">
	import { onMount, tick } from "svelte";
	import { goto } from "$app/navigation";
	import FilterChips from "#lib/components/filter-chips.svelte";
	import Icon from "#lib/components/icon.svelte";
	import ResultRow from "#lib/components/result-row.svelte";
	import { Input } from "#lib/components/ui/input/index.js";
	import { favs } from "#lib/favs.svelte.js";
	import { toPage, toRoute } from "#lib/links.js";
	import { fold } from "#lib/fold.js";
	import type { IconName } from "#lib/icons.js";
	import { parseQuery, wantsFav, withPassage } from "#lib/query.js";
	import { type Engine, esc, loadEngine, search as searchIndex, suggest } from "#lib/search-client.js";
	import { search } from "#lib/search-state.svelte.js";
	import { theme } from "#lib/theme.svelte.js";
	import type { SearchDoc } from "#lib/types.js";

	// Palette de commandes : recherches récentes, filtres (#tag, type:, status:, is:), termes, pages, puis commandes générales.
	// La requête est celle de l'état partagé (`search.q`) : le champ de l'en-tête, le grand champ de l'accueil et celui de /search/ sont
	// une seule recherche. variant « main » : grand champ de la page ; « header » : champ compact de l'en-tête.
	// live : sur la page de résultats, où la liste complète est déjà affichée, la liste déroulante ne propose que des suggestions.
	let { variant = "header", live = false, class: className = "" }: { variant?: "header" | "main"; live?: boolean; class?: string } = $props();
	const main = $derived(variant === "main");

	let engine = $state<Engine>();
	let open = $state(false);
	let active = $state(-1);
	let input = $state<HTMLInputElement | null>(null);
	let wrap = $state<HTMLElement | null>(null);
	let mac = $state(false);
	let notice = $state("");
	let failed = $state(false); // l'index de recherche n'a pas pu être chargé
	let panelMax = $state(0); // hauteur disponible sous le champ (px) : le panneau ne dépasse jamais l'écran visible
	const uid = $props.id(); // identifiant stable : le HTML prérendu est identique à chaque export
	const listId = `sb-${uid}`;
	const value = $derived(search.q);
	const setValue = (v: string) => { search.q = v; };

	onMount(() => { mac = /mac|iphone|ipad/i.test(navigator.platform); });
	// ce champ est celui que Ctrl+K et « / » activent tant qu'il est à l'écran
	$effect(() => (input ? search.register(input) : undefined));
	const warm = () => { failed = false; loadEngine().then((e) => (engine = e), () => (failed = true)); };
	const abs = (rel: string) => new URL(rel, location.href).href;
	let flashTimer: ReturnType<typeof setTimeout>;
	const flash = (m: string) => { notice = m; clearTimeout(flashTimer); flashTimer = setTimeout(() => (notice = ""), 1800); };
	onMount(() => () => clearTimeout(flashTimer));

	// hauteur disponible entre le champ et le bas de l'écran visible (clavier virtuel compris)
	const measure = () => {
		if (!wrap) return;
		const vv = window.visualViewport;
		const bottom = wrap.getBoundingClientRect().bottom, seen = vv ? vv.offsetTop + vv.height : innerHeight;
		panelMax = Math.max(180, Math.min(seen - bottom - 12, 560));
	};
	$effect(() => {
		if (!open) return;
		measure();
		const vv = window.visualViewport;
		vv?.addEventListener("resize", measure);
		vv?.addEventListener("scroll", measure);
		addEventListener("resize", measure);
		addEventListener("scroll", measure, { passive: true });
		return () => {
			vv?.removeEventListener("resize", measure);
			vv?.removeEventListener("scroll", measure);
			removeEventListener("resize", measure);
			removeEventListener("scroll", measure);
		};
	});

	type Item = { key: string; kind: "recent" | "filtre" | "terme" | "page" | "commande" | "tous"; group?: string; icon?: IconName; html: string; sub?: string; snippet?: string; doc?: SearchDoc; run: (newTab?: boolean) => void };
	const GO = (to: string) => () => goto(to);
	const commands = $derived<Item[]>(([
		["c:home", "home", "Aller à l'accueil", GO(toRoute("/"))],
		["c:favs", "favorites", "Aller aux favoris", GO(`${toRoute("/search")}?q=is%3Afav`)],
		["c:graph", "graph", "Aller au graphe", GO(toRoute("/graph"))],
		["c:tags", "tags", "Aller aux tags", GO(toRoute("/tags"))],
		["c:log", "journal", "Aller au journal", GO(toRoute("/log"))],
		["c:theme", theme.mode === "dark" ? "moon" : theme.mode === "light" ? "sun" : "system", `Changer de thème (actuel : ${theme.label})`, () => theme.cycle()],
	] as [string, IconName, string, () => void][]).map(([key, icon, label, go]) => ({ key, kind: "commande" as const, group: "Commandes", icon, html: label, run: () => { if (key !== "c:theme") open = false; go(); } })));

	const items = $derived.by<Item[]>(() => {
		if (!open) return [];
		const out: Item[] = [];
		const q = value.trim();
		const has = (id: string) => favs.has(id);
		const filter = (f: { label: string; insert: string; count?: number; hint?: string }): Item => ({
			key: `f:${f.insert}`, kind: "filtre", group: "Filtres", icon: "filter", html: esc(f.label),
			sub: f.count !== undefined ? `${f.count} page${f.count > 1 ? "s" : ""}` : f.hint,
			run: () => { setValue(f.insert); active = -1; input?.focus(); },
		});
		if (!q) {
			// d'abord l'accès aux connaissances (récentes, filtres), les commandes générales en groupe secondaire
			if (search.recent.length) {
				for (const r of search.recent) out.push({ key: `r:${r}`, kind: "recent", group: "Recherches récentes", icon: "recent", html: esc(r), run: () => { setValue(r); active = -1; submit(); } });
				out.push({ key: "r-clear", kind: "commande", group: "Recherches récentes", icon: "clear", html: "Effacer l'historique", run: () => { search.forget(); active = -1; input?.focus(); } });
			}
			if (engine) out.push(...suggest(engine, "", has).filters.map(filter));
			if (!live) out.push(...commands);
			return out;
		}
		if (!engine) return out;
		const { filters, terms, titles } = suggest(engine, value, has);
		out.push(...filters.map(filter));
		for (const t of terms) out.push({ key: `t:${t}`, kind: "terme", group: "Termes", icon: "search", html: esc(t), run: () => { setValue(t); active = -1; input?.focus(); } });
		const seen = new Set<string>();
		const page = (d: SearchDoc, html: string, snippet?: string) => {
			if (seen.has(d.id) || seen.size >= 6) return;
			seen.add(d.id);
			out.push({ key: `p:${d.id}`, kind: "page", group: "Pages", html, snippet, doc: d, run: (newTab) => open_(d, newTab) });
		};
		const { hits, total } = live ? { hits: [], total: 0 } : searchIndex(engine, value, has, 6);
		const found = new Map(hits.map((h) => [h.doc.id, h.snippet]));
		for (const d of titles) page(d, esc(d.title), found.get(d.id) ?? esc(d.description));
		for (const h of hits) page(h.doc, h.title, h.snippet);
		const toks = fold(q).split(/\s+/);
		if (!live) for (const c of commands) if (toks.every((t) => fold(c.html).includes(t))) out.push(c);
		// accès toujours visible (pied collant) à la liste complète, avec son total exact
		if (total > 0) out.push({ key: "all", kind: "tous", html: `Tous les résultats pour « ${esc(q)} »`, sub: `${total} page${total > 1 ? "s" : ""}`, run: () => submit() });
		return out;
	});

	/** Ouvre une page ; la requête l'accompagne (`?q=`) pour que l'article surligne et propose le passage trouvé. */
	function open_(d: SearchDoc, newTab?: boolean) {
		const href = withPassage(toPage(d.id), value);
		search.remember(value);
		open = false;
		if (newTab) window.open(abs(href), "_blank", "noopener"); else goto(href);
	}
	const submit = () => {
		open = false;
		active = -1;
		const q = value.trim();
		if (q) search.remember(q);
		if (!live && q) goto(`${toRoute("/search")}?q=${encodeURIComponent(q)}`);
	};
	const copy = async (d: SearchDoc) => {
		try { await navigator.clipboard.writeText(abs(withPassage(toPage(d.id), value))); flash("Lien copié"); } catch { flash("Copie impossible"); }
	};
	// message à la place d'une liste vide (dans la palette seulement : la page de résultats affiche les siens)
	const state = $derived.by(() => {
		if (live || !open || !value.trim()) return undefined;
		if (failed) return "error";
		if (!engine) return "loading";
		if (items.length) return undefined;
		return wantsFav(parseQuery(value)) && !favs.ids.length ? "nofav" : "none";
	});
	const reset = () => { setValue(""); input?.focus(); };
	// l'option active doit exister dans la liste affichée (la liste peut changer sans saisie)
	const act = $derived(open && active < items.length ? active : -1);
	const cur = $derived(items[act]);

	function onkeydown(e: KeyboardEvent) {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			if (!items.length) return;
			e.preventDefault();
			open = true;
			const n = items.length, d = e.key === "ArrowDown" ? 1 : -1;
			active = act < 0 ? (d > 0 ? 0 : n - 1) : (act + d + n) % n;
			void tick().then(() => document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" }));
		} else if (e.key === "Enter") {
			e.preventDefault();
			if (open && cur) cur.run(e.ctrlKey || e.metaKey);
			else submit();
		} else if (e.key === "Escape") {
			if (open && items.length) open = false;
			else setValue("");
			active = -1;
		} else if (e.altKey && cur?.doc) {
			// actions sur le résultat sélectionné (code de touche : Alt+lettre produit un autre caractère sous macOS)
			if (e.code === "KeyF") { e.preventDefault(); favs.toggle(cur.doc.id); }
			else if (e.code === "KeyC") { e.preventDefault(); copy(cur.doc); }
		}
	}

	// le panneau se ferme quand le focus quitte l'ensemble champ + panneau (Tab vers les puces ne le ferme pas)
	const onfocusout = (e: FocusEvent) => {
		if (!wrap?.contains(e.relatedTarget as Node | null)) { open = false; active = -1; }
	};
	const wrapKeys = (e: KeyboardEvent) => {
		if (e.key === "Escape" && e.target !== input) { open = false; active = -1; input?.focus(); }
	};
	const mod = $derived(mac ? "⌘" : "Ctrl");
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div bind:this={wrap} class="relative {className}" {onfocusout} onkeydown={wrapKeys}>
	<div class="relative">
		<Icon name="search" size={main ? 24 : 20} class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
		<Input
			bind:ref={input}
			type="search"
			value={search.q}
			oninput={(e) => { setValue(e.currentTarget.value); if (!engine && !failed) warm(); open = true; active = -1; }}
			placeholder={main ? "Rechercher dans tout le wiki : mots, #tag, type:…" : "Rechercher, #tag, type:…"}
			aria-label="Rechercher dans le wiki"
			role="combobox"
			aria-expanded={open && items.length > 0}
			aria-controls={listId}
			aria-autocomplete="list"
			aria-activedescendant={act >= 0 ? `${listId}-${act}` : undefined}
			autocomplete="off"
			spellcheck="false"
			class="pr-14 pl-10 {main ? 'h-12 pl-12 text-base md:text-base pointer-coarse:h-12' : ''}"
			onfocus={() => { if (!engine) warm(); open = true; }}
			{onkeydown}
		/>
		{#if !value}
			<kbd class="text-muted-foreground pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border px-1.5 text-xs sm:block pointer-coarse:hidden">{mod} K</kbd>
		{/if}
	</div>
	{#if open && (items.length || (!live && value.trim()))}
		<!-- mousedown sans effet de focus : le champ garde le focus, donc le panneau ne se ferme pas avant le clic -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="bg-popover text-popover-foreground absolute inset-x-0 z-50 mt-1.5 flex flex-col rounded-lg border p-1 shadow-lg" style:max-height={panelMax ? `${panelMax}px` : undefined} onmousedown={(e) => e.preventDefault()}>
			{#if !live}<FilterChips value={search.q} class="px-1.5 pt-1 pb-1.5" />{/if}
			<ul id={listId} role="listbox" aria-label="Suggestions" class="min-h-0 flex-1 scroll-pb-10 overflow-auto">
				{#each items as item, i (item.key)}
					{@const sel = i === act}
					{#if item.group && item.group !== items[i - 1]?.group}
						<li role="presentation" class="text-muted-foreground px-2 pt-2 pb-1 text-xs font-semibold tracking-wide uppercase">{item.group}</li>
					{/if}
					<li role="presentation" class="group flex flex-wrap items-start rounded-md {sel ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'} {item.kind === 'tous' ? `sticky bottom-0 mt-1 border-t font-medium ${sel ? '' : 'bg-popover'}` : ''}">
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div id="{listId}-{i}" role="option" aria-selected={sel} tabindex="-1" class="min-h-9 min-w-0 flex-1 cursor-pointer px-2 py-1.5 text-sm" onmousemove={() => { if (active !== i) active = i; }} onclick={(e) => item.run(e.ctrlKey || e.metaKey)}>
							{#if item.doc}
								<ResultRow compact selected={sel} doc={item.doc} titleHtml={item.html} snippetHtml={item.snippet} />
							{:else}
								<div class="flex items-baseline justify-between gap-3">
									<span class="flex min-w-0 items-center gap-2 {sel ? 'line-clamp-2' : 'truncate'}">
										{#if item.icon}<Icon name={item.icon} size={16} class="text-muted-foreground" />{/if}
										<span class="min-w-0 {sel ? '' : 'truncate'}">{@html item.html}</span>
									</span>
									{#if item.sub}<span class="text-muted-foreground shrink-0 text-sm">{item.sub}</span>{/if}
								</div>
							{/if}
						</div>
						{#if item.doc}
							<!-- actions hors de l'option (pas de bouton dans une option) : visibles au survol, à la sélection, et toujours au toucher -->
							<button type="button" tabindex="-1" aria-pressed={favs.has(item.doc.id)} aria-label="Favori : {item.doc.title}" class="text-muted-foreground hover:text-foreground size-9 shrink-0 items-center justify-center rounded-md {sel || favs.has(item.doc.id) ? 'inline-flex' : 'hidden group-hover:inline-flex pointer-coarse:inline-flex'}" onclick={() => favs.toggle(item.doc!.id)}>
								<Icon name="star" size={20} filled={favs.has(item.doc.id)} class={favs.has(item.doc.id) ? "text-favorite" : ""} />
							</button>
							{#if sel}
								<div class="text-muted-foreground flex basis-full flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-1.5 text-sm">
									<span><kbd class="rounded border px-1">↵</kbd> ouvrir</span>
									<span><kbd class="rounded border px-1">{mod} ↵</kbd> nouvel onglet</span>
									<span><kbd class="rounded border px-1">Alt F</kbd> favori</span>
									<button type="button" tabindex="-1" class="hover:text-foreground inline-flex min-h-6 items-center gap-1" onclick={() => copy(item.doc!)}><Icon name="copy-link" size={16} /><kbd class="rounded border px-1">Alt C</kbd> copier le lien</button>
								</div>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
			{#if state}
				<div class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-3 text-sm" role="status">
					{#if state === "loading"}Chargement de l'index…
					{:else if state === "error"}
						<Icon name="error" size={16} />Index de recherche indisponible.
						<button type="button" class="text-foreground inline-flex min-h-6 items-center gap-1 underline underline-offset-4" onclick={warm}><Icon name="retry" size={16} />Réessayer</button>
					{:else}
						{state === "nofav" ? "Aucun favori : ajoutez-en avec l'étoile d'une page." : `Aucun résultat pour « ${value.trim()} ».`}
						<button type="button" class="text-foreground inline-flex min-h-6 items-center gap-1 underline underline-offset-4" onclick={reset}>Réinitialiser</button>
					{/if}
				</div>
			{/if}
			{#if notice}<p class="text-muted-foreground px-2 py-1 text-sm" role="status">{notice}</p>{/if}
		</div>
	{/if}
</div>
