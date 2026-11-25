import { UndirectedGraph } from "graphology";
import louvain from "graphology-communities-louvain";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { GraphData } from "../site/src/lib/types";
import { collator } from "./text";
import { Delaunay } from "d3-delaunay";
import { islandRadius, MIN_ISLAND, packBoxes, packIslands, MISC, SEA } from "../site/src/lib/graph-pack";

/** Number of --map-country-* tokens. */
const COUNTRY_COLORS = 6;

type InputNode = Omit<GraphData["nodes"][number], "x" | "y" | "community">;
type Input = { nodes: InputNode[]; links: GraphData["links"] };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** An export has no time/random dependency, including Louvain's walk and FA2's insertion order. */
function random() {
  let seed = 0x434f5254;
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

/** Canonical wiki links stay intact. Hub compensation affects placement, never the exported relations. */
export function layoutGraph(input: Input): GraphData {
  const nodes = [...input.nodes].sort((a, b) => compare(a.id, b.id));
  const links = [...input.links].sort((a, b) => compare(a.source, b.source) || compare(a.target, b.target));
  const graph = new UndirectedGraph({ allowSelfLoops: false });
  const core = new UndirectedGraph({ allowSelfLoops: false });
  const rng = random();
  for (const n of nodes) {
    graph.addNode(n.id, { x: (rng() - 0.5) * 100, y: (rng() - 0.5) * 100, size: 1 });
    if (n.type !== "Source") core.addNode(n.id);
  }
  for (const e of links) {
    if (e.source === e.target || !graph.hasNode(e.source) || !graph.hasNode(e.target) || graph.hasEdge(e.source, e.target)) continue;
    graph.addEdge(e.source, e.target, { mutual: !!e.mutual });
  }
  graph.forEachEdge((key, attrs, a, b) => {
    // Common hubs should not drag every subject into the same centre.
    const weight = 1 / Math.sqrt(Math.max(1, graph.degree(a)) * Math.max(1, graph.degree(b)));
    graph.setEdgeAttribute(key, "weight", weight);
    if (core.hasNode(a) && core.hasNode(b)) core.addEdge(a, b, { weight });
  });
  const partition = core.order ? louvain(core, { rng: random(), resolution: 1.1, getEdgeWeight: "weight" }) : {};
  const names = new Map<number, string>();
  for (const n of nodes) if (partition[n.id] !== undefined && !names.has(partition[n.id])) names.set(partition[n.id], n.id);
  const membership = new Map<string, string>();
  for (const n of nodes) if (partition[n.id] !== undefined) membership.set(n.id, names.get(partition[n.id])!);
  // Attach a Source using its core neighbours first; source chains inherit the nearest assigned community.
  for (const n of nodes.filter((n) => n.type === "Source")) {
    const votes = new Map<string, number>();
    for (const peer of graph.neighbors(n.id)) if (core.hasNode(peer)) {
      const id = membership.get(peer)!;
      votes.set(id, (votes.get(id) ?? 0) + 1 / Math.sqrt(Math.max(1, core.degree(peer))));
    }
    const winner = [...votes].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))[0];
    if (winner) membership.set(n.id, winner[0]);
  }
  let frontier = nodes.filter((n) => membership.has(n.id)).map((n) => n.id);
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) for (const peer of graph.neighbors(id).sort(compare)) if (!membership.has(peer)) {
      membership.set(peer, membership.get(id)!); next.push(peer);
    }
    frontier = next;
  }
  // Source-only components and isolated pages remain real, discoverable groups.
  for (const n of nodes) if (!membership.has(n.id)) {
    const pending = [n.id]; membership.set(n.id, n.id);
    while (pending.length) for (const peer of graph.neighbors(pending.pop()!).sort(compare)) if (!membership.has(peer)) {
      membership.set(peer, n.id); pending.push(peer);
    }
  }
  // Unlinked pages and groups too small for a tag share one "Various" island (labelled in the browser)
  // instead of a grid of anonymous little islands.
  const sizes = new Map<string, number>();
  for (const id of membership.values()) sizes.set(id, (sizes.get(id) ?? 0) + 1);
  const small = nodes.filter((n) => sizes.get(membership.get(n.id)!)! < MIN_ISLAND);
  if (small.length > 1) for (const n of small) membership.set(n.id, MISC);
  if (graph.size) forceAtlas2.assign(graph, {
    iterations: 240, getEdgeWeight: "weight",
    settings: { linLogMode: true, outboundAttractionDistribution: true, scalingRatio: 12, gravity: 0.08, slowDown: 4, barnesHutOptimize: true, barnesHutTheta: 0.6 },
  });
  const groups = new Map<string, InputNode[]>();
  for (const n of nodes) { const id = membership.get(n.id)!; (groups.get(id) ?? groups.set(id, []).get(id)!).push(n); }
  const tagCounts = new Map<string, number>();
  for (const n of nodes) for (const tag of n.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  const dominantTags = (members: InputNode[]) => {
    const tags = new Map<string, number>();
    for (const n of members) for (const tag of n.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    const idf = (tag: string) => Math.log(1 + nodes.length / tagCounts.get(tag)!);
    return [...tags].sort((a, b) => b[1] * idf(b[0]) - a[1] * idf(a[0]) || compare(a[0], b[0])).map(([t]) => t.replaceAll("-", " "));
  };
  const ordered = [...groups].sort((a, b) => b[1].length - a[1].length || compare(a[0], b[0]));

  // Continents: Louvain over the countries, weighted by the links between them; Various stays an archipelago of its own.
  const between = new UndirectedGraph({ allowSelfLoops: false });
  for (const [id] of ordered) if (id !== MISC) between.addNode(id);
  for (const e of links) {
    const a = membership.get(e.source)!, b = membership.get(e.target)!;
    if (a === b || a === MISC || b === MISC) continue;
    if (between.hasEdge(a, b)) between.updateEdgeAttribute(a, b, "weight", (w: number) => w + 1);
    else between.addEdge(a, b, { weight: 1 });
  }
  const parts = between.size ? louvain(between, { rng: random(), resolution: 1, getEdgeWeight: "weight" }) : {};
  const continentOf = new Map<string, string>(), continentName = new Map<number, string>();
  for (const [id] of ordered) {
    if (id === MISC || parts[id] === undefined) { continentOf.set(id, id); continue; }
    if (!continentName.has(parts[id])) continentName.set(parts[id], id); // named after its largest country
    continentOf.set(id, continentName.get(parts[id])!);
  }

  // Local layout of each country: its pages' FA2 placement scaled into its radius.
  const local = new Map<string, { x: number; y: number }>();
  for (const [, members] of ordered) {
    const radius = islandRadius(members.length);
    const xy = members.map((n) => graph.getNodeAttributes(n.id));
    const mx = xy.reduce((s, p) => s + p.x, 0) / members.length, my = xy.reduce((s, p) => s + p.y, 0) / members.length;
    const extent = Math.max(1, ...xy.map((p) => Math.hypot(p.x - mx, p.y - my)));
    members.forEach((n, j) => local.set(n.id, { x: (xy[j].x - mx) / extent * radius, y: (xy[j].y - my) / extent * radius }));
  }

  // Countries touch inside a continent (no gap); continents are boxes packed with sea between them.
  const continents = new Map<string, [string, InputNode[]][]>();
  for (const entry of ordered) { const c = continentOf.get(entry[0])!; (continents.get(c) ?? continents.set(c, []).get(c)!).push(entry); }
  const shapes = [...continents].map(([id, countries]) => {
    // a negative gap: neighbouring countries overlap their margins, so they share a border instead of a strait
    const centers = packIslands(countries.map(([, m]) => m.length), 1.4, -60);
    const xs = countries.flatMap(([, m], i) => [centers[i].x - islandRadius(m.length), centers[i].x + islandRadius(m.length)]);
    const ys = countries.flatMap(([, m], i) => [centers[i].y - islandRadius(m.length), centers[i].y + islandRadius(m.length)]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    return { id, countries, centers: centers.map((c) => ({ x: c.x - cx, y: c.y - cy })), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }).sort((a, b) => b.w * b.h - a.w * a.h || compare(a.id, b.id));
  const placed = packBoxes(shapes, 16 / 9, SEA);
  const round = (v: number) => Math.round(v * 10) / 10;
  const positions = new Map<string, { x: number; y: number }>();
  const communities: GraphData["communities"] = [];
  const continentData: GraphData["continents"] = [];
  for (const [k, shape] of shapes.entries()) {
    const at = placed[k], members: InputNode[] = [];
    for (const [i, [id, countryMembers]] of shape.countries.entries()) {
      const center = { x: at.x + shape.centers[i].x, y: at.y + shape.centers[i].y };
      for (const n of countryMembers) { const l = local.get(n.id)!; positions.set(n.id, { x: Math.round((center.x + l.x) * 1000) / 1000, y: Math.round((center.y + l.y) * 1000) / 1000 }); members.push(n); }
      const reps = [...countryMembers].sort((a, b) => Number(a.type === "Source") - Number(b.type === "Source") || graph.degree(b.id) - graph.degree(a.id) || compare(a.id, b.id)).slice(0, 3);
      const dominant = dominantTags(countryMembers);
      communities.push({ id, label: id === MISC ? "" : dominant.length ? dominant.slice(0, 2).join(" · ") : reps[0].title, size: countryMembers.length, representatives: reps.map((n) => n.id), x: center.x, y: center.y, continent: shape.id, color: 0 });
    }
    // Voronoi territories of the pages, bounded by the continent box plus a coast margin; borders where countries meet.
    const points = members.map((n) => positions.get(n.id)!);
    const delaunay = Delaunay.from(points, (p) => p.x, (p) => p.y);
    const voronoi = delaunay.voronoi([at.x - shape.w / 2 - 80, at.y - shape.h / 2 - 80, at.x + shape.w / 2 + 80, at.y + shape.h / 2 + 80]);
    const cells = members.map((n, i) => ({ id: n.id, points: (voronoi.cellPolygon(i) ?? []).flat().map(round) }));
    // A border is the edge two cells of different countries share; the cells are already clipped to the continent box,
    // so no border runs off across the sea (a raw circumcentre of a flat triangle can lie far away).
    const borders: number[] = [];
    const key = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;
    const { halfedges, triangles } = delaunay;
    for (let e = 0; e < halfedges.length; e++) {
      const j = halfedges[e];
      if (j < e) continue;
      const p = triangles[e], q = triangles[e % 3 === 2 ? e - 2 : e + 1];
      if (membership.get(members[p].id) === membership.get(members[q].id)) continue;
      const a = voronoi.cellPolygon(p), b = voronoi.cellPolygon(q);
      if (!a || !b) continue;
      const inB = new Set(b.map(([x, y]) => key(x, y)));
      const shared = [...new Map(a.filter(([x, y]) => inB.has(key(x, y))).map(([x, y]) => [key(x, y), [x, y]])).values()];
      if (shared.length >= 2) borders.push(round(shared[0][0]), round(shared[0][1]), round(shared[1][0]), round(shared[1][1]));
    }
    const label = shape.id === MISC ? "" : dominantTags(members)[0] ?? "";
    continentData.push({ id: shape.id, label, size: members.length, x: at.x, y: at.y, w: shape.w, h: shape.h, cells, borders });
  }

  // Political colours: greedy over countries by size, never the colour of a neighbour (a Delaunay edge between two countries).
  const neighbours = new Map<string, Set<string>>();
  for (const c of continentData) {
    const members = c.cells.map((cell) => membership.get(cell.id)!);
    const delaunay = Delaunay.from(c.cells.map((cell) => positions.get(cell.id)!), (p) => p.x, (p) => p.y);
    for (let e = 0; e < delaunay.triangles.length; e++) {
      const a = members[delaunay.triangles[e]], b = members[delaunay.triangles[e % 3 === 2 ? e - 2 : e + 1]];
      if (a !== b) { (neighbours.get(a) ?? neighbours.set(a, new Set()).get(a)!).add(b); (neighbours.get(b) ?? neighbours.set(b, new Set()).get(b)!).add(a); }
    }
  }
  const colorOf = new Map<string, number>();
  for (const c of communities) {
    const taken = new Set([...(neighbours.get(c.id) ?? [])].map((n) => colorOf.get(n)));
    let color = 0; while (taken.has(color)) color++;
    colorOf.set(c.id, color % COUNTRY_COLORS); c.color = color % COUNTRY_COLORS;
  }
  return { nodes: nodes.map((n) => ({ ...n, degree: graph.degree(n.id), ...positions.get(n.id)!, community: membership.get(n.id)! })).sort((a, b) => collator.compare(a.title, b.title) || collator.compare(a.id, b.id)), links, communities, continents: continentData };
}
