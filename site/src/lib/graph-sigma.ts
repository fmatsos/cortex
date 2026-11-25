import Sigma from "sigma";
import { sdfCircle, sdfSquare, sdfDiamond, sdfTriangle } from "sigma/rendering";
import { UndirectedGraph } from "graphology";
import { focusNodes, gestureNodes, type GNode, type GraphView } from "./graph-model";
import { placeLabels, truncateToWidth } from "./graph-labels";
import { shapeOf, SHAPE_SCALE } from "./graph-shapes";
import { islandRadius, packIslands, MISC } from "./graph-pack";
import type { GraphData } from "./types";
import { TYPES } from "./type-meta";
import { t } from "./i18n/index";

type Node = GNode & { label: string; size: number; [key: string]: unknown };
type Callbacks = { select: (id: string | null) => void; open: (id: string) => void; favorite: (id: string) => boolean };

/** Browser-only renderer. Physics and community detection never enter this bundle. */
export function createGraph(el: HTMLElement, labels: HTMLElement, raw: GraphData, callbacks: Callbacks) {
  // The export packs the islands for one ratio; repack them for this frame (the placement inside an island is kept).
  // ponytail: once at creation, a later resize (side panel) only refits the camera
  const centers = packIslands(raw.communities.map((c) => c.size), el.clientWidth && el.clientHeight ? Math.max(0.6, el.clientWidth / el.clientHeight) : 16 / 9);
  const shift = new Map(raw.communities.map((c, i) => [c.id, { x: centers[i].x - c.x, y: centers[i].y - c.y }]));
  raw = {
    ...raw,
    nodes: raw.nodes.map((n) => { const d = shift.get(n.community); return d ? { ...n, x: n.x + d.x, y: n.y + d.y } : n; }),
    communities: raw.communities.map((c, i) => ({ ...c, ...centers[i], label: c.id === MISC ? t("graph.misc") : c.label })),
  };
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
  let emphasized = new Set<string>();
  let landmarks = new Set<string>();
  const peers = new Map<string, Set<string>>();
  let reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let timer: ReturnType<typeof setTimeout> | undefined, frame = 0, dead = false;
  function readPalette() {
    const css = getComputedStyle(document.documentElement), value = (key: string) => css.getPropertyValue(key).trim();
    return { sea: value("--map-sea"), land: value("--map-land"), coast: value("--map-coast"), background: value("--graph-background"), edge: value("--graph-edge"), active: value("--graph-edge-active"), label: value("--graph-label"), favorite: value("--favorite"), types: Object.fromEntries(TYPES.map((t) => [t.type, value(t.color)])) };
  }
  let palette = readPalette();
  const representatives = new Set(raw.communities.flatMap((c) => c.representatives));
  const nodeSize = (n: GNode) => (n.type === "Source" ? 2 + Math.min(1, Math.log2(n.degree + 1) * 0.3) : Math.min(9, 3.5 + Math.log2(n.degree + 1) * 0.8)) * SHAPE_SCALE[shapeOf(n.type)];
  function nodeVisual(id: string, n: GNode) {
    const context = selected ?? hovered, active = context === id, inContext = hot.has(id), favorite = callbacks.favorite(id);
    return {
      shape: shapeOf(n.type), color: palette.types[n.type] ?? palette.label,
      visibility: moving && !landmarks.has(id) && dragged !== id ? "hidden" : "visible",
      opacity: context && !inContext ? 0.12 : n.type === "Source" && !inContext ? 0.55 : 1,
      size: active ? Math.max(7, nodeSize(n)) : nodeSize(n),
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
    primitives: { nodes: { shapes: [sdfCircle(), sdfSquare(), sdfDiamond(), sdfTriangle()], label: { font: { family: font, size: fontSize }, zoomToLabelSizeRatioFunction: () => 1 } } },
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
  const SHORE = 46, COAST = 6;
  function drawLand() {
    const { width, height } = renderer.getDimensions(), dpr = devicePixelRatio || 1;
    if (land.width !== Math.round(width * dpr) || land.height !== Math.round(height * dpr)) { land.width = Math.round(width * dpr); land.height = Math.round(height * dpr); land.style.width = `${width}px`; land.style.height = `${height}px`; }
    landContext.setTransform(1, 0, 0, 1, 0, 0);
    landContext.clearRect(0, 0, land.width, land.height);
    if (!map || !scope.nodes.length) return;
    const o = renderer.graphToViewport({ x: 0, y: 0 }), ux = renderer.graphToViewport({ x: 1, y: 0 }), uy = renderer.graphToViewport({ x: 0, y: 1 });
    landContext.setTransform((ux.x - o.x) * dpr, (ux.y - o.y) * dpr, (uy.x - o.x) * dpr, (uy.y - o.y) * dpr, o.x * dpr, o.y * dpr);
    landContext.strokeStyle = palette.coast; landContext.lineCap = "round"; landContext.setLineDash([8, 14]);
    for (const r of routes) {
      landContext.lineWidth = 1.5 + Math.log2(r.count);
      landContext.beginPath(); landContext.moveTo(r.a.x, r.a.y); landContext.lineTo(r.b.x, r.b.y); landContext.stroke();
    }
    landContext.setLineDash([]);
    // a bedrock disc per island keeps it one landmass; the page discs give it its coast
    const bedrock = raw.communities.filter((c) => counts.has(c.id));
    for (const [color, grow] of [[palette.coast, COAST], [palette.land, 0]] as const) {
      landContext.fillStyle = color; landContext.beginPath();
      for (const c of bedrock) { const r = islandRadius(counts.get(c.id)!) * 0.55 + grow; landContext.moveTo(c.x + r, c.y); landContext.arc(c.x, c.y, r, 0, Math.PI * 2); }
      for (const n of scope.nodes) { const q = positions.get(n.id)!, r = SHORE + grow; landContext.moveTo(q.x + r, q.y); landContext.arc(q.x, q.y, r, 0, Math.PI * 2); }
      landContext.fill();
    }
  }
  let counts = new Map<string, number>();
  function syncRoutes() {
    counts = new Map();
    for (const n of scope.nodes) counts.set(n.community, (counts.get(n.community) ?? 0) + 1);
    const center = new Map(raw.communities.map((c) => [c.id, c])), community = new Map(scope.nodes.map((n) => [n.id, n.community])), pairs = new Map<string, number>();
    for (const e of scope.links) {
      const a = community.get(e.source), b = community.get(e.target);
      if (!a || !b || a === b) continue;
      const key = a < b ? `${a}\t${b}` : `${b}\t${a}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
    // each island keeps only its two strongest routes: a readable sea, not a second hairball
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
    syncStyles();
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
    if (!context && ratio > 0.5) {
      const counts = new Map<string, number>();
      for (const n of scope.nodes) counts.set(n.community, (counts.get(n.community) ?? 0) + 1);
      // Various goes first: an island of scattered pages is only readable through its tag
      const visible = raw.communities.filter((c) => (counts.get(c.id) ?? 0) >= 4).sort((a, b) => Number(b.id === MISC) - Number(a.id === MISC));
      const kept = placeLabels(visible, (c) => {
        const p = renderer.graphToViewport(c), w = Math.min(280, measure.measureText(c.label).width + 16);
        return p.x < w / 2 || p.x > width - w / 2 || p.y < 40 || p.y > height ? null : { x: p.x - w / 2, y: p.y - 37, w, h: 26 };
      }, 12, 12);
      for (const c of kept) {
        const p = renderer.graphToViewport(c), button = document.createElement("button"), w = Math.min(280, measure.measureText(c.label).width + 16);
        reserved.push({ x: p.x - w / 2 - 2, y: p.y - 39, w: w + 4, h: 30, force: true });
        button.type = "button"; button.textContent = c.label;
        const count = counts.get(c.id)!;
        button.title = t("common.pages", { count }); button.setAttribute("aria-label", `${c.label} (${count})`);
        button.className = map
          ? "pointer-events-auto absolute max-w-64 truncate px-1 py-0.5 text-sm font-semibold text-foreground [text-shadow:0_0_3px_var(--map-land),0_0_3px_var(--map-land),0_0_6px_var(--map-land)] focus-visible:outline focus-visible:outline-2"
          : "pointer-events-auto absolute max-w-64 truncate border bg-background/95 px-2 py-1 text-xs text-muted-foreground focus-visible:outline focus-visible:outline-2";
        button.style.cssText = `left:${p.x}px;top:${p.y - 25}px;transform:translate(-50%,-50%);opacity:${Math.min(1, (ratio - 0.5) * 2)}`;
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
  const flow = document.createElement("canvas"), flowContext = flow.getContext("2d")!;
  flow.setAttribute("aria-hidden", "true"); flow.dataset.flow = "";
  flow.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  el.append(flow);
  let flowFrame = 0;
  function flowLinks() {
    const context = selected ?? hovered;
    if (!context || moving || reduced || dead) return [];
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
    landmarks = gestureNodes(scope, emphasized);
    if (moving && projected) populate(scope.nodes.filter((n) => landmarks.has(n.id)), []);
    else if (moving) syncStyles(); else updateLabels();
    startFlow();
  }
  function move(state: { x: number; y: number; ratio: number }) {
    if (reduced) renderer.getCamera().setState(state);
    else void renderer.getCamera().animate(state, { duration: 250 });
  }
  function fit(nodes = scope.nodes) {
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
    move({ x, y, ratio });
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
  renderer.on("afterRender", () => { el.dataset.rendered = "true"; drawLand(); });
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
    mode(next: "graph" | "map") {
      map = next === "map"; el.dataset.mode = next;
      readTheme(); updateLabels(); renderer.refresh();
    },
    fit, resize: () => { renderer.resize(); updateLabels(); }, theme: readTheme,
    zoom: (factor: number) => move({ ...renderer.getCamera().getState(), ratio: renderer.getCamera().ratio / factor }),
    motion: (calm: boolean) => { reduced = calm; if (calm) renderer.getCamera().cancelAnimation(); renderer.setSettings({ doubleClickZoomingDuration: calm ? 0 : 180, inertiaDuration: calm ? 0 : 150 }); startFlow(); },
    kill() { dead = true; clearTimeout(timer); cancelAnimationFrame(frame); cancelAnimationFrame(flowFrame); flow.remove(); resize.disconnect(); labels.replaceChildren(); renderer.kill(); },
  };
}
