import Sigma from "sigma";
import { sdfCircle, sdfSquare, sdfDiamond, sdfTriangle } from "sigma/rendering";
import { UndirectedGraph } from "graphology";
import { focusNodes, gestureNodes, type GNode, type GraphView } from "./graph-model";
import { placeLabels, truncateToWidth } from "./graph-labels";
import { settlementOf, shapeOf, SHAPE_SCALE } from "./graph-shapes";
import { islandRadius, packBoxes, MISC, SEA } from "./graph-pack";
import type { GraphData } from "./types";
import { TYPES } from "./type-meta";
import { t } from "./i18n/index";

type Node = GNode & { label: string; size: number; [key: string]: unknown };
type Callbacks = { select: (id: string | null) => void; open: (id: string) => void; favorite: (id: string) => boolean };

/** Map settlements drawn by Sigma 4 SDF primitives: a village is a hollow circle, a capital a ring around a dot. */
const ring = { name: "ring", inradiusFactor: 0.6, glsl: `float sdf_ring(vec2 uv, float size) { return abs(length(uv) - size * 0.72) - size * 0.28; }` };
const capital = { name: "capital", inradiusFactor: 0.4, glsl: `float sdf_capital(vec2 uv, float size) { float d = length(uv); return min(abs(d - size * 0.8) - size * 0.2, d - size * 0.36); }` };

/** Browser-only renderer. Physics and community detection never enter this bundle. */
export function createGraph(el: HTMLElement, labels: HTMLElement, raw: GraphData, callbacks: Callbacks) {
  // The export packs the continents for one ratio; repack them for this frame (everything inside a continent is kept).
  // ponytail: once at creation, a later resize (side panel) only refits the camera
  const centers = packBoxes(raw.continents, el.clientWidth && el.clientHeight ? Math.max(0.6, el.clientWidth / el.clientHeight) : 16 / 9, SEA);
  const shiftOf = new Map(raw.continents.map((c, i) => [c.id, { x: centers[i].x - c.x, y: centers[i].y - c.y }]));
  const continentOf = new Map(raw.communities.map((c) => [c.id, c.continent]));
  const shift = (community: string) => shiftOf.get(continentOf.get(community)!) ?? { x: 0, y: 0 };
  const moveFlat = (points: number[], d: { x: number; y: number }) => points.map((v, i) => v + (i % 2 ? d.y : d.x));
  raw = {
    ...raw,
    nodes: raw.nodes.map((n) => { const d = shift(n.community); return { ...n, x: n.x + d.x, y: n.y + d.y }; }),
    communities: raw.communities.map((c) => { const d = shift(c.id); return { ...c, x: c.x + d.x, y: c.y + d.y, label: c.id === MISC ? t("graph.misc") : c.label }; }),
    continents: raw.continents.map((c, i) => {
      const d = shiftOf.get(c.id)!;
      return { ...c, ...centers[i], label: c.id === MISC ? t("graph.misc") : c.label, cells: c.cells.map((cell) => ({ id: cell.id, points: moveFlat(cell.points, d) })), borders: moveFlat(c.borders, d) };
    }),
  };
  const countryOfPage = new Map(raw.nodes.map((n) => [n.id, n.community]));
  const graph = new UndirectedGraph<Node>({ allowSelfLoops: false });
  const positions = new Map(raw.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const measure = document.createElement("canvas").getContext("2d")!;
  const font = getComputedStyle(el).fontFamily;
  const fontSize = parseFloat(getComputedStyle(el).fontSize) * 0.875;
  measure.font = `${fontSize}px ${font}`;
  const metrics = new Map(raw.nodes.map((n) => {
    // The SDF atlas has no colour-emoji font; preserve the full title in the HTML panel/list.
    const title = n.title.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "").trim();
    const text = truncateToWidth(`${callbacks.favorite(n.id) ? "★ " : ""}${title}`, 185, (s) => measure.measureText(s).width);
    return [n.id, { text, width: measure.measureText(text).width }];
  }));
  let scope: GraphView = { nodes: [], links: [], ids: new Set() };
  let selected: string | null = null, hovered: string | null = null, hot = new Set<string>(), allowed = new Set<string>();
  let moving = false, projected = false, dragged: string | null = null;
  let map = false; // map mode: islands of land under the pages, sea routes between them, page-to-page links only around the focus
  let routes: { a: { x: number; y: number }; b: { x: number; y: number }; count: number }[] = [];
  let path: string[] = []; // journey mode: the page ids of the route walked so far
  let emphasized = new Set<string>();
  let landmarks = new Set<string>();
  const peers = new Map<string, Set<string>>();
  let reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let timer: ReturnType<typeof setTimeout> | undefined, frame = 0, dead = false;
  function readPalette() {
    const css = getComputedStyle(document.documentElement), value = (key: string) => css.getPropertyValue(key).trim();
    return { sea: value("--map-sea"), land: value("--map-land"), coast: value("--map-coast"), border: value("--map-border"), countries: [1, 2, 3, 4, 5, 6].map((i) => value(`--map-country-${i}`)), background: value("--graph-background"), edge: value("--graph-edge"), active: value("--graph-edge-active"), label: value("--graph-label"), favorite: value("--favorite"), signal: value("--signal"), types: Object.fromEntries(TYPES.map((t) => [t.type, value(t.color)])) };
  }
  let palette = readPalette();
  const representatives = new Set(raw.communities.flatMap((c) => c.representatives));
  const nodeSize = (n: GNode) => (n.type === "Source" ? 2 + Math.min(1, Math.log2(n.degree + 1) * 0.3) : Math.min(9, 3.5 + Math.log2(n.degree + 1) * 0.8)) * SHAPE_SCALE[shapeOf(n.type)];
  const mapSize = (n: GNode) => n.type === "Synthesis" ? 7.5 : n.type === "Concept" ? Math.min(7, 3.5 + Math.log2(n.degree + 1) * 0.6) : n.type === "Source" ? 3 : 3.6;
  function nodeVisual(id: string, n: GNode) {
    const context = selected ?? hovered, active = context === id, inContext = hot.has(id), favorite = callbacks.favorite(id);
    return {
      // on the map a page is a settlement drawn in ink: capital, city, town or village by its type
      shape: map ? settlementOf(n.type) : shapeOf(n.type), color: map ? palette.label : palette.types[n.type] ?? palette.label,
      visibility: moving && !landmarks.has(id) && dragged !== id ? "hidden" : "visible",
      opacity: context && !inContext ? 0.12 : n.type === "Source" && !inContext && !map ? 0.55 : 1,
      size: map ? mapSize(n) * (active ? 1.3 : 1) : active ? Math.max(7, nodeSize(n)) : nodeSize(n),
      labelColor: palette.label, labelVisibility: allowed.has(id) ? "visible" : "hidden",
      // a framed node for the active page and favorites; any other shown label gets a plain backdrop to read over nodes
      backdropVisibility: active || favorite || allowed.has(id) ? "visible" : "hidden",
      backdropArea: active || favorite ? "node" : "label",
      backdropColor: palette.background, backdropBorderColor: active ? palette.active : favorite ? palette.favorite : palette.background,
    };
  }
  function edgeVisual(e: { source: string; target: string }) {
    const context = selected ?? hovered;
    const active = (context === e.source && emphasized.has(e.target)) || (context === e.target && emphasized.has(e.source));
    return { color: active ? palette.active : palette.edge, opacity: active ? 0.8 : map ? 0 : context ? 0.025 : 0.12, size: active ? 1.2 : 0.45 };
  }
  const visualKeys = ["shape", "color", "visibility", "opacity", "size", "labelColor", "labelVisibility", "backdropVisibility", "backdropArea", "backdropColor", "backdropBorderColor"];
  const bind = (keys: string[]) => Object.fromEntries(keys.map((key) => [key, { attribute: key }]));
  function savePositions() { graph.forEachNode((id, n) => positions.set(id, { x: n.x, y: n.y })); }
  function populate(nodes: GNode[], links: GraphData["links"]) {
    graph.clear();
    for (const n of nodes) graph.addNode(n.id, { ...n, ...positions.get(n.id)!, label: metrics.get(n.id)!.text, ...nodeVisual(n.id, n) });
    for (const [i, e] of links.entries()) graph.addEdgeWithKey(String(i), e.source, e.target, { ...e, ...edgeVisual(e) });
  }
  const positioned = () => ({ ...scope, nodes: scope.nodes.map((n) => ({ ...n, ...positions.get(n.id)! })) });
  populate(raw.nodes, raw.links);
  const renderer = new Sigma(graph, el, {
    primitives: { nodes: { shapes: [sdfCircle(), sdfSquare(), sdfDiamond(), sdfTriangle(), ring, capital], label: { font: { family: font, size: fontSize }, zoomToLabelSizeRatioFunction: () => 1 } } },
    settings: {
      hideEdgesOnMove: true, hideLabelsOnMove: true, enableEdgeEvents: false, enableNodeDrag: true,
      enableCameraRotation: false, enableCameraMouseRotation: false, zoomDuration: 0, zoomingRatio: 1.15,
      doubleClickZoomingDuration: reduced ? 0 : 180, inertiaDuration: reduced ? 0 : 150,
      labelDensity: 1, labelGridCellSize: 70, labelRenderedSizeThreshold: 0,
      itemSizesReference: "screen", zoomToSizeRatioFunction: () => 1,
      minCameraRatio: 0.025, maxCameraRatio: 2, stagePadding: 35,
      nodePickingPadding: matchMedia("(pointer: coarse)").matches ? 10 : 5,
      autoRescale: "once", minEdgeThickness: 0.3,
      allowInvalidContainer: true,
    },
    // Attribute bindings are static to Sigma. Opaque nodeReducer callbacks force N+E style work
    // on every camera-state change in 4.0.6, even when the callback ignores that state.
    styles: {
      nodes: { ...bind(["x", "y", "label", ...visualKeys]), labelFont: font, labelSize: fontSize, labelPosition: "below", backdropPadding: 3, backdropBorderWidth: 2, backdropCornerRadius: 0, backdropShadowBlur: 0 },
      edges: bind(["size", "color", "opacity"]),
    },
  });

  // Map mode land, under Sigma's WebGL stage. Drawn in graph units with one affine transform (the camera never rotates):
  // each page lays a disc of land, so an island's coast follows its pages. Redrawn on every Sigma frame, a few hundred arcs.
  const land = renderer.createCanvas("land", { beforeLayer: "stage", style: { pointerEvents: "none" } }), landContext = land.getContext("2d")!;
  land.setAttribute("aria-hidden", "true");
  const SHORE = 58, COAST = 6;
  function drawLand() {
    const { width, height } = renderer.getDimensions(), dpr = devicePixelRatio || 1;
    if (land.width !== Math.round(width * dpr) || land.height !== Math.round(height * dpr)) { land.width = Math.round(width * dpr); land.height = Math.round(height * dpr); land.style.width = `${width}px`; land.style.height = `${height}px`; }
    landContext.setTransform(1, 0, 0, 1, 0, 0);
    landContext.clearRect(0, 0, land.width, land.height);
    if (!map || !scope.nodes.length) return;
    const o = renderer.graphToViewport({ x: 0, y: 0 }), ux = renderer.graphToViewport({ x: 1, y: 0 }), uy = renderer.graphToViewport({ x: 0, y: 1 });
    landContext.setTransform((ux.x - o.x) * dpr, (ux.y - o.y) * dpr, (uy.x - o.x) * dpr, (uy.y - o.y) * dpr, o.x * dpr, o.y * dpr);
    const px = 1 / Math.hypot(ux.x - o.x, ux.y - o.y); // graph units per CSS pixel
    // 1. political map: each page's territory in its country's colour, then the borders where countries meet
    const colour = new Map(raw.communities.map((c) => [c.id, palette.countries[c.color % palette.countries.length]]));
    // one path per country: its cells rasterise together, so no antialiasing seam shows between two of its pages
    const territories = new Map<string, Path2D>();
    for (const c of raw.continents) for (const cell of c.cells) {
      const pts = cell.points, country = countryOfPage.get(cell.id)!;
      if (pts.length < 6) continue;
      const path = territories.get(country) ?? territories.set(country, new Path2D()).get(country)!;
      path.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);
      path.closePath();
    }
    for (const [country, path] of territories) { landContext.fillStyle = colour.get(country) ?? palette.land; landContext.fill(path); }
    landContext.strokeStyle = palette.border; landContext.lineWidth = 1.3 * px; landContext.lineJoin = "round"; landContext.setLineDash([5 * px, 3 * px]);
    landContext.beginPath();
    for (const c of raw.continents) for (let i = 0; i < c.borders.length; i += 4) { landContext.moveTo(c.borders[i], c.borders[i + 1]); landContext.lineTo(c.borders[i + 2], c.borders[i + 3]); }
    landContext.stroke(); landContext.setLineDash([]);
    // 2. the coast cuts the territories: land is a bedrock disc per country plus a disc per shown page
    const discs = (grow: number) => {
      landContext.beginPath();
      for (const c of raw.communities) { const k = counts.get(c.id); if (!k) continue; const r = islandRadius(k) * 0.92 + grow; landContext.moveTo(c.x + r, c.y); landContext.arc(c.x, c.y, r, 0, Math.PI * 2); }
      for (const n of scope.nodes) { const q = positions.get(n.id)!, r = SHORE + grow; landContext.moveTo(q.x + r, q.y); landContext.arc(q.x, q.y, r, 0, Math.PI * 2); }
    };
    landContext.globalCompositeOperation = "destination-in"; landContext.fillStyle = "#000"; discs(0); landContext.fill();
    // 3. behind the land: the coastline, then the sea routes between continents
    landContext.globalCompositeOperation = "destination-over"; landContext.fillStyle = palette.land; discs(0); landContext.fill(); // fills the seams between countries
    landContext.fillStyle = palette.coast; discs(COAST); landContext.fill();
    landContext.strokeStyle = palette.coast; landContext.lineCap = "round"; landContext.setLineDash([8, 14]);
    for (const r of routes) { landContext.lineWidth = 1.5 + Math.log2(r.count); landContext.beginPath(); landContext.moveTo(r.a.x, r.a.y); landContext.lineTo(r.b.x, r.b.y); landContext.stroke(); }
    landContext.setLineDash([]); landContext.globalCompositeOperation = "source-over";
  }
  // Journey mode: the route walked so far, a trail in the ochre signal colour with a numbered square at each stop. Its own canvas
  // under the stage (the pages stay drawn over the line), in viewport pixels so line and numbers stay crisp at any zoom; redrawn with each frame.
  const trail = renderer.createCanvas("journey", { beforeLayer: "stage", style: { pointerEvents: "none" } }), trailContext = trail.getContext("2d")!;
  trail.setAttribute("aria-hidden", "true");
  function drawRoute() {
    const { width, height } = renderer.getDimensions(), dpr = devicePixelRatio || 1;
    if (trail.width !== Math.round(width * dpr) || trail.height !== Math.round(height * dpr)) { trail.width = Math.round(width * dpr); trail.height = Math.round(height * dpr); trail.style.width = `${width}px`; trail.style.height = `${height}px`; }
    trailContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    trailContext.clearRect(0, 0, width, height);
    const stops = path.flatMap((id) => (positions.has(id) ? [renderer.graphToViewport(positions.get(id)!)] : []));
    if (!stops.length) return;
    trailContext.lineJoin = "round"; trailContext.lineCap = "round";
    for (const [size, colour] of [[6, palette.background], [3, palette.signal]] as const) {
      trailContext.lineWidth = size; trailContext.strokeStyle = colour; trailContext.beginPath();
      for (const [i, p] of stops.entries()) i ? trailContext.lineTo(p.x, p.y) : trailContext.moveTo(p.x, p.y);
      trailContext.stroke();
    }
    trailContext.font = `600 11px ${font}`; trailContext.textAlign = "center"; trailContext.textBaseline = "middle";
    for (const [i, p] of stops.entries()) {
      trailContext.fillStyle = palette.signal; trailContext.fillRect(p.x - 8, p.y - 28, 16, 16);
      trailContext.fillStyle = palette.background; trailContext.fillText(String(i + 1), p.x, p.y - 19.5);
    }
  }
  let counts = new Map<string, number>();
  function syncRoutes() {
    counts = new Map();
    for (const n of scope.nodes) counts.set(n.community, (counts.get(n.community) ?? 0) + 1);
    const center = new Map(raw.continents.map((c) => [c.id, c])), pairs = new Map<string, number>();
    const community = new Map(scope.nodes.map((n) => [n.id, continentOf.get(n.community)!]));
    for (const e of scope.links) {
      const a = community.get(e.source), b = community.get(e.target);
      if (!a || !b || a === b) continue;
      const key = a < b ? `${a}\t${b}` : `${b}\t${a}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
    // each continent keeps only its two strongest sea routes: a readable sea, not a second hairball
    const kept = new Set<string>(), byIsland = new Map<string, [string, number][]>();
    for (const entry of pairs) for (const id of entry[0].split("\t")) (byIsland.get(id) ?? byIsland.set(id, []).get(id)!).push(entry);
    for (const list of byIsland.values()) for (const [key] of list.sort((a, b) => b[1] - a[1]).slice(0, 2)) kept.add(key);
    // ponytail: straight routes; bundled ones if the sea still gets crowded
    routes = [...pairs].filter(([key, count]) => count >= 2 && kept.has(key)).map(([key, count]) => { const [a, b] = key.split("\t"); return { a: center.get(a)!, b: center.get(b)!, count }; });
  }
  function syncStyles() {
    // 4.0.6's partial repaint fails before indexation (initial load / cleared edges).
    // The structural "type" hint requests fresh program slots for these batched updates.
    graph.updateEachNodeAttributes((id, n) => ({ ...n, ...nodeVisual(id, n) }), { attributes: ["type", ...visualKeys] });
    graph.updateEachEdgeAttributes((_id, e, source, target) => ({ ...e, ...edgeVisual({ source, target }) }), { attributes: ["type", "color", "opacity", "size"] });
  }

  function readTheme() {
    palette = readPalette();
    el.style.backgroundColor = map ? palette.sea : palette.background;
    syncStyles(); drawRoute();
  }

  /** Collision decisions run when the camera settles, never once per zoom frame. Text stays on the GPU. */
  function updateLabels() {
    if (dead || !el.clientWidth || !el.clientHeight) return;
    const { width, height } = renderer.getDimensions(), ratio = renderer.getCamera().ratio, context = selected ?? hovered;
    const candidates = [...scope.nodes].filter((n) => !context || emphasized.has(n.id)).sort((a, b) => Number(b.id === context) - Number(a.id === context) || Number(representatives.has(b.id)) - Number(representatives.has(a.id)) || b.degree - a.degree);
    const rect = (n: GNode) => {
      const p = renderer.graphToViewport(graph.getNodeAttributes(n.id)), w = metrics.get(n.id)!.width;
      if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) return null;
      return { x: p.x - w / 2, y: p.y + (n.id === context ? Math.max(7, nodeSize(n)) : nodeSize(n)) + 4, w, h: fontSize + 6, force: n.id === context };
    };
    const eligible = candidates.filter((n) => context || ratio < 0.65 || n.degree >= 45);
    const reserved: { x: number; y: number; w: number; h: number; force: boolean }[] = [];
    labels.replaceChildren();
    if (!context && map && ratio > 0.55) {
      // continent names, spaced capitals as on a world map, above the countries' names
      const pages = new Map<string, number>(), countries = new Map<string, Set<string>>();
      for (const n of scope.nodes) { const c = continentOf.get(n.community)!; pages.set(c, (pages.get(c) ?? 0) + 1); (countries.get(c) ?? countries.set(c, new Set()).get(c)!).add(n.community); }
      measure.font = `600 ${fontSize * 1.15}px ${font}`;
      const named = raw.continents.filter((c) => c.label && (countries.get(c.id)?.size ?? 0) >= 2);
      const width_ = (c: { label: string }) => Math.min(360, measure.measureText(c.label.toUpperCase()).width * 1.25 + 16);
      const kept = placeLabels(named, (c) => {
        const p = renderer.graphToViewport({ x: c.x, y: c.y + c.h / 2 }), w = width_(c);
        return p.x < w / 2 || p.x > width - w / 2 || p.y < 10 || p.y > height ? null : { x: p.x - w / 2, y: p.y - 30, w, h: 26 };
      }, 8, 12);
      for (const c of kept) {
        const p = renderer.graphToViewport({ x: c.x, y: c.y + c.h / 2 }), w = width_(c), button = document.createElement("button");
        reserved.push({ x: p.x - w / 2, y: p.y - 32, w, h: 30, force: true });
        button.type = "button"; button.textContent = c.label; button.dataset.continent = c.id;
        button.setAttribute("aria-label", `${c.label} (${t("common.pages", { count: pages.get(c.id)! })})`);
        button.className = "pointer-events-auto absolute max-w-96 truncate px-1 text-base font-semibold uppercase tracking-[0.25em] text-muted-foreground [text-shadow:0_0_4px_var(--map-sea),0_0_4px_var(--map-sea)] focus-visible:outline focus-visible:outline-2";
        button.style.cssText = `left:${p.x}px;top:${p.y - 17}px;transform:translate(-50%,-50%)`;
        button.onclick = () => fit(scope.nodes.filter((n) => continentOf.get(n.community) === c.id));
        labels.append(button);
      }
      measure.font = `${fontSize}px ${font}`;
    }
    if (!context && ratio > (map ? 0.12 : 0.5)) {
      const counts = new Map<string, number>();
      for (const n of scope.nodes) counts.set(n.community, (counts.get(n.community) ?? 0) + 1);
      // Various goes first: an island of scattered pages is only readable through its tag
      const visible = raw.communities.filter((c) => (counts.get(c.id) ?? 0) >= 4).sort((a, b) => Number(b.id === MISC) - Number(a.id === MISC));
      const kept = placeLabels(visible, (c) => {
        if (reserved.some((r) => { const q = renderer.graphToViewport(c); return Math.abs(q.x - (r.x + r.w / 2)) < r.w / 2 + 40 && Math.abs(q.y - 25 - (r.y + r.h / 2)) < 30; })) return null;
        const p = renderer.graphToViewport(c), w = Math.min(280, measure.measureText(c.label).width + 16);
        return p.x < w / 2 || p.x > width - w / 2 || p.y < 40 || p.y > height ? null : { x: p.x - w / 2, y: p.y - 37, w, h: 26 };
      }, 12, 12);
      for (const c of kept) {
        const p = renderer.graphToViewport(c), button = document.createElement("button"), w = Math.min(280, measure.measureText(c.label).width + 16);
        reserved.push({ x: p.x - w / 2 - 2, y: p.y - 39, w: w + 4, h: 30, force: true });
        button.dataset.country = c.id;
        button.type = "button"; button.textContent = c.label;
        const count = counts.get(c.id)!;
        button.title = t("common.pages", { count }); button.setAttribute("aria-label", `${c.label} (${count})`);
        button.className = map
          ? "pointer-events-auto absolute max-w-64 truncate px-1 py-0.5 text-sm font-semibold text-foreground italic [text-shadow:0_0_3px_var(--map-land),0_0_3px_var(--map-land)] focus-visible:outline focus-visible:outline-2"
          : "pointer-events-auto absolute max-w-64 truncate border bg-background/95 px-2 py-1 text-xs text-muted-foreground focus-visible:outline focus-visible:outline-2";
        button.style.cssText = `left:${p.x}px;top:${p.y - 25}px;transform:translate(-50%,-50%);opacity:${map ? 1 : Math.min(1, (ratio - 0.5) * 2)}`;
        button.onclick = () => fit(scope.nodes.filter((n) => n.community === c.id));
        labels.append(button);
      }
    }
    const entries = [
      ...reserved.map((r) => ({ node: null as GNode | null, box: r })),
      ...eligible.map((node) => ({ node: node as GNode | null, box: rect(node) })),
    ];
    allowed = new Set(placeLabels(entries, (item) => item.box, context ? 24 : Math.min(65, reserved.length + Math.ceil(width * height / 26000 / Math.max(0.5, ratio))), 6).flatMap((item) => item.node ? [item.node.id] : []));
    labels.style.visibility = "visible";
    syncStyles();
    startFlow();
  }
  // Link direction: dots travel from the page that holds the link to the page it cites, both ways for a mutual link.
  // Only on the selected/hovered page's links, at rest, never under reduced motion: the overview stays still and costs nothing.
  // Map and group labels are buttons above the canvas: hand their wheel to Sigma so zooming never stalls on a name.
  labels.addEventListener("wheel", (event) => {
    if (event.target === labels) return;
    event.preventDefault();
    el.querySelector(".sigma-mouse")?.dispatchEvent(new WheelEvent("wheel", event));
  }, { passive: false });
  const flow = document.createElement("canvas"), flowContext = flow.getContext("2d")!;
  flow.setAttribute("aria-hidden", "true"); flow.dataset.flow = "";
  flow.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  el.append(flow);
  let flowFrame = 0, flowOn = true;
  function flowLinks() {
    const context = selected ?? hovered;
    if (!context || moving || reduced || dead || !flowOn) return [];
    // ponytail: capped at 80 links, the hub's neighbourhood stays legible and the frame cheap
    return scope.links.filter((e) => (e.source === context && emphasized.has(e.target)) || (e.target === context && emphasized.has(e.source))).slice(0, 80);
  }
  function drawFlow(time: number) {
    const { width, height } = renderer.getDimensions(), dpr = devicePixelRatio || 1;
    if (flow.width !== Math.round(width * dpr) || flow.height !== Math.round(height * dpr)) { flow.width = Math.round(width * dpr); flow.height = Math.round(height * dpr); }
    flowContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    flowContext.clearRect(0, 0, width, height);
    const links = flowLinks();
    flow.dataset.flow = String(links.length);
    if (!links.length) { flowFrame = 0; return; }
    flowContext.fillStyle = palette.active;
    flowContext.globalAlpha = 0.85;
    for (const [i, e] of links.entries()) {
      if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
      const a = renderer.graphToViewport(graph.getNodeAttributes(e.source)), b = renderer.graphToViewport(graph.getNodeAttributes(e.target));
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 16) continue;
      // a constant 40 px/s whatever the link length, offset per link so the dots do not pulse together
      const t = (time / 1000 * 40 / length + i * 0.137) % 1;
      for (const k of e.mutual ? [t, 1 - t] : [t]) {
        flowContext.beginPath();
        flowContext.arc(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 1.8, 0, Math.PI * 2);
        flowContext.fill();
      }
    }
    flowFrame = requestAnimationFrame(drawFlow);
  }
  const startFlow = () => { if (!flowFrame) flowFrame = requestAnimationFrame(drawFlow); };
  function settle() {
    if (dead) return;
    if (projected && dragged) { timer = setTimeout(settle, 160); return; }
    savePositions(); moving = false;
    renderer.setSetting("renderLabels", true);
    if (projected) { projected = false; populate(scope.nodes, scope.links); }
    else for (const [i, e] of scope.links.entries()) graph.addEdgeWithKey(String(i), e.source, e.target, { ...e, ...edgeVisual(e) });
    updateLabels();
  }
  function scheduleLabels() {
    labels.style.visibility = "hidden";
    if (!moving) {
      moving = true; savePositions();
      if (hovered && !selected) {
        hovered = null; hot.clear(); emphasized.clear(); landmarks = gestureNodes(scope, emphasized);
      }
      // Hide flags still submit all vertices in 4.0.6. Use an actual bounded renderer projection.
      const nodes = scope.nodes.filter((n) => landmarks.has(n.id) || n.id === dragged);
      projected = !dragged && nodes.length < scope.nodes.length;
      if (projected) populate(nodes, []);
      else { graph.clearEdges(); syncStyles(); }
      // setSetting synchronously reindexes the graph in 4.0.6: call it AFTER projection.
      renderer.setSetting("renderLabels", false);
    }
    clearTimeout(timer); timer = setTimeout(settle, 160);
    startFlow(); // its next frame clears the dots during the gesture, then stops
  }
  function highlight() {
    const id = selected ?? hovered;
    savePositions();
    hot = new Set(id && scope.ids.has(id) ? [id, ...(peers.get(id) ?? [])] : []);
    emphasized = new Set(id ? focusNodes(id, positioned()).map((n) => n.id) : []);
    if (id) for (const p of path) if (scope.ids.has(p)) { hot.add(p); emphasized.add(p); } // the stops already made stay in view
    landmarks = gestureNodes(scope, emphasized);
    if (moving && projected) populate(scope.nodes.filter((n) => landmarks.has(n.id)), []);
    else if (moving) syncStyles(); else updateLabels();
    startFlow();
  }
  function move(state: { x: number; y: number; ratio: number }, duration = 250) {
    if (reduced) { renderer.getCamera().setState(state); return Promise.resolve(); }
    return renderer.getCamera().animate(state, { duration });
  }
  function fit(nodes = scope.nodes, duration?: number) {
    if (dead || !nodes.length || !el.clientWidth) return;
    renderer.resize();
    const points = nodes.filter((n) => scope.ids.has(n.id)).map((n) => renderer.graphToFramedGraph(positions.get(n.id) ?? n));
    if (!points.length) return;
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y), x = (Math.min(...xs) + Math.max(...xs)) / 2, y = (Math.min(...ys) + Math.max(...ys)) / 2;
    const { width, height } = renderer.getDimensions();
    // Project at unit zoom: Sigma's aspect correction also changes when the side panel opens.
    const pixels = points.map((p) => renderer.framedGraphToViewport(p, { cameraState: { x, y, ratio: 1, angle: 0 } }));
    const px = pixels.map((p) => p.x), py = pixels.map((p) => p.y);
    const ratio = Math.min(1.8, Math.max(0.07, (Math.max(...px) - Math.min(...px)) / Math.max(80, width - 120), (Math.max(...py) - Math.min(...py)) / Math.max(80, height - 120)));
    return move({ x, y, ratio }, duration);
  }
  if (raw.nodes.length) renderer.setCustomBBox({ x: [Math.min(...raw.nodes.map((n) => n.x)), Math.max(...raw.nodes.map((n) => n.x))], y: [Math.min(...raw.nodes.map((n) => n.y)), Math.max(...raw.nodes.map((n) => n.y))] });
  const resize = new ResizeObserver(() => { if (el.clientWidth && el.clientHeight) { renderer.resize(); scheduleLabels(); } }); resize.observe(el);
  let lastCamera = renderer.getCamera().getState();
  renderer.getCamera().on("updated", (state) => {
    // setSetting() echoes the current camera state in Sigma 4.0.6. It is not a gesture.
    if (Math.abs(state.x - lastCamera.x) < 1e-7 && Math.abs(state.y - lastCamera.y) < 1e-7 && Math.abs(state.ratio - lastCamera.ratio) < 1e-7 && Math.abs(state.angle - lastCamera.angle) < 1e-7) return;
    lastCamera = { ...state }; scheduleLabels();
  });
  graph.on("nodeAttributesUpdated", scheduleLabels);
  renderer.on("enterNode", ({ node }) => { if (!selected && !moving) { hovered = node; highlight(); } });
  renderer.on("leaveNode", () => { if (!selected && !moving) { hovered = null; highlight(); } });
  // Prepare the light projection before the first pan frame, including touch gestures.
  renderer.on("downStage", scheduleLabels);
  renderer.on("downNode", ({ node }) => { dragged = node; scheduleLabels(); });
  renderer.getMouseCaptor().on("mouseup", () => { dragged = null; });
  renderer.getTouchCaptor().on("touchup", () => { dragged = null; });
  renderer.on("clickNode", ({ node }) => callbacks.select(node));
  renderer.on("doubleClickNode", ({ node, event }) => { event.preventSigmaDefault(); callbacks.open(node); });
  renderer.on("clickStage", () => callbacks.select(null));
  renderer.on("afterRender", () => { el.dataset.rendered = "true"; drawLand(); drawRoute(); });
  readTheme();
  return {
    apply(view: GraphView) {
      clearTimeout(timer); moving = false; projected = false; renderer.setSetting("renderLabels", true);
      savePositions(); scope = view; dragged = null;
      populate(view.nodes, view.links); syncRoutes(); peers.clear();
      for (const e of view.links) for (const [a, b] of [[e.source, e.target], [e.target, e.source]]) (peers.get(a) ?? peers.set(a, new Set()).get(a)!).add(b);
      if (selected && !view.ids.has(selected)) selected = null;
      hovered = null; highlight();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fit(selected ? focusNodes(selected, positioned()) : scope.nodes));
    },
    select(id: string | null, center = false) {
      selected = id; hovered = null; highlight();
      if (center && id) {
        savePositions();
        cancelAnimationFrame(frame); frame = requestAnimationFrame(() => fit(focusNodes(id, positioned())));
      }
    },
    /** Journey mode plays on the map: same drawing, plus the route. */
    mode(next: "graph" | "map" | "journey") {
      map = next !== "graph"; el.dataset.mode = next;
      readTheme(); updateLabels(); renderer.refresh();
    },
    /** Journey: the route walked so far (page ids), drawn as a trail. */
    journey(ids: string[]) { path = ids; highlight(); drawRoute(); },
    /** Journey: the page becomes the selection and the camera travels to it; resolves when the camera stops, interrupted or not. */
    go(id: string, duration = 700) {
      selected = id; hovered = null; highlight(); savePositions();
      cancelAnimationFrame(frame);
      return fit(focusNodes(id, positioned()), duration);
    },
    fit, resize: () => { renderer.resize(); updateLabels(); }, theme: readTheme,
    zoom: (factor: number) => move({ ...renderer.getCamera().getState(), ratio: renderer.getCamera().ratio / factor }),
    /** The reader's "stop the animation" choice: the dots stop, the selection and its links stay drawn. */
    flow(on: boolean) { flowOn = on; startFlow(); },
    motion: (calm: boolean) => { reduced = calm; if (calm) renderer.getCamera().cancelAnimation(); renderer.setSettings({ doubleClickZoomingDuration: calm ? 0 : 180, inertiaDuration: calm ? 0 : 150 }); startFlow(); },
    kill() { dead = true; clearTimeout(timer); cancelAnimationFrame(frame); cancelAnimationFrame(flowFrame); flow.remove(); resize.disconnect(); labels.replaceChildren(); renderer.kill(); },
  };
}
