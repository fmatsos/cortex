import { expect, test } from "bun:test";
import { layoutGraph } from "./graph-layout";
import { graphLinks } from "./export";

const node = (id: string, type = "Concept") => ({ id, title: id, description: "", type, tags: ["topic"], degree: 0 });
const input = {
  nodes: [node("a"), node("b", "Entity"), node("s", "Source"), node("chain", "Source"), node("isolated"), node("source-only", "Source"), node("source-peer", "Source")],
  links: graphLinks(new Set(["a\tb", "b\ta", "s\ta", "chain\ts", "source-only\tsource-peer"])),
};

test("graph layout: byte-identical, independent of insertion order, input untouched", () => {
  const before = JSON.stringify(input), first = JSON.stringify(layoutGraph(input));
  expect(JSON.stringify(layoutGraph(input))).toBe(first);
  expect(JSON.stringify(layoutGraph({ nodes: [...input.nodes].reverse(), links: [...input.links].reverse() }))).toBe(first);
  expect(JSON.stringify(input)).toBe(before);
});

test("graph layout: finite positions, canonical reciprocity, every page covered by a community", () => {
  const graph = layoutGraph(input);
  expect(graph.links).toEqual(input.links);
  expect(graph.links.filter((e) => e.mutual)).toEqual([{ source: "a", target: "b", mutual: true }]);
  expect(graph.communities.reduce((sum, c) => sum + c.size, 0)).toBe(graph.nodes.length);
  for (const n of graph.nodes) {
    expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
    const community = graph.communities.find((c) => c.id === n.community)!;
    expect(community).toBeDefined();
    expect(community.representatives.length).toBeGreaterThan(0);
    expect(community.representatives.every((id) => graph.nodes.some((p) => p.id === id && p.community === community.id))).toBe(true);
  }
  const community = (id: string) => graph.nodes.find((n) => n.id === id)!.community;
  expect(community("s")).toBe(community("a"));
  expect(community("chain")).toBe(community("s"));
  expect(community("source-only")).toBe(community("source-peer"));
  expect(community("isolated")).not.toBe(community("a"));
});

test("graph layout: empty and singleton wiki, all-Source wiki", () => {
  expect(layoutGraph({ nodes: [], links: [] })).toEqual({ nodes: [], links: [], communities: [] });
  for (const nodes of [[node("only")], [node("s1", "Source"), node("s2", "Source")]]) {
    const graph = layoutGraph({ nodes, links: [] });
    expect(graph.nodes).toHaveLength(nodes.length);
    expect(graph.communities).toHaveLength(nodes.length);
    expect(graph.nodes.every((n) => Number.isFinite(n.x + n.y))).toBe(true);
  }
});
