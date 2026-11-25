import { expect, test } from "bun:test";
import { layoutGraph } from "./graph-layout";
import { packIslands, UNLINKED } from "../site/src/lib/graph-pack";
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
    expect(graph.communities).toHaveLength(1); // one page alone keeps its island, several unlinked pages share one
    expect(graph.nodes.every((n) => Number.isFinite(n.x + n.y))).toBe(true);
  }
});

test("graph layout: unlinked pages share one island, linked pages keep theirs", () => {
  const graph = layoutGraph({ nodes: [node("a"), node("b"), node("u1"), node("u2", "Source"), node("u3")], links: graphLinks(new Set(["a\tb"])) });
  const community = (id: string) => graph.nodes.find((n) => n.id === id)!.community;
  expect(new Set(["u1", "u2", "u3"].map(community))).toEqual(new Set([UNLINKED]));
  expect(community("a")).not.toBe(UNLINKED);
  expect(graph.communities.find((c) => c.id === UNLINKED)?.size).toBe(3);
});

test("packIslands follows the frame ratio: a wide frame gets a wider layout than a square one", () => {
  const sizes = [84, 49, 30, 20, 12, 8, 8, 5, 4, 3, 2, 2, 1, 1, 1, 1];
  const ratio = (aspect: number) => {
    const c = packIslands(sizes, aspect), xs = c.map((p) => p.x), ys = c.map((p) => p.y);
    return (Math.max(...xs) - Math.min(...xs)) / Math.max(1, Math.max(...ys) - Math.min(...ys));
  };
  expect(ratio(2.25)).toBeGreaterThan(ratio(1) * 1.5);
});
