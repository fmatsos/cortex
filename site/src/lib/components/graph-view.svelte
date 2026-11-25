<script lang="ts">
	import { onMount, tick, untrack } from "svelte";
	import { goto, replaceState } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { account } from "#lib/account.svelte.js";
	import JourneyDialogs from "#lib/components/journey/journey-dialogs.svelte";
	import { JourneyFlow } from "#lib/components/journey/journey-flow.svelte.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import Icon from "#lib/components/icon.svelte";
	import TypeBadge from "#lib/components/type-badge.svelte";
	import { favs } from "#lib/favs.svelte.js";
	import { destinations, linked, parseRoute, serializeRoute, truncateRoute } from "#lib/journey.js";
	import { buildView, reconcileSelection, relationIndex, relationsOf, resolveFocus, searchNodes, type GNode, type GraphView } from "#lib/graph-model.js";
	import { SHAPE_LABEL, settlementOf, shapeOf, svgPoints } from "#lib/graph-shapes.js";
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
	type Mode = "graph" | "map" | "journey";
	let mode = $state<Mode>("graph");
	let route = $state<string[]>([]); // journey: ids of the pages walked so far, each linked to the one before
	let playing = $state(false);
	let live = $state("");
	let heading = $state<HTMLElement>();
	let run = 0; // replay generation: any other move bumps it and the replay stops
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
	const step = $derived(route.at(-1) ?? null);
	const dest = $derived(step ? destinations(step, index, nodesById) : { cites: [], citedBy: [] });
	const sorted = $derived([...view.nodes].sort((a, b) => a.title.localeCompare(b.title, "fr")));
	const results = $derived(searchNodes(raw?.nodes ?? [], query));
	// save and export of the journey (the saved copy is named in the address: ?journey=<id>)
	const flow = new JourneyFlow({ route: () => route, titleOf: (id) => titles.get(id) ?? id, graph: () => raw, changed: () => syncUrl() });
	const rowId = (id: string) => `g-${id.replace(/[^a-z0-9]+/gi, "-")}`;
	const nodeById = (id: string) => nodesById.get(id);
	const toggle = (type: string) => { const s = new Set(off); s.has(type) ? s.delete(type) : s.add(type); off = s; };
	const resetFilters = () => { off = new Set(); tag = ""; notice = ""; };
	const fit = () => controller?.fit();
	const zoomBy = (factor: number) => controller?.zoom(factor);
	/** Presentation (graph, map, journey) and the route; kept in the URL (?view=map, ?view=journey&route=a,b) so it can be shared and reloaded. */
	function syncUrl() {
		const url = new URL(location.href);
		if (mode === "graph") url.searchParams.delete("view"); else url.searchParams.set("view", mode);
		if (mode === "journey" && route.length) url.searchParams.set("route", serializeRoute(route)); else url.searchParams.delete("route");
		const saved = flow.linkedId;
		if (mode === "journey" && route.length && saved) url.searchParams.set("journey", saved); else url.searchParams.delete("journey");
		replaceState(url, {});
	}
	function setMode(next: Mode) {
		run++; playing = false;
		mode = next; controller?.mode(next);
		if (next === "journey" && !route.length && sel) route = [sel.id];
		controller?.journey(next === "journey" ? route : []);
		if (next === "journey" && step) { sel = nodeById(step) ?? null; void controller?.go(step); }
		syncUrl();
	}
	function select(n: GNode | null, center?: string) { sel = n; controller?.select(n?.id ?? null, !!center); }

	/** Journey: every change of the route goes through here; the camera travels to the last step (duration 0: a jump). */
	function setRoute(next: string[], duration?: number) {
		run++; playing = false; route = next; controller?.journey(next);
		const id = next.at(-1);
		if (id) { sel = nodeById(id) ?? null; void controller?.go(id, duration); live = tr("journey.announce", { n: next.length, total: next.length, title: titles.get(id) ?? id }); }
		else { flow.unlink(); select(null); fit(); live = ""; }
		syncUrl();
	}
	/** A page chosen on the map, in the search or in the panel: the departure, or the next step when linked to the current page. */
	function pick(id: string) {
		if (id === step) return;
		if (!step || linked(index, step, id)) { notice = ""; setRoute([...route, id]); }
		else notice = tr("journey.notLinked");
	}
	const advance = (id: string) => { pick(id); void tick().then(() => heading?.focus()); };
	async function replay() {
		const me = ++run, ids = [...route], pause = matchMedia("(prefers-reduced-motion: reduce)").matches ? 900 : 300;
		playing = true;
		for (const [i, id] of ids.entries()) {
			controller?.journey(ids.slice(0, i + 1)); sel = nodeById(id) ?? null;
			live = tr("journey.announce", { n: i + 1, total: ids.length, title: titles.get(id) ?? id });
			await controller?.go(id, 900);
			if (me !== run) return;
			await new Promise((done) => setTimeout(done, pause));
			if (me !== run) return;
		}
		playing = false;
	}
	async function copyLink() {
		try { await navigator.clipboard.writeText(location.href); notice = tr("journey.copied"); } catch { notice = tr("journey.copyFailed"); }
	}

	$effect(() => {
		const v = view;
		untrack(() => apply?.(v));
	});

	// the saved copy the address names is read once the account is known (the layout loads it after this page's first render)
	$effect(() => {
		if (!account.ready || !flow.wanted) return;
		const signedIn = !!account.me;
		untrack(() => void flow.resolve(signedIn));
	});

	async function focusNode(id: string) {
		if (!raw?.nodes.some((n) => n.id === id)) { notice = tr("graph.notInGraph"); return; }
		notice = "";
		if (listMode) { listMode = false; await tick(); }
		if (!view.ids.has(id)) { pendingFocus = id; notice = tr("graph.filtersReset"); off = new Set(); tag = ""; return; }
		const n = nodeById(id);
		if (n) { if (mode === "journey") pick(id); else select(n, "focus"); }
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
				controller = createGraph(el, labels, g, { select: (id) => { if (mode !== "journey") select(id ? nodeById(id) ?? null : null); else if (id) pick(id); }, open: (id) => { void goto(toPage(id)); }, favorite: (id) => favs.has(id) });
				apply = (v) => {
					const keep = reconcileSelection(sel?.id, v.ids);
					sel = keep ? v.nodes.find((n) => n.id === keep) ?? null : null;
					controller!.apply(v); controller!.select(sel?.id ?? null);
					if (pendingFocus && v.ids.has(pendingFocus)) { const id = pendingFocus; pendingFocus = null; void focusNode(id); }
				};
				const params = new URLSearchParams(location.search), asked = params.get("view");
				mode = asked === "map" || asked === "journey" ? asked : "graph";
				controller.mode(mode);
				apply(view); ready = true;
				if (mode === "journey" && params.has("route")) {
					const walked = parseRoute(params.get("route"), index);
					if (walked.length) flow.link(params.get("journey")); // named before the route is set: the address keeps it while the copy is read
					setRoute(walked, 0);
				}
				const wanted = resolveFocus(location.search, g.nodes);
				if (wanted.id) await focusNode(wanted.id);
				else if (wanted.asked) notice = tr("graph.pageNotInGraph", { title: wanted.asked });
			} catch (e) { if (me === generation) { controller?.kill(); controller = undefined; ready = false; error = (e as Error).message; } }
		}
		retry = () => { teardown(); void start(); };
		void start();
		return () => { flow.destroy(); teardown(); retry = () => {}; motion.removeEventListener("change", onMotion); theme.removeEventListener("change", onTheme); window.removeEventListener("themechange", onTheme); };
	});
</script>

{#snippet shape(type: string, size = 14)}
	{@const sh = shapeOf(type)}
	{@const pts = svgPoints(sh, size)}
	<svg width={size} height={size} viewBox="0 0 {size} {size}" aria-hidden="true" focusable="false" class="shrink-0" style="fill: {typeColor(type)}">
		{#if pts}<polygon points={pts} stroke-linejoin="round" />{:else}<circle cx={size / 2} cy={size / 2} r={size * 0.4} />{/if}
	</svg>
{/snippet}

{#snippet settlement(kind: string)}
	<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false" class="text-foreground shrink-0">
		{#if kind === "capital"}<circle cx="7" cy="7" r="5.2" fill="none" stroke="currentColor" stroke-width="1.6" /><circle cx="7" cy="7" r="2.2" fill="currentColor" />
		{:else if kind === "square"}<rect x="3.5" y="3.5" width="7" height="7" fill="currentColor" />
		{:else if kind === "ring"}<circle cx="7" cy="7" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6" />
		{:else}<circle cx="7" cy="7" r="4.6" fill="currentColor" />{/if}
	</svg>
{/snippet}

<svelte:window onkeydown={(e) => { if (e.key !== "Escape" || e.defaultPrevented) return; if (playing) setRoute(route); else if (sel && mode !== "journey") select(null); }} />

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
		{#each [["graph", "graph", tr("graph.mode.graph")], ["map", "map", tr("graph.mode.map")], ["journey", "journey", tr("graph.mode.journey")]] as [m, icon, label] (m)}
			<Button variant={mode === m ? "default" : "outline"} size="sm" class="-ml-px first:ml-0" aria-pressed={mode === m} disabled={!ready || listMode} onclick={() => setMode(m as Mode)}><Icon name={icon} size={16} />{label}</Button>
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

<div class="mt-1 grid min-w-0 gap-3 {sel || mode === 'journey' ? 'lg:grid-cols-[minmax(0,1fr)_20rem]' : ''}" class:hidden={listMode}>
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
	{#if mode === "journey"}
		<aside aria-label={tr("journey.panel")} class="bg-card shadow-surface flex min-w-0 flex-col gap-4 border p-4 lg:max-h-[60vh] lg:overflow-auto">
			<p class="sr-only" aria-live="polite">{live}</p>
			{#if step}
				{@const cur = nodesById.get(step)}
				<section aria-labelledby="journey-now" class="flex flex-col gap-2">
					<p class="text-muted-foreground text-sm">{tr("journey.step", { n: route.length })}</p>
					<h2 id="journey-now" bind:this={heading} tabindex="-1" class="text-base leading-snug font-semibold focus-visible:outline-2">{titles.get(step) ?? step}</h2>
					{#if cur}<div><TypeBadge type={cur.type} /></div>{/if}
					<Button href={toPage(step)} size="sm" class="self-start"><Icon name="external-link" size={16} />{tr("journey.read")}</Button>
				</section>
				<div class="touch-gap flex flex-wrap gap-2">
					<Button variant="outline" size="sm" disabled={route.length < 2} onclick={() => setRoute(route.slice(0, -1))}>{tr("journey.back")}</Button>
					<Button variant="outline" size="sm" disabled={route.length < 2} aria-pressed={playing} onclick={() => (playing ? setRoute(route) : void replay())}>{playing ? tr("journey.stop") : tr("journey.replay")}</Button>
					<Button variant="outline" size="sm" onclick={() => setRoute([])}>{tr("journey.clear")}</Button>
					<Button variant="outline" size="sm" onclick={copyLink}><Icon name="copy-link" size={16} />{tr("journey.copy")}</Button>
					<!-- no account on this site (static export, no sign-in configured): nothing to save to -->
					{#if account.enabled}
						<Button variant="outline" size="sm" aria-label={account.me ? tr("journey.save.label") : tr("journey.save.signIn")} aria-disabled={flow.busy || !!flow.wanted || undefined} class={flow.busy || flow.wanted ? "cursor-not-allowed opacity-50" : ""} onclick={() => flow.save()}><Icon name="save" size={16} />{tr("journey.save")}</Button>
					{/if}
					<Button variant="outline" size="sm" aria-label={tr("journey.exportAction.label")} aria-busy={flow.exporting || undefined} aria-disabled={flow.exporting || undefined} class={flow.exporting ? "cursor-not-allowed opacity-50" : ""} onclick={() => void flow.export()}><Icon name="export-markdown" size={16} />{tr("journey.exportAction")}</Button>
				</div>
				<!-- the state of the saved copy (with an account only) and the short message that says what just happened: both always present, so that a change is announced -->
				<p aria-live="polite" data-journey-state={flow.state || "none"} class="text-muted-foreground -mt-2 flex min-h-4 items-center gap-1.5 text-xs leading-4 {flow.state ? '' : 'sr-only'}">
					{#if flow.state}
						<span aria-hidden="true" class="size-2 shrink-0 {flow.state === 'unsaved' ? 'bg-warning-foreground' : 'bg-muted-foreground'}"></span>
						<span class={flow.state === "unsaved" ? "text-foreground" : ""}>{tr(`journey.state.${flow.state}`)}</span>
					{/if}
				</p>
				<div aria-live="polite" data-journey-message class={flow.message ? "-mt-2" : "sr-only"}>
					{#if flow.message}
						<div class="flex items-start gap-2 px-2 py-1.5 text-sm {flow.message.kind === 'error' ? 'bg-warning-background text-warning-foreground' : 'bg-muted'}">
							<Icon name={flow.message.kind === "error" ? "error" : "success"} size={16} class="mt-0.5" />
							<span class="min-w-0 flex-1 break-words">{flow.message.text}</span>
							<button type="button" class="hover:bg-background/60 -mr-1 inline-flex size-6 shrink-0 items-center justify-center pointer-coarse:size-9" aria-label={tr("common.closeMessage")} title={tr("common.closeMessage")} onclick={() => flow.dismiss()}><Icon name="clear" size={14} /></button>
						</div>
					{/if}
				</div>
				{#each [{ label: tr("graph.cites"), nodes: dest.cites }, { label: tr("journey.citedBy"), nodes: dest.citedBy }] as g (g.label)}
					{#if g.nodes.length}
						<section aria-label={`${g.label} (${g.nodes.length})`}>
							<h3 class="text-muted-foreground mb-1 text-sm">{g.label} ({g.nodes.length})</h3>
							<ul class="flex flex-col">
								{#each g.nodes as m (m.id)}
									<li><button type="button" onclick={() => advance(m.id)} class="hover:bg-muted focus-visible:ring-ring/50 pointer-coarse:min-h-11 flex min-h-9 w-full items-center gap-2 px-2 py-1 text-left text-sm focus-visible:ring-3">{@render shape(m.type, 12)}<span class="truncate">{m.title}</span><span class="text-muted-foreground ml-auto shrink-0 text-xs">{typeLabel(m.type)}</span></button></li>
								{/each}
							</ul>
						</section>
					{/if}
				{/each}
				{#if !dest.cites.length && !dest.citedBy.length}<p class="text-muted-foreground text-sm">{tr("graph.noRelated")}</p>{/if}
			{:else}
				<h2 class="text-base leading-snug font-semibold">{tr("graph.mode.journey")}</h2>
				<p class="text-muted-foreground text-sm">{tr("journey.start")}</p>
			{/if}
			<section aria-labelledby="journey-log" class="flex flex-col gap-2 border-t pt-3">
				<h3 id="journey-log" class="text-sm font-semibold">{tr("journey.log")}</h3>
				{#if route.length}
					<p class="text-muted-foreground text-sm">{tr("journey.logHelp")}</p>
					<ol class="flex flex-col">
						{#each route as id, i (`${i}:${id}`)}
							<li class="flex items-center">
								<button type="button" aria-current={i === route.length - 1 ? "step" : undefined} onclick={() => setRoute(truncateRoute(route, i))} class="hover:bg-muted focus-visible:ring-ring/50 pointer-coarse:min-h-11 flex min-h-9 min-w-0 flex-1 items-baseline gap-2 px-2 py-1 text-left text-sm focus-visible:ring-3 {i === route.length - 1 ? 'font-semibold' : ''}"><span class="text-muted-foreground w-5 shrink-0 text-right tabular-nums" aria-hidden="true">{i + 1}</span><span class="truncate">{titles.get(id) ?? id}</span></button>
								<Button variant="ghost" size="icon-sm" href={toPage(id)} aria-label={tr("journey.openStep", { title: titles.get(id) ?? id })}><Icon name="external-link" size={16} /></Button>
							</li>
						{/each}
					</ol>
				{:else}
					<p class="text-muted-foreground text-sm">{tr("journey.logEmpty")}</p>
				{/if}
			</section>
		</aside>
	{:else if sel}
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

<JourneyDialogs {flow} />

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
			{#if mode === "map"}
				{#each types as t (t)}<span class="inline-flex items-center gap-1.5" data-settlement={settlementOf(t)}>{@render settlement(settlementOf(t))}{tr(`graph.settlement.${settlementOf(t)}`)} ({typeLabel(t)})</span>{/each}
			{:else}
				{#each types as t (t)}<span class="inline-flex items-center gap-1.5">{@render shape(t, 14)}{typeLabel(t)} ({SHAPE_LABEL[shapeOf(t)]})</span>{/each}
			{/if}
			<span class="inline-flex items-center gap-1.5"><Icon name="star" size={14} filled style="color: var(--favorite)" />{tr("graph.legend.fav")}</span>
		</p>
			{#if mode !== "graph"}<p>{tr("graph.legend.map")}</p>{#if mode === "journey"}<p>{tr("journey.legend")}</p>{/if}{:else}<p>{tr("graph.legend.size")}</p>{/if}
		<p>{tr("graph.legend.help")}</p>
	</div>
{/if}
