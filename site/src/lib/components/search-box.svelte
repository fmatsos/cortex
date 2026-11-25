<script lang="ts">
	import { onMount, tick, untrack } from "svelte";
	import { goto } from "$app/navigation";
	import FilterChips from "#lib/components/filter-chips.svelte";
	import Icon from "#lib/components/icon.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import ResultRow from "#lib/components/result-row.svelte";
	import { Input } from "#lib/components/ui/input/index.js";
	import { favs } from "#lib/favs.svelte.js";
	import { toPage, toRoute } from "#lib/links.js";
	import { fold } from "#lib/fold.js";
	import type { IconName } from "#lib/icons.js";
	import { parseQuery, questionLike, wantsFav, withPassage } from "#lib/query.js";
	import { type Engine, esc, highlight, loadEngine, search as searchIndex, suggest } from "#lib/search-client.js";
	import { cachedHybrid, hybrid, probe, rows as serverRows, semanticOnly, worthAsking, type Row } from "#lib/server-search.js";
	import { search } from "#lib/search-state.svelte.js";
	import { assistant } from "#lib/assistant.svelte.js";
	import { theme } from "#lib/theme.svelte.js";
	import { lang } from "#lib/lang.svelte.js";
	import { defaultLocale, LOCALE_NAMES, t } from "#lib/i18n/index.js";
	import type { SearchDoc } from "#lib/types.js";

	// Command palette: recent searches, filters (#tag, type:, status:, is:), terms, pages, then general commands.
	// The query is that of the shared state (`search.q`): the header field, the large home field and that of /search/ are
	// a single search. variant "main": large page field; "header": compact header field.
	// live: on the results page, where the full list is already displayed, the dropdown only offers suggestions.
	// wide: the panel spans the nearest positioned ancestor (the site header) instead of the field
	let { variant = "header", live = false, wide = false, class: className = "" }: { variant?: "header" | "main"; live?: boolean; wide?: boolean; class?: string } = $props();
	const main = $derived(variant === "main");

	let engine = $state<Engine>();
	let open = $state(false);
	let active = $state(-1);
	let input = $state<HTMLInputElement | null>(null);
	let wrap = $state<HTMLElement | null>(null);
	let mac = $state(false);
	let notice = $state("");
	let failed = $state(false); // the search index could not be loaded
	// pages found by meaning (`cortex serve` only): added after the local pages, once typing pauses; null for the query they answer
	let semantic = $state<{ q: string; rows: Row[] }>();
	let panelMax = $state<number>(); // room for the panel (px): it never exceeds the visible screen; undefined until measured
	let above = $state(false); // little room below the field (low window, virtual keyboard) and more above: the panel opens upwards
	const uid = $props.id(); // stable identifier: the prerendered HTML is identical on every export
	const listId = `sb-${uid}`;
	const value = $derived(search.q);
	const setValue = (v: string) => { search.q = v; };

	onMount(() => { mac = /mac|iphone|ipad/i.test(navigator.platform); });
	// this field is the one that Ctrl+K and "/" activate as long as it is on screen
	$effect(() => (input ? search.register(input) : undefined));
	const warm = () => { failed = false; loadEngine().then((e) => (engine = e), () => (failed = true)); };
	const abs = (rel: string) => new URL(rel, location.href).href;
	let flashTimer: ReturnType<typeof setTimeout>;
	const flash = (m: string) => { notice = m; clearTimeout(flashTimer); flashTimer = setTimeout(() => (notice = ""), 1800); };
	onMount(() => () => clearTimeout(flashTimer));

	// available height between the field and the bottom of the visible screen (virtual keyboard included)
	const measure = () => {
		if (!wrap) return;
		const vv = window.visualViewport;
		const r = wrap.getBoundingClientRect(), seen = vv ? vv.offsetTop + vv.height : innerHeight;
		const below = seen - r.bottom - 12, over = r.top - (vv?.offsetTop ?? 0) - 12;
		above = below < LOW && over > below;
		// no minimum: a floor taller than the visible space (landscape phone, virtual keyboard) would push the options off screen
		panelMax = Math.max(0, Math.min(above ? over : below, 560));
	};
	const LOW = 120; // below this room under the field, the other side is used when it has more
	// a short panel keeps the room for the options: the filter chips (also on the results page) step aside below this height
	const SHORT_PANEL = 240;
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

	type Item = { key: string; kind: "recent" | "filter" | "term" | "page" | "command" | "all" | "ask"; group?: string; icon?: IconName; html: string; sub?: string; snippet?: string; note?: string; doc?: SearchDoc; run: (newTab?: boolean) => void };
	const GO = (to: string) => () => goto(to);
	const commands = $derived<Item[]>(([
		["c:home", "home", t("cmd.home"), GO(toRoute("/"))],
		["c:favs", "favorites", t("cmd.favs"), GO(`${toRoute("/search")}?q=is%3Afav`)],
		["c:graph", "graph", t("cmd.graph"), GO(toRoute("/graph"))],
		["c:tags", "tags", t("cmd.tags"), GO(toRoute("/tags"))],
		["c:log", "journal", t("cmd.log"), GO(toRoute("/log"))],
		["c:theme", theme.mode === "dark" ? "moon" : theme.mode === "light" ? "sun" : "system", t("cmd.theme", { current: theme.label }), () => theme.cycle()],
		["c:lang", "language", t("cmd.lang", { current: lang.choice === "system" ? t("lang.default", { name: LOCALE_NAMES[defaultLocale] }) : LOCALE_NAMES[lang.choice] }), () => lang.cycle()],
	] as [string, IconName, string, () => void][]).map(([key, icon, label, go]) => ({ key, kind: "command" as const, group: t("palette.commands"), icon, html: esc(label), run: () => { if (key !== "c:theme" && key !== "c:lang") open = false; go(); } })));

	const items = $derived.by<Item[]>(() => {
		if (!open) return [];
		const out: Item[] = [];
		const q = value.trim();
		const has = (id: string) => favs.has(id);
		const filter = (f: { label: string; insert: string; count?: number; hint?: string }): Item => ({
			key: `f:${f.insert}`, kind: "filter", group: t("palette.filters"), icon: "filter", html: esc(f.label),
			sub: f.count !== undefined ? t("common.pages", { count: f.count }) : f.hint,
			run: () => { setValue(f.insert); active = -1; input?.focus(); },
		});
		if (!q) {
			// knowledge access first (recent, filters), general commands in a secondary group
			if (search.recent.length) {
				for (const r of search.recent) out.push({ key: `r:${r}`, kind: "recent", group: t("home.recent"), icon: "recent", html: esc(r), run: () => { setValue(r); active = -1; submit(); } });
				out.push({ key: "r-clear", kind: "command", group: t("home.recent"), icon: "clear", html: esc(t("home.recent.clear")), run: () => { search.forget(); active = -1; input?.focus(); } });
			}
			if (engine) out.push(...suggest(engine, "", has).filters.map(filter));
			if (!live) out.push(...commands);
			return out;
		}
		// search and questions are apart: Enter searches; the assistant is offered as one more item (choosing it opens the panel with
		// the text as a draft, nothing is sent). A phrase that reads as a question gets it first; any other text gets it after the
		// suggestions, so ArrowDown still lands on the search first (Ctrl+Enter reaches the assistant from the field in both cases).
		const ask: Item | undefined = assistant.api ? {
			key: "ask", kind: "ask", group: t("assistant.title"),
			html: esc(t("assistant.askThis")), snippet: esc(`« ${q} »`),
			sub: assistant.pending ? t("assistant.busy") : undefined,
			run: () => toAssistant(),
		} : undefined;
		const askFirst = !!ask && questionLike(q);
		if (ask && askFirst) out.push(ask);
		if (!engine) { if (ask && !askFirst) out.push(ask); return out; }
		const { filters, terms, titles } = suggest(engine, value, has);
		out.push(...filters.map(filter));
		for (const term of terms) out.push({ key: `t:${term}`, kind: "term", group: t("palette.terms"), icon: "search", html: esc(term), run: () => { setValue(term); active = -1; input?.focus(); } });
		const seen = new Set<string>();
		const page = (d: SearchDoc, html: string, snippet?: string) => {
			if (seen.has(d.id) || seen.size >= 6) return;
			seen.add(d.id);
			out.push({ key: `p:${d.id}`, kind: "page", group: t("palette.pages"), html, snippet, doc: d, run: (newTab) => open_(d, newTab) });
		};
		const { hits, total } = live ? { hits: [], total: 0 } : searchIndex(engine, value, has, 6);
		const found = new Map(hits.map((h) => [h.doc.id, h.snippet]));
		for (const d of titles) page(d, esc(d.title), found.get(d.id) ?? esc(d.description));
		for (const h of hits) page(h.doc, h.title, h.snippet);
		// found by meaning only, after the local pages (never among them, never before): an arrow key in progress stays on its row
		if (!live && semantic?.q === q) {
			const p = parseQuery(q);
			for (const r of semanticOnly(semantic.rows, seen)) {
				seen.add(r.doc.id);
				out.push({ key: `p:${r.doc.id}`, kind: "page", group: t("palette.pages"), html: highlight(r.doc.title, p), snippet: highlight(r.hit.extract, p), note: t("search.match.semantic"), doc: r.doc, run: (newTab) => open_(r.doc, newTab) });
			}
		}
		const toks = fold(q).split(/\s+/);
		if (!live) for (const c of commands) if (toks.every((w) => fold(c.html).includes(w))) out.push(c);
		if (ask && !askFirst) out.push(ask);
		// always visible access (sticky footer) to the full list, with its exact total
		if (total > 0) out.push({ key: "all", kind: "all", html: esc(t("palette.all", { q })), sub: t("common.pages", { count: total }), run: () => submit() });
		return out;
	});

	// Typing pauses (~250 ms): the server's hybrid results (no judge), when it has the API. The previous request is cancelled; offline or
	// on any error, nothing is said. The panel's own pages come first and stay: the new ones only add at the end of the page group.
	const DEBOUNCE = 250;
	const accept = (q: string, res: Awaited<ReturnType<typeof hybrid>>) => {
		if (!engine || !open || value.trim() !== q) return;
		const keep = cur?.key; // the active option stays the same option, wherever the list now puts it
		semantic = { q, rows: serverRows(engine, parseQuery(q), res, favs.has) };
		if (keep) { const i = items.findIndex((x) => x.key === keep); if (i >= 0) active = i; }
	};
	$effect(() => {
		const q = value.trim();
		if (live || !open || !engine || !q || !worthAsking(q)) return;
		const ctl = new AbortController();
		const cached = cachedHybrid(q);
		const run = async () => {
			try {
				if (!cached && !(await probe())) return;
				const res = cached ?? (await hybrid(q, ctl.signal));
				if (!ctl.signal.aborted) untrack(() => accept(q, res));
			} catch { /* offline, cancelled or failing server: the local results are the answer */ }
		};
		const id = cached ? undefined : setTimeout(run, DEBOUNCE);
		if (cached) void run();
		return () => { clearTimeout(id); ctl.abort(); };
	});

	/** The assistant, opened on the typed text as a draft (never sent: the visitor confirms with Enter in the panel). */
	const toAssistant = () => { open = false; active = -1; assistant.prefill(value); };
	/** Ctrl/Cmd+Enter: the typed text goes to the assistant right away (one question at a time: a pending one only gets the draft). */
	const askNow = () => {
		const q = value.trim();
		open = false;
		active = -1;
		if (assistant.pending) assistant.prefill(q); else assistant.ask(q);
	};

	/** Opens a page; the query goes with it (`?q=`) so that the article highlights and offers the found passage. */
	function open_(d: SearchDoc, newTab?: boolean) {
		const href = withPassage(toPage(d.id), value);
		search.remember(value);
		open = false;
		if (newTab) window.open(abs(href), "_blank", "noopener"); else goto(href);
	}
	// Enter: the search (a question goes to the assistant through its own item)
	const submit = () => {
		open = false;
		active = -1;
		const q = value.trim();
		if (!q) return;
		search.remember(q);
		search.validated = q;
		if (!live) goto(`${toRoute("/search")}?q=${encodeURIComponent(q)}`);
	};
	const copy = async (d: SearchDoc) => {
		try { await navigator.clipboard.writeText(abs(withPassage(toPage(d.id), value))); flash(t("common.linkCopied")); } catch { flash(t("common.copyFailed")); }
	};
	// message in place of an empty list (in the palette only: the results page shows its own)
	const state = $derived.by(() => {
		if (live || !open || !value.trim()) return undefined;
		if (failed) return "error";
		if (!engine) return "loading";
		if (items.some((i) => i.kind !== "ask")) return undefined; // the ask item alone must not hide loading, failure or "no result"
		return wantsFav(parseQuery(value)) && !favs.ids.length ? "nofav" : "none";
	});
	const reset = () => { setValue(""); input?.focus(); };
	// the active option must exist in the displayed list (the list can change without typing)
	const act = $derived(open && active < items.length ? active : -1);
	const cur = $derived(items[act]);

	function onkeydown(e: KeyboardEvent) {
		// Ctrl/Cmd+Enter takes the raw typed text to the assistant, even over a highlighted suggestion
		if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing && assistant.api && value.trim()) { e.preventDefault(); askNow(); return; }
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
			// actions on the selected result (key code: Alt+letter produces another character on macOS)
			if (e.code === "KeyF") { e.preventDefault(); favs.toggle(cur.doc.id); }
			else if (e.code === "KeyC") { e.preventDefault(); copy(cur.doc); }
		}
	}

	// the panel closes when focus leaves the field + panel group (Tab to the chips does not close it)
	const onfocusout = (e: FocusEvent) => {
		if (!wrap?.contains(e.relatedTarget as Node | null)) { open = false; active = -1; }
	};
	const wrapKeys = (e: KeyboardEvent) => {
		if (e.key === "Escape" && e.target !== input) { open = false; active = -1; input?.focus(); }
	};
	const mod = $derived(mac ? "⌘" : "Ctrl");
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div bind:this={wrap} class="{wide ? '' : 'relative'} {className}" {onfocusout} onkeydown={wrapKeys}>
	<div class={main ? "flex items-center gap-2" : ""}>
	<div class="relative {main ? 'min-w-0 flex-1' : ''}">
		<Icon name="search" size={main ? 24 : 20} class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
		<Input
			bind:ref={input}
			type="search"
			value={search.q}
			oninput={(e) => { setValue(e.currentTarget.value); if (!engine && !failed) warm(); open = true; active = -1; }}
			placeholder={main ? t("search.placeholder.main") : t("search.placeholder.header")}
			aria-label={t("search.label")}
			role="combobox"
			aria-expanded={open && items.length > 0}
			aria-controls={listId}
			aria-autocomplete="list"
			aria-activedescendant={act >= 0 ? `${listId}-${act}` : undefined}
			autocomplete="off"
			spellcheck="false"
			class="{!main && assistant.api ? 'pr-10' : 'pr-14'} pl-10 {main ? 'h-12 pl-12 text-base md:text-base pointer-coarse:h-12' : ''}"
			onfocus={() => { if (!engine) warm(); open = true; }}
			{onkeydown}
		/>
		<!-- the compact field with the assistant button has no room for the hint (the shortcut itself still works) -->
		{#if !value && (main || !assistant.api)}
			<kbd class="text-muted-foreground pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 border px-1.5 text-xs sm:block pointer-coarse:hidden">{mod} K</kbd>
		{/if}
		{#if assistant.api && !main}
			<!-- inside the compact field: the text typed so far goes to the assistant as a draft -->
			<Button variant="ghost" size="icon-xs" class="absolute inset-y-0 right-1 my-auto [&_svg:not([class*='size-'])]:size-4" aria-label={t("assistant.askThis")} title="{t('assistant.askThis')} ({t('assistant.askSend', { key: mod })})" aria-keyshortcuts="Control+Enter Meta+Enter" onclick={toAssistant}>
				<Icon name="assistant" size={16} />
			</Button>
		{/if}
	</div>
	{#if assistant.api && main}
		<!-- beside the large field there is room for the label; narrow screens keep the icon, the name stays -->
		<Button variant="outline" class="h-12 shrink-0 px-3" title="{t('assistant.askThis')} ({t('assistant.askSend', { key: mod })})" aria-keyshortcuts="Control+Enter Meta+Enter" onclick={toAssistant}>
			<Icon name="assistant" size={16} /><span class="sr-only sm:not-sr-only">{t("assistant.askThis")}</span>
		</Button>
	{/if}
	</div>
	{#if open && (items.length || (!live && value.trim()))}
		<!-- mousedown with no focus effect: the field keeps focus, so the panel does not close before the click -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="bg-popover text-popover-foreground absolute {wide ? 'inset-x-4 lg:inset-x-8' : 'inset-x-0'} border-input shadow-overlay z-50 {above ? 'bottom-full mb-1.5' : 'mt-1.5'} flex flex-col rounded-lg border p-1" style:max-height={panelMax !== undefined ? `${panelMax}px` : undefined} onmousedown={(e) => e.preventDefault()}>
			{#if !live && (panelMax === undefined || panelMax >= SHORT_PANEL)}<FilterChips value={search.q} class="px-1.5 pt-1 pb-1.5" />{/if}
			<ul id={listId} role="listbox" aria-label={t("palette.suggestions")} class="min-h-0 flex-1 scroll-pb-10 overflow-auto">
				{#each items as item, i (item.key)}
					{@const sel = i === act}
					{#if item.group && item.group !== items[i - 1]?.group}
						<li role="presentation" class="text-muted-foreground px-2 pt-2 pb-1 text-xs font-semibold tracking-wide uppercase">{item.group}</li>
					{/if}
					<li role="presentation" class="group flex flex-wrap items-start rounded-md {sel ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'} {item.kind === 'all' ? `sticky bottom-0 mt-1 border-t font-medium ${sel ? '' : 'bg-popover'}` : ''}">
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div id="{listId}-{i}" role="option" aria-selected={sel} tabindex="-1" class="min-h-9 min-w-0 flex-1 cursor-pointer px-2 py-1.5 text-sm pointer-coarse:min-h-11" onmousemove={() => { if (active !== i) active = i; }} onclick={(e) => item.run(e.ctrlKey || e.metaKey)}>
							{#if item.kind === "ask"}
								<!-- short action label, the question on its own lines (never cut to one line on a phone) -->
								<span class="flex items-start gap-2">
									<Icon name="assistant" size={16} />
									<span class="min-w-0 flex-1">
										<span class="font-medium">{@html item.html}</span>
										<span class="text-muted-foreground line-clamp-2 block break-words">{@html item.snippet}</span>
										{#if item.sub}<span class="text-muted-foreground block text-xs">{item.sub}</span>{/if}
									</span>
									<kbd class="text-muted-foreground hidden shrink-0 border px-1 text-xs sm:block pointer-coarse:hidden">{t("assistant.askKey", { key: mod })}</kbd>
								</span>
							{:else if item.doc}
								<ResultRow compact selected={sel} doc={item.doc} titleHtml={item.html} snippetHtml={item.snippet} note={item.note} />
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
							<!-- actions outside the option (no button inside an option): visible on hover, on selection, and always on touch -->
							<button type="button" tabindex="-1" aria-pressed={favs.has(item.doc.id)} aria-label={t("fav.toggleLabel", { title: item.doc.title })} class="text-muted-foreground hover:text-foreground size-9 shrink-0 items-center justify-center rounded-md {sel || favs.has(item.doc.id) ? 'inline-flex' : 'hidden group-hover:inline-flex pointer-coarse:inline-flex'}" onclick={() => favs.toggle(item.doc!.id)}>
								<Icon name="star" size={20} filled={favs.has(item.doc.id)} class={favs.has(item.doc.id) ? "text-favorite" : ""} />
							</button>
							{#if sel}
								<div class="text-muted-foreground flex basis-full flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-1.5 text-sm">
									<span><kbd class="border px-1">↵</kbd> {t("palette.key.open")}</span>
									{#if !assistant.api}<span><kbd class="border px-1">{mod} ↵</kbd> {t("palette.key.newTab")}</span>{/if}
									<span><kbd class="border px-1">Alt F</kbd> {t("palette.key.fav")}</span>
									<button type="button" tabindex="-1" class="hover:text-foreground inline-flex min-h-6 items-center gap-1" onclick={() => copy(item.doc!)}><Icon name="copy-link" size={16} /><kbd class="border px-1">Alt C</kbd> {t("palette.key.copy")}</button>
								</div>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
			{#if state}
				<div class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-3 text-sm" role="status">
					{#if state === "loading"}{t("search.loadingIndex")}
					{:else if state === "error"}
						<Icon name="error" size={16} />{t("search.indexUnavailable")}
						<button type="button" class="text-foreground inline-flex min-h-6 items-center gap-1 underline underline-offset-4" onclick={warm}><Icon name="retry" size={16} />{t("common.retry")}</button>
					{:else}
						{state === "nofav" ? t("search.noFavs") : t("search.noResultsFor", { q: value.trim() })}
						<button type="button" class="text-foreground inline-flex min-h-6 items-center gap-1 underline underline-offset-4" onclick={reset}>{t("common.reset")}</button>
					{/if}
				</div>
			{/if}
			{#if notice}<p class="text-muted-foreground px-2 py-1 text-sm" role="status">{notice}</p>{/if}
		</div>
	{/if}
</div>
