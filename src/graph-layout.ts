import { UndirectedGraph } from "graphology";
import louvain from "graphology-communities-louvain";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { GraphData } from "../site/src/lib/types";
import { collator } from "./text";
import { islandRadius, MIN_ISLAND, packIslands, MISC } from "../site/src/lib/graph-pack";

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
  const ordered = [...groups].sort((a, b) => b[1].length - a[1].length || compare(a[0], b[0]));
  const centers = packIslands(ordered.map(([, members]) => members.length), 16 / 9);
  const positions = new Map<string, { x: number; y: number }>();
  const communities: GraphData["communities"] = [];
  // A separate island per community prevents global hubs from swallowing small subjects.
  for (const [i, [id, members]] of ordered.entries()) {
    const radius = islandRadius(members.length), center = centers[i];
    const xy = members.map((n) => graph.getNodeAttributes(n.id));
    const mx = xy.reduce((s, p) => s + p.x, 0) / members.length, my = xy.reduce((s, p) => s + p.y, 0) / members.length;
    const extent = Math.max(1, ...xy.map((p) => Math.hypot(p.x - mx, p.y - my)));
    for (let j = 0; j < members.length; j++) positions.set(members[j].id, {
      x: Math.round((center.x + (xy[j].x - mx) / extent * radius) * 1000) / 1000,
      y: Math.round((center.y + (xy[j].y - my) / extent * radius) * 1000) / 1000,
    });
    const reps = [...members].sort((a, b) => Number(a.type === "Source") - Number(b.type === "Source") || graph.degree(b.id) - graph.degree(a.id) || compare(a.id, b.id)).slice(0, 3);
    const tags = new Map<string, number>();
    for (const n of members) for (const tag of n.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    const dominant = [...tags].sort((a, b) => b[1] * Math.log(1 + nodes.length / tagCounts.get(b[0])!) - a[1] * Math.log(1 + nodes.length / tagCounts.get(a[0])!) || compare(a[0], b[0]));
    communities.push({ id, label: id === MISC ? "" : dominant.length ? dominant.slice(0, 2).map(([t]) => t.replaceAll("-", " ")).join(" · ") : reps[0].title, size: members.length, representatives: reps.map((n) => n.id), x: center.x, y: center.y });
  }
  return { nodes: nodes.map((n) => ({ ...n, degree: graph.degree(n.id), ...positions.get(n.id)!, community: membership.get(n.id)! })).sort((a, b) => collator.compare(a.title, b.title) || collator.compare(a.id, b.id)), links, communities };
}
