<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { Button } from "#lib/components/ui/button/index.js";
	import { favs } from "#lib/favs.svelte.js";
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
	let apply: (() => void) | undefined;
	let fit: (() => void) | undefined;

	const types = $derived([...new Set(raw?.nodes.map((n) => n.type))].sort((a, b) => TYPES.findIndex((t) => t.type === a) - TYPES.findIndex((t) => t.type === b)));
	const tags = $derived.by(() => {
		const c = new Map<string, number>();
		for (const n of raw?.nodes ?? []) for (const t of n.tags) c.set(t, (c.get(t) ?? 0) + 1);
		return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	});
	const count = (type: string) => raw?.nodes.filter((n) => n.type === type).length ?? 0;
	const visible = $derived(raw?.nodes.filter((n) => !off.has(n.type) && (!tag || n.tags.includes(tag))) ?? []);

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
				};
				readPalette();
				mq = matchMedia("(prefers-color-scheme: dark)");
				onTheme = readPalette;
				mq.addEventListener("change", onTheme);
				window.addEventListener("themechange", onTheme); // thème forcé depuis la palette
				const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

				let hover: N | null = null, settled = false;
				const hotNodes = new Set<N>(), hotLinks = new Set<L>();
				const radius = (n: N) => 2.5 + Math.sqrt(n.degree) * 1.7; // taille selon le nombre de liens
				const dim = () => hover !== null;
				const label = (t: string) => (t.length > 34 ? `${t.slice(0, 33)}…` : t);

				graph = new ForceGraph(el)
					.backgroundColor("rgba(0,0,0,0)")
					.autoPauseRedraw(false) // continue de redessiner : particules et survol restent fluides
					.nodeRelSize(1)
					.nodeLabel(() => "") // les libellés sont dessinés sur le canvas
					.nodeCanvasObjectMode(() => "replace")
					.nodeCanvasObject((n: N, ctx: CanvasRenderingContext2D, scale: number) => {
						const r = radius(n), lit = hotNodes.has(n), faded = dim() && !lit;
						ctx.globalAlpha = faded ? 0.12 : 1;
						ctx.beginPath();
						ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
						ctx.fillStyle = pal.type[n.type] ?? pal.fg;
						ctx.fill();
						if (favs.has(n.id)) { ctx.lineWidth = 2.5 / scale; ctx.strokeStyle = "#f5b301"; ctx.stroke(); } // favoris : anneau doré
						if (n === hover) { ctx.lineWidth = 2 / scale; ctx.strokeStyle = pal.fg; ctx.stroke(); }
						// libellés lisibles au zoom : toujours pour le survol et ses voisins, sinon selon le zoom et l'importance du nœud
						if (lit || (!dim() && (scale >= 2.6 || (scale >= 1.5 && n.degree >= 4) || (scale >= 1 && n.degree >= 8)))) {
							const size = Math.min(14, 12 / scale + (n === hover ? 1 : 0));
							ctx.font = `${n === hover ? "600 " : ""}${size}px system-ui, sans-serif`;
							ctx.textAlign = "center";
							ctx.textBaseline = "top";
							ctx.lineWidth = 3 / scale;
							ctx.strokeStyle = pal.bg; // halo : lisible sur les arêtes et les autres nœuds
							ctx.strokeText(label(n.title), n.x!, n.y! + r + 2 / scale);
							ctx.fillStyle = pal.fg;
							ctx.fillText(label(n.title), n.x!, n.y! + r + 2 / scale);
						}
						ctx.globalAlpha = 1;
					})
					.nodePointerAreaPaint((n: N, color: string, ctx: CanvasRenderingContext2D) => {
						ctx.fillStyle = color;
						ctx.beginPath();
						ctx.arc(n.x!, n.y!, radius(n) + 3, 0, 2 * Math.PI);
						ctx.fill();
					})
					.linkColor((l: L) => (hotLinks.has(l) ? pal.hot : dim() ? "rgba(128,128,128,0.05)" : pal.link))
					.linkWidth((l: L) => (hotLinks.has(l) ? 2 : 1))
					.linkDirectionalParticles((l: L) => (!calm && hotLinks.has(l) ? 3 : 0)) // particules sur les liens mis en valeur
					.linkDirectionalParticleWidth(3)
					.linkDirectionalParticleSpeed(0.008)
					.linkDirectionalParticleColor(() => pal.hot)
					.onNodeHover((n: N | null) => {
						hover = n;
						hotNodes.clear();
						hotLinks.clear();
						if (n) { hotNodes.add(n); n.neighbors.forEach((m) => hotNodes.add(m)); n.links.forEach((l) => hotLinks.add(l)); }
					})
					.onNodeClick((n: N) => goto(toPage(n.id)))
					.cooldownTime(calm ? 0 : 20000)
					.warmupTicks(calm ? 300 : 80) // mise en place déjà amorcée : le cadrage initial voit un graphe étalé
					.onEngineStop(() => { if (!settled) { settled = true; fit?.(); } });
				graph.d3Force("charge").strength(-170).distanceMax(220); // répulsion de portée limitée : les îlots ne se repoussent pas à l'infini
				// gravité vers le centre (comme Obsidian) : les petits îlots ne partent pas à la dérive
				graph.d3Force("gravity", (alpha: number) => { for (const n of graph.graphData().nodes as N[]) { n.vx = (n.vx ?? 0) - (n.x ?? 0) * 0.1 * alpha; n.vy = (n.vy ?? 0) - (n.y ?? 0) * 0.1 * alpha; } });
				graph.d3Force("link").distance(45);

				ro = new ResizeObserver(() => graph.width(el.clientWidth).height(el.clientHeight));
				ro.observe(el);

				fit = () => graph.zoomToFit(500, 70);
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
					shown = nodes.length;
					graph.graphData({ nodes, links });
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
	<Button variant="outline" size="sm" onclick={() => fit?.()}>Recentrer</Button>
	<span class="text-muted-foreground ml-auto text-sm" aria-live="polite">{shown} page{shown > 1 ? "s" : ""}</span>
</div>

<div bind:this={el} class="bg-card relative mt-3 h-[70vh] min-h-[420px] overflow-hidden rounded-xl border" role="img" aria-label="Graphe des liens entre les pages du wiki. La liste ci-dessous donne les mêmes pages au clavier.">
	{#if !raw && !error}<p class="text-muted-foreground absolute inset-0 grid place-items-center text-sm">Chargement du graphe…</p>{/if}
	{#if error}<p class="text-destructive absolute inset-0 grid place-items-center p-4 text-sm">Graphe indisponible : {error}</p>{/if}
</div>
<p class="text-muted-foreground mt-2 text-xs">Glisser pour déplacer, molette ou pincement pour zoomer, survol pour voir les voisins, clic pour ouvrir la page. Anneau doré : page en favori.</p>

<details class="mt-4">
	<summary class="cursor-pointer text-sm font-medium">Liste des pages ({visible.length})</summary>
	<ul class="mt-2 columns-1 gap-6 text-sm sm:columns-2 lg:columns-3">
		{#each visible as n (n.id)}<li class="py-0.5"><a href={toPage(n.id)} class="text-link underline underline-offset-3">{n.title}</a></li>{/each}
	</ul>
</details>
