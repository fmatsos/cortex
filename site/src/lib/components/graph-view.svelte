<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { Button } from "#lib/components/ui/button/index.js";
	import TypeBadge from "#lib/components/type-badge.svelte";
	import { favs } from "#lib/favs.svelte.js";
	import { labelBudget, placeLabels, screenRadius } from "#lib/graph-labels.js";
	import { toPage } from "#lib/links.js";
	import type { GraphData } from "#lib/types.js";
	import { TYPES, typeLabel } from "#lib/type-meta.js";

	type N = GraphData["nodes"][number] & { x?: number; y?: number; vx?: number; vy?: number; neighbors: N[]; links: L[] };
	type L = { source: N | string; target: N | string };

	let el: HTMLDivElement;
	let raw = $state<GraphData>();
	let off = $state(new Set<string>()); // types masqués
	let tag = $state("");
	let shown = $state(0);
	let error = $state("");
	let sel = $state.raw<N | null>(null); // nœud sélectionné (brut : force-graph mute les nœuds)
	let paused = $state(false);
	let calm = $state(false); // prefers-reduced-motion : ni particules, ni cadrage animé, simulation figée
	let listOpen = $state(false);
	let apply: (() => void) | undefined;
	let fit: (() => void) | undefined;
	let select: (n: N | null, center?: "always" | "covered") => void = () => {};
	let zoomBy: (f: number) => void = () => {};
	let togglePause: () => void = () => {};

	const types = $derived([...new Set(raw?.nodes.map((n) => n.type))].sort((a, b) => TYPES.findIndex((t) => t.type === a) - TYPES.findIndex((t) => t.type === b)));
	const tags = $derived.by(() => {
		const c = new Map<string, number>();
		for (const n of raw?.nodes ?? []) for (const t of n.tags) c.set(t, (c.get(t) ?? 0) + 1);
		return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	});
	const count = (type: string) => raw?.nodes.filter((n) => n.type === type).length ?? 0;
	const visible = $derived(raw?.nodes.filter((n) => !off.has(n.type) && (!tag || n.tags.includes(tag))) ?? []);
	// voisins des pages visibles : les relations sont aussi exposées dans la liste accessible
	const byId = $derived(new Map((raw?.nodes ?? []).map((n) => [n.id, n])));
	const nbr = $derived.by(() => {
		const ids = new Set(visible.map((n) => n.id)), m = new Map<string, string[]>();
		const add = (a: string, b: string) => (m.get(a) ?? m.set(a, []).get(a)!).push(b);
		for (const l of raw?.links ?? []) if (ids.has(l.source) && ids.has(l.target)) { add(l.source, l.target); add(l.target, l.source); }
		return m;
	});

	const toggle = (type: string) => { const s = new Set(off); s.has(type) ? s.delete(type) : s.add(type); off = s; };

	// ré-applique les filtres (les positions des nœuds conservés sont gardées : pas de saut visuel)
	$effect(() => { void off; void tag; apply?.(); });

	onMount(() => {
		let graph: any, stop = false, ro: ResizeObserver, mq: MediaQueryList, onTheme: () => void;
		(async () => {
			try {
				const [{ default: ForceGraph }, g] = await Promise.all([
					import("force-graph"),
					fetch(resolve("/graph.json")).then((r) => r.json() as Promise<GraphData>),
				]);
				if (stop) return;
				raw = g;

				// couleurs lues dans le thème (variables CSS), converties en rgb pour le canvas ; relues si le thème système change
				const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
				const rgb = (css: string, a = 1) => { probe.clearRect(0, 0, 1, 1); probe.fillStyle = css; probe.fillRect(0, 0, 1, 1); const [r, gg, b] = probe.getImageData(0, 0, 1, 1).data; return `rgba(${r},${gg},${b},${a})`; };
				const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
				let pal = { fg: "", bg: "", type: {} as Record<string, string>, link: "", hot: "" };
				const readPalette = () => {
					pal = {
						fg: rgb(css("--foreground")), bg: rgb(css("--background")),
						type: Object.fromEntries(TYPES.map((t) => [t.type, rgb(css(t.color))])),
						link: rgb(css("--foreground"), 0.18), hot: rgb(css("--link")),
					};
					redraw();
				};
				mq = matchMedia("(prefers-color-scheme: dark)");
				onTheme = readPalette;
				mq.addEventListener("change", onTheme);
				window.addEventListener("themechange", onTheme); // thème forcé depuis la palette
				calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
				const hitPad = matchMedia("(pointer: coarse)").matches ? 12 : 6; // zone de toucher élargie sur écran tactile

				let hover: N | null = null, settled = false, touched = false, k = 1, byDegree: N[] = [], last = { id: "", t: 0 };
				const hotNodes = new Set<N>(), hotLinks = new Set<L>();
				const dim = () => (hover ?? sel) !== null;
				const widths = new Map<string, number>();
				const short = (t: string) => (t.length > 28 ? `${t.slice(0, 27)}…` : t);
				const particles = (l: L) => (!calm && !paused && hotLinks.has(l) ? 3 : 0); // particules sur les liens mis en valeur
				const linkColor = (l: L) => (hotLinks.has(l) ? pal.hot : dim() ? "rgba(128,128,128,0.05)" : pal.link);
				const linkWidth = (l: L) => (hotLinks.has(l) ? 2 : 1) / Math.sqrt(k); // épaisseur à peu près constante à l'écran
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

				graph = new ForceGraph(el)
					.backgroundColor("rgba(0,0,0,0)")
					.nodeRelSize(1)
					.minZoom(0.05)
					.maxZoom(12)
					.nodeLabel(() => "") // les libellés sont dessinés sur le canvas
					.showPointerCursor((o: unknown) => !!o)
					.nodeCanvasObjectMode(() => "replace")
					.nodeCanvasObject((n: N, ctx: CanvasRenderingContext2D, scale: number) => {
						const r = screenRadius(n.degree, scale) / scale, faded = dim() && !hotNodes.has(n);
						ctx.globalAlpha = faded ? 0.12 : 1;
						ctx.beginPath();
						ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
						ctx.fillStyle = pal.type[n.type] ?? pal.fg;
						ctx.fill();
						if (favs.has(n.id)) { ctx.lineWidth = 2.5 / scale; ctx.strokeStyle = "#f5b301"; ctx.stroke(); } // favoris : anneau doré
						if (n === sel) { ctx.lineWidth = 3 / scale; ctx.strokeStyle = pal.hot; ctx.stroke(); }
						if (n === hover) { ctx.lineWidth = 2 / scale; ctx.strokeStyle = pal.fg; ctx.stroke(); }
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
						const text = (n: N) => (n === f ? n.title : short(n.title)); // titre complet pour le nœud survolé ou sélectionné
						const width = (n: N) => {
							if (n === f) { ctx.font = font(true); return Math.min(ctx.measureText(n.title).width, W - 8); }
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
					.linkDirectionalParticles(particles)
					.linkDirectionalParticleWidth(3)
					.linkDirectionalParticleSpeed(0.008)
					.linkDirectionalParticleColor(() => pal.hot)
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

				ro = new ResizeObserver(() => graph.width(el.clientWidth).height(el.clientHeight));
				ro.observe(el);
				// un cadrage tardif (fin de simulation) ne reprend pas la main sur l'utilisateur
				for (const ev of ["pointerdown", "wheel"]) el.addEventListener(ev, () => { touched = true; }, { passive: true });

				fit = () => graph.zoomToFit(calm ? 0 : 500, Math.round(Math.min(70, Math.max(20, el.clientWidth * 0.07)))); // marge réduite sur petit écran
				zoomBy = (f) => graph.zoom(Math.min(12, Math.max(0.05, graph.zoom() * f)), calm ? 0 : 250);
				select = (n, center) => {
					sel = n;
					focus();
					// sur écran étroit, le nœud passe dans la moitié haute : le panneau est posé en bas
					if (!n || !center) return;
					// le panneau est posé en bas sur écran étroit : un nœud qu'il recouvrirait passe dans la moitié haute (sinon la vue ne bouge pas, le double clic reste possible)
					const narrow = el.clientWidth < 640, covered = narrow && graph.graph2ScreenCoords(n.x, n.y).y > el.clientHeight * 0.5;
					if (center === "always" || covered) graph.centerAt(n.x, n.y! + (narrow ? (el.clientHeight * 0.2) / graph.zoom() : 0), calm ? 0 : 300);
				};
				togglePause = () => {
					paused = !paused;
					if (paused) graph.cooldownTicks(0);
					else graph.cooldownTicks(Infinity).cooldownTime(20000).d3ReheatSimulation();
					focus();
				};
				let first = true;
				apply = () => {
					if (!raw) return;
					const ids = new Set(visible.map((n) => n.id));
					const old = new Map<string, N>(graph.graphData().nodes.map((n: N) => [n.id, n]));
					const nodes: N[] = visible.map((n) => {
						const o = old.get(n.id);
						return { ...n, x: o?.x, y: o?.y, vx: o?.vx, vy: o?.vy, neighbors: [], links: [] };
					});
					const byId = new Map(nodes.map((n) => [n.id, n]));
					const links: L[] = raw.links.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => ({ ...l }));
					for (const l of links) {
						const a = byId.get(l.source as string)!, b = byId.get(l.target as string)!;
						a.neighbors.push(b); b.neighbors.push(a); a.links.push(l); b.links.push(l);
					}
					for (const n of nodes) n.neighbors.sort((a, b) => b.degree - a.degree);
					byDegree = [...nodes].sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title));
					shown = nodes.length;
					hover = null;
					sel = sel ? (byId.get(sel.id) ?? null) : null; // la sélection survit au filtre tant que le nœud reste visible
					touched = false;
					graph.graphData({ nodes, links });
					focus();
					setTimeout(() => fit?.(), first ? 400 : 700);
					first = false;
				};
				apply();
			} catch (e) {
				error = (e as Error).message;
			}
		})();
		return () => { stop = true; ro?.disconnect(); if (onTheme) { mq.removeEventListener("change", onTheme); window.removeEventListener("themechange", onTheme); } graph?._destructor?.(); };
	});
</script>

<svelte:window onkeydown={(e) => { if (e.key === "Escape" && sel && !e.defaultPrevented) select(null); }} />

<div class="flex flex-wrap items-center gap-2" role="group" aria-label="Filtres du graphe">
	{#each types as t (t)}
		<button
			type="button"
			aria-pressed={!off.has(t)}
			onclick={() => toggle(t)}
			class="focus-visible:ring-ring/50 inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm transition-opacity focus-visible:ring-3 {off.has(t) ? 'opacity-45' : ''}"
		>
			<span class="inline-block size-3 rounded-full" style:background="var({TYPES.find((x) => x.type === t)?.color ?? '--type-autre'})" aria-hidden="true"></span>
			{typeLabel(t)}s <span class="text-muted-foreground">{count(t)}</span>
		</button>
	{/each}
	<label class="text-muted-foreground ml-1 flex items-center gap-2 text-sm">
		Tag
		<select bind:value={tag} class="bg-background text-foreground focus-visible:ring-ring/50 h-8 rounded-lg border px-2 text-sm focus-visible:ring-3">
			<option value="">tous</option>
			{#each tags as [t, n] (t)}<option value={t}>{t} ({n})</option>{/each}
		</select>
	</label>
	<span class="text-muted-foreground ml-auto text-sm" aria-live="polite">{shown} page{shown > 1 ? "s" : ""}</span>
</div>

<div class="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Commandes du graphe">
	{#if !calm}<Button variant="outline" size="sm" onclick={() => togglePause()}>{paused ? "Reprendre" : "Pause"}</Button>{/if}
	<Button variant="outline" size="icon-sm" onclick={() => zoomBy(1.5)} aria-label="Zoom avant">+</Button>
	<Button variant="outline" size="icon-sm" onclick={() => zoomBy(1 / 1.5)} aria-label="Zoom arrière">−</Button>
	<Button variant="outline" size="sm" onclick={() => fit?.()}>Recentrer</Button>
</div>

<div class="bg-card relative mt-3 h-[70vh] min-h-[420px] overflow-hidden rounded-xl border">
	<div bind:this={el} class="absolute inset-0" role="img" aria-label="Graphe des liens entre les pages du wiki. La liste ci-dessous donne les mêmes pages au clavier, avec leurs relations."></div>
	{#if !raw && !error}<p class="text-muted-foreground absolute inset-0 grid place-items-center text-sm">Chargement du graphe…</p>{/if}
	{#if error}<p class="text-destructive absolute inset-0 grid place-items-center p-4 text-sm">Graphe indisponible : {error}</p>{/if}
	{#if sel}
		<aside aria-label="Page sélectionnée" class="bg-background/95 absolute inset-x-2 bottom-2 z-10 flex max-h-[42%] flex-col gap-2 overflow-auto rounded-lg border p-3 shadow-md backdrop-blur-sm sm:inset-x-auto sm:top-2 sm:right-2 sm:bottom-auto sm:max-h-[calc(100%-1rem)] sm:w-72">
			<div class="flex items-center justify-between gap-2">
				<TypeBadge type={sel.type} />
				<Button variant="ghost" size="icon-sm" onclick={() => select(null)} aria-label="Désélectionner (Échap)">×</Button>
			</div>
			<h2 class="text-base leading-snug font-semibold">{sel.title}</h2>
			{#if sel.description}<p class="text-muted-foreground text-sm">{sel.description}</p>{/if}
			{#if sel.neighbors.length}
				<div>
					<p class="text-muted-foreground mb-1 text-xs">{sel.neighbors.length} page{sel.neighbors.length > 1 ? "s" : ""} liée{sel.neighbors.length > 1 ? "s" : ""}</p>
					<ul class="flex flex-wrap gap-1">
						{#each sel.neighbors as m (m.id)}
							<li class="max-w-full"><button type="button" onclick={() => select(m, "always")} class="hover:bg-muted focus-visible:ring-ring/50 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-left text-xs focus-visible:ring-3"><span class="inline-block size-2 shrink-0 rounded-full" style:background="var({TYPES.find((x) => x.type === m.type)?.color ?? '--type-autre'})" aria-hidden="true"></span><span class="truncate">{m.title}</span></button></li>
						{/each}
					</ul>
				</div>
			{:else}
				<p class="text-muted-foreground text-xs">Aucune page liée (avec les filtres actuels).</p>
			{/if}
			<Button href={toPage(sel.id)} size="sm" class="self-start">Ouvrir la page</Button>
		</aside>
	{/if}
</div>
<p class="text-muted-foreground mt-2 text-xs">Glisser pour déplacer, molette ou pincement pour zoomer. Un clic (ou un toucher) sélectionne une page et met son voisinage en valeur ; double-clic ou « Ouvrir la page » pour l'ouvrir, Échap pour désélectionner. Anneau doré : page en favori.</p>

<details class="mt-4" ontoggle={(e) => { listOpen = e.currentTarget.open; }}>
	<summary class="cursor-pointer text-sm font-medium">Liste des pages et de leurs relations ({visible.length})</summary>
	{#if listOpen}
		<ul class="mt-2 columns-1 gap-6 text-sm sm:columns-2 lg:columns-3">
			{#each visible as n (n.id)}
				{@const vs = nbr.get(n.id) ?? []}
				<li class="break-inside-avoid py-1">
					<a href={toPage(n.id)} class="text-link underline underline-offset-3">{n.title}</a>
					{#if vs.length}
						<span class="text-muted-foreground text-xs">— lié à :
							{#each vs as v, i (v)}{#if i}, {/if}<a href={toPage(v)} class="underline underline-offset-3">{byId.get(v)?.title ?? v}</a>{/each}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</details>
