<script lang="ts">
	import { onMount, tick, untrack } from "svelte";
	import { goto, replaceState } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import Icon from "#lib/components/icon.svelte";
	import TypeBadge from "#lib/components/type-badge.svelte";
	import { favs } from "#lib/favs.svelte.js";
	import { buildView, reconcileSelection, relationIndex, relationsOf, resolveFocus, searchNodes, type GNode, type GraphView } from "#lib/graph-model.js";
	import { SHAPE_LABEL, shapeOf, svgPoints } from "#lib/graph-shapes.js";
	import { toPage, toRoute } from "#lib/links.js";
	import type { GraphData } from "#lib/types.js";
	import type { createGraph } from "#lib/graph-sigma.js";
	import { TYPES, typeColor, typeLabel, typePlural } from "#lib/type-meta.js";
	import { t as tr } from "#lib/i18n/index.js";

	let el: HTMLDivElement, labels: HTMLDivElement;
	let raw = $state<GraphData>();
	let off = $state(new Set<string>());
	let tag = $state("");
	let error = $state("");
	let ready = $state(false);
	let sel = $state.raw<GNode | null>(null);
	let listMode = $state(false);
	let mode = $state<"graph" | "map">("graph");
	let notice = $state("");
	let query = $state("");
	let active = $state(0);
	let searchOpen = $state(false);
	let controller: ReturnType<typeof createGraph> | undefined;
	let apply: ((v: GraphView) => void) | undefined;
	let retry: () => void = () => {};
	let pendingFocus: string | null = null;
	const EMPTY: GraphView = { nodes: [], links: [], ids: new Set() };
	const view = $derived(raw ? buildView(raw, { off, tag }) : EMPTY);
	const shown = $derived(view.nodes.length);
	const types = $derived([...new Set(raw?.nodes.map((n) => n.type))].sort((a, b) => TYPES.findIndex((t) => t.type === a) - TYPES.findIndex((t) => t.type === b)));
	const tags = $derived.by(() => {
		const c = new Map<string, number>();
		for (const n of raw?.nodes ?? []) for (const t of n.tags) c.set(t, (c.get(t) ?? 0) + 1);
		return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	});
	const count = (type: string) => raw?.nodes.filter((n) => n.type === type).length ?? 0;
	const titles = $derived(new Map((raw?.nodes ?? []).map((n) => [n.id, n.title])));
	const nodesById = $derived(new Map(view.nodes.map((n) => [n.id, n])));
	const filtered = $derived(off.size > 0 || tag !== "");
	const rel = $derived(sel ? relationsOf(sel.id, view.links) : { cites: [], citedBy: [] });
	const neighborCount = $derived(new Set([...rel.cites, ...rel.citedBy]).size);
	const index = $derived(relationIndex(view));
	const sorted = $derived([...view.nodes].sort((a, b) => a.title.localeCompare(b.title, "fr")));
	const results = $derived(searchNodes(raw?.nodes ?? [], query));
	const rowId = (id: string) => `g-${id.replace(/[^a-z0-9]+/gi, "-")}`;
	const nodeById = (id: string) => nodesById.get(id);
	const toggle = (type: string) => { const s = new Set(off); s.has(type) ? s.delete(type) : s.add(type); off = s; };
	const resetFilters = () => { off = new Set(); tag = ""; notice = ""; };
	const fit = () => controller?.fit();
	const zoomBy = (factor: number) => controller?.zoom(factor);
	/** Graph or map presentation; kept in the URL (?view=map) so a map can be shared and reloaded. */
	function setMode(next: "graph" | "map") {
		mode = next; controller?.mode(next);
		const url = new URL(location.href);
		if (next === "map") url.searchParams.set("view", "map"); else url.searchParams.delete("view");
		replaceState(url, {});
	}
	function select(n: GNode | null, center?: string) { sel = n; controller?.select(n?.id ?? null, !!center); }

	$effect(() => {
		const v = view;
		untrack(() => apply?.(v));
	});

	async function focusNode(id: string) {
		if (!raw?.nodes.some((n) => n.id === id)) { notice = tr("graph.notInGraph"); return; }
		notice = "";
		if (listMode) { listMode = false; await tick(); }
		if (!view.ids.has(id)) { pendingFocus = id; notice = tr("graph.filtersReset"); off = new Set(); tag = ""; return; }
		const n = nodeById(id); if (n) select(n, "focus");
	}
	const choose = (id: string) => { query = ""; searchOpen = false; active = 0; void focusNode(id); };
	function onSearchKey(e: KeyboardEvent) {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			if (!results.length) return;
			e.preventDefault(); searchOpen = true;
			active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
		} else if (e.key === "Enter" && searchOpen && results[active]) { e.preventDefault(); choose(results[active].id); }
		else if (e.key === "Escape" && (query || searchOpen)) { e.preventDefault(); query = ""; searchOpen = false; }
	}

	onMount(() => {
		let generation = 0;
		const motion = matchMedia("(prefers-reduced-motion: reduce)"), theme = matchMedia("(prefers-color-scheme: dark)");
		const onMotion = () => controller?.motion(motion.matches), onTheme = () => controller?.theme();
		motion.addEventListener("change", onMotion); theme.addEventListener("change", onTheme);
		window.addEventListener("themechange", onTheme);
		const teardown = () => { generation++; controller?.kill(); controller = undefined; apply = undefined; ready = false; };
		async function start() {
			const me = ++generation; error = "";
			try {
				const response = await fetch(resolve("/graph.json"));
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const g = await response.json() as GraphData;
				if (me !== generation) return;
				raw = g; // The HTML list remains available even if WebGL is unavailable.
				const [{ createGraph }] = await Promise.all([import("#lib/graph-sigma.js"), document.fonts.ready]);
				if (me !== generation) return;
				controller = createGraph(el, labels, g, { select: (id) => select(id ? nodeById(id) ?? null : null), open: (id) => { void goto(toPage(id)); }, favorite: (id) => favs.has(id) });
				apply = (v) => {
					const keep = reconcileSelection(sel?.id, v.ids);
					sel = keep ? v.nodes.find((n) => n.id === keep) ?? null : null;
					controller!.apply(v); controller!.select(sel?.id ?? null);
					if (pendingFocus && v.ids.has(pendingFocus)) { const id = pendingFocus; pendingFocus = null; void focusNode(id); }
				};
				mode = new URLSearchParams(location.search).get("view") === "map" ? "map" : "graph";
				controller.mode(mode);
				apply(view); ready = true;
				const wanted = resolveFocus(location.search, g.nodes);
				if (wanted.id) await focusNode(wanted.id);
				else if (wanted.asked) notice = tr("graph.pageNotInGraph", { title: wanted.asked });
			} catch (e) { if (me === generation) { controller?.kill(); controller = undefined; ready = false; error = (e as Error).message; } }
		}
		retry = () => { teardown(); void start(); };
		void start();
		return () => { teardown(); retry = () => {}; motion.removeEventListener("change", onMotion); theme.removeEventListener("change", onTheme); window.removeEventListener("themechange", onTheme); };
	});
</script>

{#snippet shape(type: string, size = 14)}
	{@const sh = shapeOf(type)}
	{@const pts = svgPoints(sh, size)}
	<svg width={size} height={size} viewBox="0 0 {size} {size}" aria-hidden="true" focusable="false" class="shrink-0" style="fill: {typeColor(type)}">
		{#if pts}<polygon points={pts} stroke-linejoin="round" />{:else}<circle cx={size / 2} cy={size / 2} r={size * 0.4} />{/if}
	</svg>
{/snippet}

<svelte:window onkeydown={(e) => { if (e.key === "Escape" && sel && !e.defaultPrevented) select(null); }} />

<div class="touch-gap flex flex-wrap items-center gap-2" role="group" aria-label={tr("graph.filters")}>
	{#each types as t (t)}
		<button
			type="button"
			aria-pressed={!off.has(t)}
			onclick={() => toggle(t)}
			class="focus-visible:ring-ring/50 pointer-coarse:min-h-11 inline-flex h-8 items-center gap-2 border px-3 text-sm motion-safe:transition-opacity focus-visible:ring-3 {off.has(t) ? 'opacity-60' : ''}"
		>
			{@render shape(t)}
			{typePlural(t)} <span class="text-muted-foreground">{count(t)}</span>
			<span class="sr-only">{tr("graph.shapeSr", { shape: SHAPE_LABEL[shapeOf(t)] })}</span>
		</button>
	{/each}
	<label class="text-muted-foreground ml-1 flex items-center gap-2 text-sm">
		{tr("graph.tag")}
		<select bind:value={tag} class="bg-background text-foreground focus-visible:ring-ring/50 pointer-coarse:h-11 h-8 border px-2 text-sm focus-visible:ring-3">
			<option value="">{tr("graph.allTags")}</option>
			{#each tags as [t, n] (t)}<option value={t}>{t} ({n})</option>{/each}
		</select>
	</label>
	{#if filtered}<Button variant="ghost" size="sm" onclick={resetFilters}><Icon name="clear" size={16} />{tr("graph.resetFilters")}</Button>{/if}
	<span class="text-muted-foreground ml-auto text-sm" aria-live="polite">{tr("common.pages", { count: shown })}</span>
</div>

<div class="touch-gap mt-2 flex flex-wrap items-center gap-2" role="group" aria-label={tr("graph.controls")}>
	<div class="flex" role="group" aria-label={tr("graph.mode.label")}>
		{#each [["graph", "graph", tr("graph.mode.graph")], ["map", "map", tr("graph.mode.map")]] as [m, icon, label] (m)}
			<Button variant={mode === m ? "default" : "outline"} size="sm" class="-ml-px first:ml-0" aria-pressed={mode === m} disabled={!ready || listMode} onclick={() => setMode(m as "graph" | "map")}><Icon name={icon} size={16} />{label}</Button>
		{/each}
	</div>
	<Button variant="outline" size="sm" aria-pressed={listMode} onclick={() => (listMode = !listMode)} disabled={!raw}><Icon name="list-view" size={16} />{tr("graph.listView")}</Button>
	<Button variant="outline" size="icon-sm" disabled={!ready || listMode} onclick={() => zoomBy(1.5)} aria-label={tr("graph.zoomIn")}><Icon name="zoom-in" size={16} /></Button>
	<Button variant="outline" size="icon-sm" disabled={!ready || listMode} onclick={() => zoomBy(1 / 1.5)} aria-label={tr("graph.zoomOut")}><Icon name="zoom-out" size={16} /></Button>
	<Button variant="outline" size="sm" disabled={!ready || listMode} onclick={() => fit?.()}><Icon name="fit-view" size={16} />{tr("graph.recenter")}</Button>

	<div class="relative ml-auto w-full sm:w-72">
		<label for="graph-search" class="sr-only">{tr("graph.search.label")}</label>
		<Icon name="search" size={16} class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2" />
		<Input
			id="graph-search"
			type="text"
			role="combobox"
			autocomplete="off"
			placeholder={tr("graph.search.placeholder")}
			class="pl-8"
			aria-expanded={searchOpen && query.trim() !== ""}
			aria-controls="graph-search-list"
			aria-autocomplete="list"
			aria-activedescendant={searchOpen && results[active] ? `graph-opt-${active}` : undefined}
			disabled={!raw}
			bind:value={query}
			oninput={() => { searchOpen = true; active = 0; }}
			onkeydown={onSearchKey}
			onblur={() => { searchOpen = false; }}
		/>
		{#if searchOpen && query.trim()}
			<ul id="graph-search-list" role="listbox" aria-label={tr("graph.search.results")} class="bg-popover text-popover-foreground absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto border p-1 shadow-md">
				{#each results as r, i (r.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<li
						id="graph-opt-{i}"
						role="option"
						aria-selected={i === active}
						class="flex min-h-9 pointer-coarse:min-h-11 cursor-pointer items-center gap-2 px-2 py-1 text-sm {i === active ? 'bg-muted' : ''}"
						onpointerdown={(e) => { e.preventDefault(); choose(r.id); }}
						onmousemove={() => { active = i; }}
					>
						{@render shape(r.type)}
						<span class="truncate">{r.title}</span>
						<span class="text-muted-foreground ml-auto shrink-0 text-xs">{typeLabel(r.type)}{view.ids.has(r.id) ? "" : ` · ${tr("graph.hidden")}`}</span>
					</li>
				{:else}
					<li role="option" aria-selected="false" aria-disabled="true" class="text-muted-foreground px-2 py-2 text-sm">{tr("graph.search.none")}</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
<p role="status" class="text-muted-foreground mt-2 min-h-5 text-sm">{notice}</p>

<div class="mt-1 grid min-w-0 gap-3 {sel ? 'lg:grid-cols-[minmax(0,1fr)_18rem]' : ''}" class:hidden={listMode}>
<div data-graph-surface class="bg-card relative h-[45vh] min-h-[320px] min-w-0 overflow-hidden border sm:h-[60vh] sm:min-h-[360px]">
	<div bind:this={el} class="absolute inset-0" role="img" aria-label={tr("graph.canvasLabel")}></div>
	<div bind:this={labels} class="pointer-events-none absolute inset-0 overflow-hidden"></div>
	{#if !raw && !error}<p role="status" class="text-muted-foreground absolute inset-0 grid place-items-center text-sm">{tr("graph.loading")}</p>{/if}
	{#if error}
		<div role="alert" class="absolute inset-0 grid place-items-center p-4">
			<div class="flex max-w-md flex-col items-center gap-3 text-center">
				<Icon name="error" size={24} class="text-destructive" />
				<p class="text-sm"><strong>{tr("graph.error")}</strong><br /><span class="text-muted-foreground">{tr("graph.error.detail", { error: String(error) })}</span></p>
				<div class="touch-gap flex flex-wrap justify-center gap-2">
					<Button size="sm" onclick={() => retry()}><Icon name="retry" size={16} />{tr("common.retry")}</Button>
					<Button variant="outline" size="sm" href={toRoute("/search")}><Icon name="search" size={16} />{tr("graph.searchPage")}</Button>
					<Button variant="outline" size="sm" href={toRoute("/tags")}><Icon name="tags" size={16} />{tr("graph.browseTags")}</Button>
				</div>
			</div>
		</div>
	{/if}
	{#if ready && shown === 0}
		<div role="status" class="bg-card/90 absolute inset-0 grid place-items-center p-4">
			<div class="flex max-w-sm flex-col items-center gap-3 text-center">
				<p class="text-sm"><strong>{tr("graph.empty")}</strong><br /><span class="text-muted-foreground">{tr("graph.empty.detail")}</span></p>
				<Button size="sm" onclick={resetFilters}><Icon name="clear" size={16} />{tr("graph.resetFilters")}</Button>
			</div>
		</div>
	{/if}
	</div>
	{#if sel}
		<aside aria-label={tr("graph.selected")} class="bg-card flex max-h-[60vh] min-w-0 flex-col gap-3 overflow-auto border p-4 shadow-sm">
			<div class="flex items-center justify-between gap-2">
				<TypeBadge type={sel.type} />
				<Button variant="ghost" size="icon-sm" onclick={() => select(null)} aria-label={tr("graph.deselect")}><Icon name="close-selection" size={16} /></Button>
			</div>
			<h2 class="text-base leading-snug font-semibold">{sel.title}</h2>
			<p class="text-muted-foreground text-sm">{tr("graph.neighbors", { count: neighborCount })}{#if neighborCount > 30} · {tr("graph.nearestFrame")}{/if}</p>
			{#if sel.description}<p class="text-muted-foreground text-sm">{sel.description}</p>{/if}
			<Button href={toPage(sel.id)} size="sm" class="self-start">{tr("graph.open")}</Button>
			{#if rel.cites.length || rel.citedBy.length}
				{#each [{ label: tr("graph.cites"), ids: rel.cites }, { label: tr("graph.citedBy"), ids: rel.citedBy }] as g (g.label)}
					{#if g.ids.length}
						<div>
							<p class="text-muted-foreground mb-1 text-sm">{g.label} ({g.ids.length})</p>
							<ul class="touch-gap flex flex-wrap gap-1.5">
								{#each g.ids as id (id)}
									{@const m = nodesById.get(id)}
									{#if m}
										<li class="max-w-full"><button type="button" onclick={() => { const n = nodeById(id); if (n) select(n, "always"); }} class="hover:bg-muted focus-visible:ring-ring/50 pointer-coarse:min-h-11 inline-flex min-h-7 max-w-full items-center gap-1.5 border px-2.5 py-1 text-left text-sm focus-visible:ring-3">{@render shape(m.type, 12)}<span class="truncate">{m.title}</span></button></li>
									{/if}
								{/each}
							</ul>
						</div>
					{/if}
				{/each}
			{:else}
				<p class="text-muted-foreground text-sm">{tr("graph.noRelated")}</p>
			{/if}
		</aside>
	{/if}
</div>

{#if listMode}
	<section aria-label={tr("graph.list.label")} class="mt-1">
		<p class="text-muted-foreground mb-3 text-sm">{tr("common.pages", { count: sorted.length })}. {tr("graph.list.help")}</p>
		<ul class="grid gap-3 lg:grid-cols-2">
			{#each sorted as n (n.id)}
				{@const r = index.get(n.id)}
				<li id={rowId(n.id)} class="anchor-target bg-card border p-3 [contain-intrinsic-size:auto_9rem] [content-visibility:auto]">
					<div class="flex flex-wrap items-center gap-2">
						<TypeBadge type={n.type} />
						<h3 class="text-base leading-snug font-semibold">{n.title}</h3>
					</div>
					<div class="touch-gap mt-2 flex flex-wrap gap-2">
						<Button size="sm" variant="outline" href={toPage(n.id)}><Icon name="external-link" size={16} />{tr("graph.open")}</Button>
						<Button size="sm" variant="outline" onclick={() => focusNode(n.id)}><Icon name="graph" size={16} />{tr("graph.selectInGraph")}</Button>
					</div>
					{#each [{ label: tr("graph.cites"), ids: r?.cites ?? [] }, { label: tr("graph.citedBy"), ids: r?.citedBy ?? [] }] as g (g.label)}
						{#if g.ids.length}
							<p class="mt-2 text-sm"><span class="text-muted-foreground">{g.label} :</span>
								{#each g.ids as id, i (id)}{#if i}{", "}{/if}<a href="#{rowId(id)}" class="text-link underline underline-offset-3">{titles.get(id) ?? id}</a>{/each}</p>
						{/if}
					{/each}
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if !listMode}
	<div class="text-muted-foreground mt-2 space-y-1 text-sm">
		<p class="flex flex-wrap items-center gap-x-4 gap-y-1">
			{#each types as t (t)}<span class="inline-flex items-center gap-1.5">{@render shape(t, 14)}{typeLabel(t)} ({SHAPE_LABEL[shapeOf(t)]})</span>{/each}
			<span class="inline-flex items-center gap-1.5"><Icon name="star" size={14} filled style="color: var(--favorite)" />{tr("graph.legend.fav")}</span>
		</p>
		<p>{tr("graph.legend.size")}</p>
		<p>{tr("graph.legend.help")}</p>
	</div>
{/if}
