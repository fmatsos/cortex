<script lang="ts">
	import { onMount, tick, untrack } from "svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import Icon from "#lib/components/icon.svelte";
	import TypeBadge from "#lib/components/type-badge.svelte";
	import { favs } from "#lib/favs.svelte.js";
	import { labelBudget, placeLabels, screenRadius, truncateToWidth } from "#lib/graph-labels.js";
	import { buildView, createTimer, particleCount, reconcileSelection, relationIndex, relationsOf, resolveFocus, searchNodes, simLinks, type GNode, type GraphView } from "#lib/graph-model.js";
	import { SHAPE_LABEL, shapeOf, shapePoints, starPoints, svgPoints } from "#lib/graph-shapes.js";
	import { toPage, toRoute } from "#lib/links.js";
	import type { GraphData } from "#lib/types.js";
	import { TYPES, typeColor, typeLabel } from "#lib/type-meta.js";

	type N = GNode & { x?: number; y?: number; vx?: number; vy?: number; neighbors: N[]; links: L[] };
	type L = { source: N | string; target: N | string; twin?: boolean };
	type Center = "always" | "covered" | "focus";

	let el: HTMLDivElement;
	let raw = $state<GraphData>();
	let off = $state(new Set<string>()); // types masqués
	let tag = $state("");
	let shown = $state(0);
	let error = $state("");
	let ready = $state(false); // graphe construit : les commandes ne servent à rien avant
	let sel = $state.raw<N | null>(null); // nœud sélectionné (brut : force-graph mute les nœuds)
	let paused = $state(false);
	let calm = $state(false); // prefers-reduced-motion : ni particules, ni cadrage animé, simulation figée
	let listMode = $state(false);
	let notice = $state("");
	let query = $state("");
	let active = $state(0);
	let searchOpen = $state(false);

	let apply: ((v: GraphView) => void) | undefined;
	let fit: (() => void) | undefined;
	let select: (n: N | null, center?: Center) => void = () => {};
	let zoomBy: (f: number) => void = () => {};
	let togglePause: () => void = () => {};
	let nodeById: (id: string) => N | undefined = () => undefined;
	let retry: () => void = () => {}; // « Réessayer » : reconstruit le graphe depuis zéro
	let pendingFocus: string | null = null; // page à sélectionner dès que les filtres réinitialisés sont appliqués

	const EMPTY: GraphView = { nodes: [], links: [], ids: new Set() };
	// vue filtrée : pures dérivations des données et des filtres (voir graph-model.ts)
	const view = $derived(raw ? buildView(raw, { off, tag }) : EMPTY);
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
	const index = $derived(relationIndex(view));
	const sorted = $derived([...view.nodes].sort((a, b) => a.title.localeCompare(b.title, "fr")));
	const results = $derived(searchNodes(raw?.nodes ?? [], query));
	const rowId = (id: string) => `g-${id.replace(/[^a-z0-9]+/gi, "-")}`;

	const toggle = (type: string) => { const s = new Set(off); s.has(type) ? s.delete(type) : s.add(type); off = s; };
	const resetFilters = () => { off = new Set(); tag = ""; notice = ""; };

	// ré-applique les filtres. Seuls `view` (donc les données et les filtres) sont suivis : apply() lit et écrit `sel`, `shown`…,
	// et ne doit pas rendre l'effet dépendant d'eux (sinon il se relance à chaque sélection et boucle : plantage 500 après filtre puis clic).
	$effect(() => {
		const v = view;
		untrack(() => apply?.(v));
	});

	/** Sélectionne une page et la centre ; si un filtre la masque, les filtres sont réinitialisés d'abord. */
	async function focusNode(id: string) {
		if (!raw?.nodes.some((n) => n.id === id)) { notice = "Cette page n'est pas dans le graphe."; return; }
		notice = "";
		if (listMode) { listMode = false; await tick(); }
		if (!view.ids.has(id)) {
			pendingFocus = id;
			notice = "Filtres réinitialisés pour afficher cette page.";
			off = new Set();
			tag = "";
			return;
		}
		const n = nodeById(id);
		if (n) select(n, "focus");
	}

	const choose = (id: string) => { query = ""; searchOpen = false; active = 0; void focusNode(id); };
	function onSearchKey(e: KeyboardEvent) {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			if (!results.length) return;
			e.preventDefault();
			searchOpen = true;
			active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
		} else if (e.key === "Enter") {
			if (searchOpen && results[active]) { e.preventDefault(); choose(results[active].id); }
		} else if (e.key === "Escape" && (query || searchOpen)) {
			e.preventDefault();
			query = "";
			searchOpen = false;
		}
	}

	onMount(() => {
		let graph: any, ro: ResizeObserver | undefined, mq: MediaQueryList | undefined, mqMotion: MediaQueryList | undefined, onTheme: (() => void) | undefined, onMotion: ((e: MediaQueryListEvent) => void) | undefined;
		let gen = 0, raf = 0;
		const fitTimer = createTimer(); // un seul recadrage différé à la fois, annulé dès que l'utilisateur reprend la main
		const stopManual = () => { touched = true; fitTimer.cancel(); };
		let touched = false;

		const teardown = () => {
			gen++;
			fitTimer.cancel();
			cancelAnimationFrame(raf);
			ro?.disconnect();
			if (onTheme) { mq?.removeEventListener("change", onTheme); window.removeEventListener("themechange", onTheme); }
			if (onMotion) mqMotion?.removeEventListener("change", onMotion);
			for (const ev of ["pointerdown", "wheel"]) el?.removeEventListener(ev, stopManual);
			graph?._destructor?.(); // l'instance détruite reste référencée : ses derniers rappels (simulation, rendu) ne tombent pas sur `undefined`
			apply = fit = undefined;
			select = () => {};
			zoomBy = togglePause = () => {};
			nodeById = () => undefined;
			ready = false;
		};

		async function start() {
			const me = ++gen;
			error = "";
			try {
				const [{ default: ForceGraph }, g] = await Promise.all([
					import("force-graph"),
					fetch(resolve("/graph.json")).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<GraphData>; }),
				]);
				if (me !== gen) return;
				raw = g;

				// couleurs lues dans le thème (variables CSS), converties en rgb pour le canvas ; relues si le thème système change
				const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
				const rgb = (css: string, a = 1) => { probe.clearRect(0, 0, 1, 1); probe.fillStyle = css; probe.fillRect(0, 0, 1, 1); const [r, gg, b] = probe.getImageData(0, 0, 1, 1).data; return `rgba(${r},${gg},${b},${a})`; };
				const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
				let pal = { fg: "", bg: "", type: {} as Record<string, string>, edge: "", edgeDim: "", hot: "", particle: "", fav: "" };
				const readPalette = () => {
					pal = {
						fg: rgb(css("--foreground")), bg: rgb(css("--background")),
						type: Object.fromEntries(TYPES.map((t) => [t.type, rgb(css(t.color))])),
						edge: rgb(css("--graph-edge")), edgeDim: rgb(css("--graph-edge"), 0.1),
						hot: rgb(css("--link")), particle: rgb(css("--link"), 0.6), fav: rgb(css("--favorite")),
					};
					redraw();
				};
				mq = matchMedia("(prefers-color-scheme: dark)");
				onTheme = readPalette;
				mq.addEventListener("change", onTheme);
				window.addEventListener("themechange", onTheme); // thème forcé depuis la palette
				mqMotion = matchMedia("(prefers-reduced-motion: reduce)");
				calm = mqMotion.matches;
				onMotion = (e) => { calm = e.matches; redraw(); };
				mqMotion.addEventListener("change", onMotion);
				const hitPad = matchMedia("(pointer: coarse)").matches ? 12 : 6; // zone de toucher élargie sur écran tactile

				let hover: N | null = null, settled = false, k = 1, byDegree: N[] = [], last = { id: "", t: 0 }, linkTotal = 0, applied: GraphView | undefined, first = true;
				touched = false;
				const hotNodes = new Set<N>(), hotLinks = new Set<L>();
				const dim = () => (hover ?? sel) !== null;
				const widths = new Map<string, number>();
				const short = (t: string) => (t.length > 28 ? `${t.slice(0, 27)}…` : t);
				let full = { key: "", text: "" }; // titre du nœud survolé ou sélectionné, tronqué à la largeur du canvas
				const hot = (l: L) => hotLinks.has(l);
				const particles = (l: L) => particleCount({ calm, paused, hot: hot(l), dim: dim(), linkCount: linkTotal });
				const linkColor = (l: L) => (l.twin ? "rgba(0,0,0,0)" : hot(l) ? pal.hot : dim() ? pal.edgeDim : pal.edge); // le jumeau d'un lien réciproque n'a pas de trait : il ne porte que ses particules
				const linkWidth = (l: L) => (hot(l) ? 2.25 : 1.4) / Math.sqrt(k); // épaisseur à peu près constante à l'écran
				// refaire un set d'accesseur redessine (autoPauseRedraw) ; celui des particules les recrée
				const redraw = () => { graph?.linkColor(linkColor).linkDirectionalParticles(particles); };
				// voisinage mis en valeur : celui du survol, à défaut celui de la sélection
				const focus = () => {
					const f = hover ?? sel;
					hotNodes.clear();
					hotLinks.clear();
					if (f) { hotNodes.add(f); f.neighbors.forEach((m) => hotNodes.add(m)); f.links.forEach((l) => hotLinks.add(l)); }
					redraw();
				};
				const path = (ctx: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[]) => {
					ctx.beginPath();
					pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
					ctx.closePath();
				};

				graph = new ForceGraph(el)
					.backgroundColor("rgba(0,0,0,0)")
					.nodeRelSize(1)
					.minZoom(0.05)
					.maxZoom(12)
					.nodeLabel(() => "") // les libellés sont dessinés sur le canvas
					.showPointerCursor((o: unknown) => !!o)
					.nodeCanvasObjectMode(() => "replace")
					.nodeCanvasObject((n: N, ctx: CanvasRenderingContext2D, scale: number) => {
						const r = screenRadius(n.degree, scale) / scale, faded = dim() && !hotNodes.has(n), fav = favs.has(n.id);
						const pts = shapePoints(shapeOf(n.type), n.x!, n.y!, r); // forme par type : le type ne dépend pas de la couleur seule
						const outline = () => { if (pts) path(ctx, pts); else { ctx.beginPath(); ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI); } };
						ctx.globalAlpha = faded ? 0.12 : 1;
						ctx.lineJoin = "round";
						outline();
						ctx.fillStyle = pal.type[n.type] ?? pal.fg;
						ctx.fill();
						if (fav) { ctx.lineWidth = 2.5 / scale; ctx.strokeStyle = pal.fav; ctx.stroke(); } // favori : anneau, doublé d'une étoile (le repère ne tient pas à la seule couleur)
						if (n === sel) { outline(); ctx.lineWidth = 3 / scale; ctx.strokeStyle = pal.hot; ctx.stroke(); }
						if (n === hover) { outline(); ctx.lineWidth = 2 / scale; ctx.strokeStyle = pal.fg; ctx.stroke(); }
						if (fav) {
							path(ctx, starPoints(n.x! + r * 0.85, n.y! - r * 0.85, 6.5 / scale));
							ctx.lineWidth = 1.5 / scale;
							ctx.strokeStyle = pal.bg;
							ctx.stroke(); // halo : l'étoile se détache de n'importe quel fond
							ctx.fillStyle = pal.fav;
							ctx.fill();
						}
						ctx.globalAlpha = 1;
					})
					.nodePointerAreaPaint((n: N, color: string, ctx: CanvasRenderingContext2D, scale: number) => {
						ctx.fillStyle = color;
						ctx.beginPath();
						ctx.arc(n.x!, n.y!, (screenRadius(n.degree, scale) + hitPad) / scale, 0, 2 * Math.PI);
						ctx.fill();
					})
					.onRenderFramePre((_: unknown, scale: number) => { k = scale; })
					// libellés dessinés après tous les nœuds : les plus importants (degré) d'abord, jamais l'un sur l'autre
					.onRenderFramePost((ctx: CanvasRenderingContext2D, scale: number) => {
						const W = el.clientWidth, H = el.clientHeight, c = graph.centerAt(), f = hover ?? sel, FS = 12;
						const font = (bold: boolean, size = FS) => `${bold ? "600 " : ""}${size}px system-ui, sans-serif`;
						if (f) {
							const key = `${f.id}|${W}`;
							if (full.key !== key) { ctx.font = font(true); full = { key, text: truncateToWidth(f.title, W - 8, (s) => ctx.measureText(s).width) }; } // titre complet dans le panneau, tronqué sur le canvas
						}
						const text = (n: N) => (n === f ? full.text : short(n.title));
						const width = (n: N) => {
							if (n === f) { ctx.font = font(true); return Math.min(ctx.measureText(full.text).width, W - 8); }
							const t = text(n);
							let w = widths.get(t);
							if (w === undefined) { ctx.font = font(false); widths.set(t, (w = ctx.measureText(t).width)); }
							return w;
						};
						const rect = (n: N) => {
							if (n.x === undefined) return null;
							const sx = (n.x - c.x) * scale + W / 2, sy = (n.y! - c.y) * scale + H / 2, w = width(n);
							if (sx < -w || sx > W + w || sy < -FS || sy > H + FS) return null;
							return { x: Math.min(Math.max(sx - w / 2, 4), Math.max(4, W - w - 4)), y: sy + screenRadius(n.degree, scale) + 2, w, h: FS + 4, force: n === f };
						};
						const kept = placeLabels(f ? [f, ...f.neighbors] : byDegree, rect, f ? 60 : labelBudget(W, H, scale)); // survol ou sélection : le voisinage seul
						ctx.textAlign = "left";
						ctx.textBaseline = "top";
						ctx.lineJoin = "round";
						for (const n of kept) {
							const r = rect(n)!, gx = c.x + (r.x - W / 2) / scale, gy = c.y + (r.y - H / 2) / scale;
							ctx.font = font(n === f, FS / scale);
							ctx.lineWidth = 3 / scale;
							ctx.strokeStyle = pal.bg; // halo : lisible sur les arêtes et les autres nœuds
							ctx.strokeText(text(n), gx, gy);
							ctx.fillStyle = pal.fg;
							ctx.fillText(text(n), gx, gy);
						}
					})
					.linkColor(linkColor)
					.linkWidth(linkWidth)
					.linkDirectionalParticles(particles) // particules de `source` (la page qui cite) vers `target` (la page citée) ; deux sens pour un lien réciproque
					.linkDirectionalParticleWidth((l: L) => (hot(l) ? 3.5 : 2.2))
					.linkDirectionalParticleSpeed(0.008)
					.linkDirectionalParticleColor((l: L) => (hot(l) ? pal.hot : pal.particle))
					.onNodeHover((n: N | null) => { hover = n; focus(); })
					.onNodeClick((n: N) => {
						const now = performance.now();
						if (last.id === n.id && now - last.t < 400) { goto(toPage(n.id)); return; } // double clic : ouvre la page
						last = { id: n.id, t: now };
						select(n, "covered");
					})
					.onBackgroundClick(() => select(null))
					.cooldownTime(calm ? 0 : 20000)
					.warmupTicks(calm ? 300 : 80) // mise en place déjà amorcée : le cadrage initial voit un graphe étalé
					.onEngineStop(() => { if (!settled) { settled = true; if (!touched) fit?.(); } });
				readPalette();
				graph.d3Force("charge").strength(-170).distanceMax(220); // répulsion de portée limitée : les îlots ne se repoussent pas à l'infini
				// gravité vers le centre (comme Obsidian) : les petits îlots ne partent pas à la dérive
				graph.d3Force("gravity", (alpha: number) => { for (const n of graph.graphData().nodes as N[]) { n.vx = (n.vx ?? 0) - (n.x ?? 0) * 0.1 * alpha; n.vy = (n.vy ?? 0) - (n.y ?? 0) * 0.1 * alpha; } });
				graph.d3Force("link").distance(45);

				ro = new ResizeObserver(() => { if (el.clientWidth && el.clientHeight) graph.width(el.clientWidth).height(el.clientHeight); }); // masqué (vue liste) : taille nulle ignorée
				ro.observe(el);
				// un cadrage différé (fin de simulation, filtre) ne reprend jamais la main sur l'utilisateur
				for (const ev of ["pointerdown", "wheel"]) el.addEventListener(ev, stopManual, { passive: true });

				fit = () => { if (el.clientWidth) graph.zoomToFit(calm ? 0 : 500, Math.round(Math.min(70, Math.max(20, el.clientWidth * 0.07)))); }; // marge réduite sur petit écran
				zoomBy = (f) => graph.zoom(Math.min(12, Math.max(0.05, graph.zoom() * f)), calm ? 0 : 250);
				const center = (n: N, mode: Center) => {
					// sur écran étroit, le panneau est posé en bas : un nœud qu'il recouvrirait passe dans la moitié haute (sinon la vue ne bouge pas, le double clic reste possible)
					const narrow = el.clientWidth < 640, covered = narrow && graph.graph2ScreenCoords(n.x, n.y).y > el.clientHeight * 0.5;
					if (mode === "covered" && !covered) return;
					if (mode === "focus" && graph.zoom() < 2) graph.zoom(2, calm ? 0 : 300);
					graph.centerAt(n.x, n.y! + (narrow ? (el.clientHeight * 0.2) / graph.zoom() : 0), calm ? 0 : 300);
				};
				select = (n, mode) => {
					sel = n;
					focus();
					if (!n || !mode) return;
					if (mode !== "covered") stopManual(); // centrage explicite : aucun recadrage différé ne doit le défaire
					cancelAnimationFrame(raf);
					// juste après un nouveau jeu de données, les positions ne sont pas encore calculées : on attend quelques images
					const go = (tries: number) => { if (n.x !== undefined) center(n, mode); else if (tries > 0) raf = requestAnimationFrame(() => go(tries - 1)); };
					go(90);
				};
				nodeById = (id) => (graph.graphData().nodes as N[]).find((n) => n.id === id);
				togglePause = () => {
					paused = !paused;
					if (paused) graph.cooldownTicks(0);
					else graph.cooldownTicks(Infinity).cooldownTime(20000).d3ReheatSimulation();
					focus();
				};
				apply = (v) => {
					if (v === applied) return; // le premier appel direct et celui de l'effet portent sur la même vue
					applied = v;
					const old = new Map<string, N>(graph.graphData().nodes.map((n: N) => [n.id, n]));
					const nodes: N[] = v.nodes.map((n) => {
						const o = old.get(n.id);
						return { ...n, x: o?.x, y: o?.y, vx: o?.vx, vy: o?.vy, neighbors: [], links: [] };
					});
					const byId = new Map(nodes.map((n) => [n.id, n]));
					const links = simLinks(v.links) as L[];
					for (const l of links) {
						const a = byId.get(l.source as string)!, b = byId.get(l.target as string)!;
						if (!l.twin) { a.neighbors.push(b); b.neighbors.push(a); }
						a.links.push(l); b.links.push(l);
					}
					for (const n of nodes) n.neighbors.sort((a, b) => b.degree - a.degree);
					byDegree = [...nodes].sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title));
					linkTotal = v.links.length;
					shown = nodes.length;
					hover = null;
					const keep = reconcileSelection(sel?.id, v.ids); // la sélection survit au filtre tant que le nœud reste visible
					sel = keep ? (byId.get(keep) ?? null) : null;
					touched = false;
					graph.graphData({ nodes, links });
					focus();
					if (pendingFocus && byId.has(pendingFocus)) { const id = pendingFocus; pendingFocus = null; select(byId.get(id)!, "focus"); }
					else fitTimer.schedule(() => fit?.(), first ? 400 : 700);
					first = false;
				};
				apply(view);
				ready = true;

				// `?focus=<id>` : ouvre le graphe centré sur une page (lien « Voir dans le graphe » d'un article)
				const wanted = resolveFocus(location.search, g.nodes);
				if (wanted.id) await focusNode(wanted.id);
				else if (wanted.asked) notice = `La page « ${wanted.asked} » n'est pas dans le graphe.`;
			} catch (e) {
				if (me !== gen) return;
				error = (e as Error).message || "erreur inconnue";
				graph?._destructor?.();
				ready = false;
			}
		}

		retry = () => { teardown(); void start(); };
		void start();
		return () => { retry = () => {}; teardown(); };
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

<div class="touch-gap flex flex-wrap items-center gap-2" role="group" aria-label="Filtres du graphe">
	{#each types as t (t)}
		<button
			type="button"
			aria-pressed={!off.has(t)}
			onclick={() => toggle(t)}
			class="focus-visible:ring-ring/50 pointer-coarse:min-h-11 inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm motion-safe:transition-opacity focus-visible:ring-3 {off.has(t) ? 'opacity-60' : ''}"
		>
			{@render shape(t)}
			{typeLabel(t)}s <span class="text-muted-foreground">{count(t)}</span>
			<span class="sr-only">, forme : {SHAPE_LABEL[shapeOf(t)]}</span>
		</button>
	{/each}
	<label class="text-muted-foreground ml-1 flex items-center gap-2 text-sm">
		Tag
		<select bind:value={tag} class="bg-background text-foreground focus-visible:ring-ring/50 pointer-coarse:h-11 h-8 rounded-lg border px-2 text-sm focus-visible:ring-3">
			<option value="">tous</option>
			{#each tags as [t, n] (t)}<option value={t}>{t} ({n})</option>{/each}
		</select>
	</label>
	{#if filtered}<Button variant="ghost" size="sm" onclick={resetFilters}><Icon name="clear" size={16} />Réinitialiser les filtres</Button>{/if}
	<span class="text-muted-foreground ml-auto text-sm" aria-live="polite">{shown} page{shown > 1 ? "s" : ""}</span>
</div>

<div class="touch-gap mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Commandes du graphe">
	<Button variant="outline" size="sm" aria-pressed={listMode} onclick={() => (listMode = !listMode)} disabled={!raw}><Icon name="list-view" size={16} />Vue liste</Button>
	{#if !calm}<Button variant="outline" size="sm" disabled={!ready || listMode} onclick={() => togglePause()}><Icon name={paused ? "play" : "pause"} size={16} />{paused ? "Reprendre" : "Pause"}</Button>{/if}
	<Button variant="outline" size="icon-sm" disabled={!ready || listMode} onclick={() => zoomBy(1.5)} aria-label="Zoom avant"><Icon name="zoom-in" size={16} /></Button>
	<Button variant="outline" size="icon-sm" disabled={!ready || listMode} onclick={() => zoomBy(1 / 1.5)} aria-label="Zoom arrière"><Icon name="zoom-out" size={16} /></Button>
	<Button variant="outline" size="sm" disabled={!ready || listMode} onclick={() => fit?.()}><Icon name="fit-view" size={16} />Recentrer</Button>

	<div class="relative ml-auto w-full sm:w-72">
		<label for="graph-search" class="sr-only">Chercher une page dans le graphe</label>
		<Icon name="search" size={16} class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2" />
		<Input
			id="graph-search"
			type="text"
			role="combobox"
			autocomplete="off"
			placeholder="Chercher une page…"
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
			<ul id="graph-search-list" role="listbox" aria-label="Pages trouvées" class="bg-popover text-popover-foreground absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-lg border p-1 shadow-md">
				{#each results as r, i (r.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<li
						id="graph-opt-{i}"
						role="option"
						aria-selected={i === active}
						class="flex min-h-9 pointer-coarse:min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm {i === active ? 'bg-muted' : ''}"
						onmousedown={(e) => { e.preventDefault(); choose(r.id); }}
						onmousemove={() => { active = i; }}
					>
						{@render shape(r.type)}
						<span class="truncate">{r.title}</span>
						<span class="text-muted-foreground ml-auto shrink-0 text-xs">{typeLabel(r.type)}{view.ids.has(r.id) ? "" : " · masquée"}</span>
					</li>
				{:else}
					<li role="option" aria-selected="false" aria-disabled="true" class="text-muted-foreground px-2 py-2 text-sm">Aucune page ne correspond.</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
<p role="status" class="text-muted-foreground mt-2 min-h-5 text-sm">{notice}</p>

<div class="bg-card relative mt-1 h-[70vh] min-h-[420px] overflow-hidden rounded-xl border" class:hidden={listMode}>
	<div bind:this={el} class="absolute inset-0" role="img" aria-label="Graphe des liens entre les pages du wiki. Activez « Vue liste » pour parcourir les mêmes pages et leurs relations au clavier."></div>
	{#if !raw && !error}<p role="status" class="text-muted-foreground absolute inset-0 grid place-items-center text-sm">Chargement du graphe…</p>{/if}
	{#if error}
		<div role="alert" class="absolute inset-0 grid place-items-center p-4">
			<div class="flex max-w-md flex-col items-center gap-3 text-center">
				<Icon name="error" size={24} class="text-destructive" />
				<p class="text-sm"><strong>Le graphe n'a pas pu être chargé.</strong><br /><span class="text-muted-foreground">Vérifiez votre connexion puis réessayez. Détail : {error}</span></p>
				<div class="touch-gap flex flex-wrap justify-center gap-2">
					<Button size="sm" onclick={() => retry()}><Icon name="retry" size={16} />Réessayer</Button>
					<Button variant="outline" size="sm" href={toRoute("/search")}><Icon name="search" size={16} />Rechercher une page</Button>
					<Button variant="outline" size="sm" href={toRoute("/tags")}><Icon name="tags" size={16} />Parcourir par tag</Button>
				</div>
			</div>
		</div>
	{/if}
	{#if ready && shown === 0}
		<div role="status" class="bg-card/90 absolute inset-0 grid place-items-center p-4">
			<div class="flex max-w-sm flex-col items-center gap-3 text-center">
				<p class="text-sm"><strong>Aucun résultat avec ces filtres.</strong><br /><span class="text-muted-foreground">Aucune page ne correspond aux types et au tag choisis.</span></p>
				<Button size="sm" onclick={resetFilters}><Icon name="clear" size={16} />Réinitialiser les filtres</Button>
			</div>
		</div>
	{/if}
	{#if sel}
		<aside aria-label="Page sélectionnée" class="bg-background/95 absolute inset-x-2 bottom-2 z-10 flex max-h-[42%] flex-col gap-2 overflow-auto rounded-lg border p-3 shadow-md backdrop-blur-sm sm:inset-x-auto sm:top-2 sm:right-2 sm:bottom-auto sm:max-h-[calc(100%-1rem)] sm:w-72">
			<div class="flex items-center justify-between gap-2">
				<TypeBadge type={sel.type} />
				<Button variant="ghost" size="icon-sm" onclick={() => select(null)} aria-label="Désélectionner (Échap)"><Icon name="close-selection" size={16} /></Button>
			</div>
			<h2 class="text-base leading-snug font-semibold">{sel.title}</h2>
			{#if sel.description}<p class="text-muted-foreground text-sm">{sel.description}</p>{/if}
			{#if rel.cites.length || rel.citedBy.length}
				{#each [{ label: "Cite", ids: rel.cites }, { label: "Cité par", ids: rel.citedBy }] as g (g.label)}
					{#if g.ids.length}
						<div>
							<p class="text-muted-foreground mb-1 text-sm">{g.label} ({g.ids.length})</p>
							<ul class="touch-gap flex flex-wrap gap-1.5">
								{#each g.ids as id (id)}
									{@const m = nodesById.get(id)}
									{#if m}
										<li class="max-w-full"><button type="button" onclick={() => { const n = nodeById(id); if (n) select(n, "always"); }} class="hover:bg-muted focus-visible:ring-ring/50 pointer-coarse:min-h-11 inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-left text-sm focus-visible:ring-3">{@render shape(m.type, 12)}<span class="truncate">{m.title}</span></button></li>
									{/if}
								{/each}
							</ul>
						</div>
					{/if}
				{/each}
			{:else}
				<p class="text-muted-foreground text-sm">Aucune page liée (avec les filtres actuels).</p>
			{/if}
			<Button href={toPage(sel.id)} size="sm" class="self-start">Ouvrir la page</Button>
		</aside>
	{/if}
</div>

{#if listMode}
	<section aria-label="Liste des pages et de leurs relations" class="mt-1">
		<p class="text-muted-foreground mb-3 text-sm">{sorted.length} page{sorted.length > 1 ? "s" : ""}. « Cite » : pages vers lesquelles elle fait un lien ; « Cité par » : pages qui font un lien vers elle. Un nom de page lié mène à sa fiche dans cette liste.</p>
		<ul class="grid gap-3 lg:grid-cols-2">
			{#each sorted as n (n.id)}
				{@const r = index.get(n.id)}
				<li id={rowId(n.id)} class="anchor-target bg-card rounded-lg border p-3 [contain-intrinsic-size:auto_9rem] [content-visibility:auto]">
					<div class="flex flex-wrap items-center gap-2">
						<TypeBadge type={n.type} />
						<h3 class="text-base leading-snug font-semibold">{n.title}</h3>
					</div>
					<div class="touch-gap mt-2 flex flex-wrap gap-2">
						<Button size="sm" variant="outline" href={toPage(n.id)}><Icon name="external-link" size={16} />Ouvrir la page</Button>
						<Button size="sm" variant="outline" onclick={() => focusNode(n.id)}><Icon name="graph" size={16} />Sélectionner dans le graphe</Button>
					</div>
					{#each [{ label: "Cite", ids: r?.cites ?? [] }, { label: "Cité par", ids: r?.citedBy ?? [] }] as g (g.label)}
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
			<span class="inline-flex items-center gap-1.5"><Icon name="star" size={14} filled style="color: var(--favorite)" />Favori</span>
		</p>
		<p>Taille d'un nœud : nombre de pages liées affichées avec les filtres actuels. Les particules vont de la page qui cite vers la page citée (dans les deux sens pour un lien réciproque).</p>
		<p>Glisser pour déplacer, molette ou pincement pour zoomer. Un clic (ou un toucher) sélectionne une page et met son voisinage en valeur ; double-clic ou « Ouvrir la page » pour l'ouvrir, Échap pour désélectionner.</p>
	</div>
{/if}
