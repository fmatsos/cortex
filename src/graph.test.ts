import { expect, test } from "bun:test";
import { truncateToWidth } from "../site/src/lib/graph-labels";
import {
  buildView, focusNodes, gestureNodes, reconcileSelection, relationIndex, relationsOf, resolveFocus, searchNodes,
  type GNode,
} from "../site/src/lib/graph-model";
import { shapeOf, shapePoints, starPoints, svgPoints } from "../site/src/lib/graph-shapes";

const node = (id: string, type = "Concept", tags: string[] = [], title = id): GNode => ({ id, title, description: "", type, tags, degree: 99, x: 0, y: 0, community: "test" });
const NODES = [
  node("concepts/a", "Concept", ["benchmark", "llm"], "Context rot"),
  node("concepts/b", "Concept", ["llm"], "Context engineering"),
  node("entities/c", "Entity", ["llm"], "Chroma"),
  node("sources/d", "Source", ["benchmark"], "Context Rot — Chroma (2025)"),
  node("sources/e", "Source", [], "Été à Paris"),
];
const LINKS = [
  { source: "concepts/a", target: "concepts/b" },
  { source: "concepts/b", target: "entities/c", mutual: true as const },
  { source: "sources/d", target: "concepts/a" },
  { source: "sources/d", target: "entities/c" },
];
const DATA = { nodes: NODES, links: LINKS };

// --- UI01: the filtered view is a pure function of the data and the filters ---

test("buildView : sans filtre, tout est visible et le degré est recalculé", () => {
  const v = buildView(DATA, { off: new Set(), tag: "" });
  expect(v.nodes).toHaveLength(5);
  expect(v.links).toHaveLength(4);
  const deg = Object.fromEntries(v.nodes.map((n) => [n.id, n.degree]));
  expect(deg).toEqual({ "concepts/a": 2, "concepts/b": 2, "entities/c": 2, "sources/d": 2, "sources/e": 0 });
});

test("buildView : le filtre de tag retire les liens dont une extrémité est masquée, et le degré suit la vue filtrée (UX46)", () => {
  const v = buildView(DATA, { off: new Set(), tag: "benchmark" });
  expect(v.nodes.map((n) => n.id)).toEqual(["concepts/a", "sources/d"]);
  expect(v.links).toEqual([{ source: "sources/d", target: "concepts/a" }]);
  expect(v.nodes.map((n) => n.degree)).toEqual([1, 1]); // `concepts/a` has 2 links in the full graph
});

test("buildView : un tag à une seule page donne un nœud isolé de degré 0 (cas du plantage benchmark)", () => {
  const v = buildView({ nodes: [node("x", "Source", ["benchmark"]), node("y")], links: [{ source: "x", target: "y" }] }, { off: new Set(), tag: "benchmark" });
  expect(v.nodes).toHaveLength(1);
  expect(v.nodes[0].degree).toBe(0);
  expect(v.links).toEqual([]);
});

test("buildView : types masqués, tag inconnu, aucune page", () => {
  expect(buildView(DATA, { off: new Set(["Concept", "Entity", "Source"]), tag: "" }).nodes).toEqual([]);
  expect(buildView(DATA, { off: new Set(), tag: "inconnu" }).nodes).toEqual([]);
  const sansSources = buildView(DATA, { off: new Set(["Source"]), tag: "" });
  expect(sansSources.links.map((l) => l.source)).toEqual(["concepts/a", "concepts/b"]);
});

test("buildView : ne modifie pas les données et ignore les boucles", () => {
  const before = JSON.stringify(DATA);
  buildView({ nodes: NODES, links: [...LINKS, { source: "concepts/a", target: "concepts/a" }] }, { off: new Set(), tag: "" });
  expect(JSON.stringify(DATA)).toBe(before);
  expect(buildView({ nodes: NODES, links: [{ source: "concepts/a", target: "concepts/a" }] }, { off: new Set(), tag: "" }).links).toEqual([]);
});

test("reconcileSelection : la sélection survit tant que le nœud est visible", () => {
  const ids = new Set(["a", "b"]);
  expect(reconcileSelection("a", ids)).toBe("a");
  expect(reconcileSelection("z", ids)).toBeNull();
  expect(reconcileSelection(null, ids)).toBeNull();
  expect(reconcileSelection(undefined, ids)).toBeNull();
  expect(reconcileSelection("a", new Set())).toBeNull();
});

// --- directed relations (UX45) ---

test("relationsOf : cite / cité par, et un lien réciproque compte dans les deux sens", () => {
  expect(relationsOf("concepts/a", LINKS)).toEqual({ cites: ["concepts/b"], citedBy: ["sources/d"] });
  expect(relationsOf("concepts/b", LINKS)).toEqual({ cites: ["entities/c"], citedBy: ["concepts/a", "entities/c"] });
  expect(relationsOf("entities/c", LINKS)).toEqual({ cites: ["concepts/b"], citedBy: ["concepts/b", "sources/d"] });
  expect(relationsOf("sources/e", LINKS)).toEqual({ cites: [], citedBy: [] });
});

test("relationsOf : accepte des extrémités représentées par des objets", () => {
  expect(relationsOf("a", [{ source: { id: "a" }, target: { id: "b" } }])).toEqual({ cites: ["b"], citedBy: [] });
});

test("relationIndex : mêmes relations que relationsOf, pour toutes les pages", () => {
  const v = buildView(DATA, { off: new Set(), tag: "" });
  const idx = relationIndex(v);
  for (const n of v.nodes) {
    const r = relationsOf(n.id, v.links);
    expect([...idx.get(n.id)!.cites].sort()).toEqual([...r.cites].sort());
    expect([...idx.get(n.id)!.citedBy].sort()).toEqual([...r.citedBy].sort());
  }
});

// --- UX32: node search and ?focus= ---

test("searchNodes : préfixe d'abord, accents et casse ignorés, plus liées d'abord à égalité", () => {
  const ns = [node("1", "Concept", [], "Context rot"), node("2", "Concept", [], "Prévenir le context rot"), node("3", "Source", [], "Context Rot — Chroma"), node("4", "Concept", [], "Chroma")];
  ns[0].degree = 1; ns[2].degree = 5;
  expect(searchNodes(ns, "context").map((n) => n.id)).toEqual(["3", "1", "2"]);
  expect(searchNodes(ns, "CONTEXT ROT").map((n) => n.id)).toEqual(["3", "1", "2"]);
  expect(searchNodes([node("e", "Source", [], "Été à Paris")], "ete a").map((n) => n.id)).toEqual(["e"]);
  expect(searchNodes(ns, "rot context").map((n) => n.id).sort()).toEqual(["1", "2", "3"]); // all the words present
  expect(searchNodes(ns, "")).toEqual([]);
  expect(searchNodes(ns, "   ")).toEqual([]);
  expect(searchNodes(ns, "zzz")).toEqual([]);
  expect(searchNodes(ns, "c", 2)).toHaveLength(2);
});

test("resolveFocus : id connu, normalisé ; inconnu ; absent", () => {
  expect(resolveFocus("?focus=concepts%2Fa", NODES)).toEqual({ id: "concepts/a", asked: "concepts/a" });
  expect(resolveFocus("?focus=concepts/a", NODES).id).toBe("concepts/a");
  expect(resolveFocus("?x=1&focus=/wiki/concepts/a.md/", NODES).id).toBe("concepts/a");
  expect(resolveFocus("?focus=concepts/zzz", NODES)).toEqual({ id: null, asked: "concepts/zzz" });
  expect(resolveFocus("?focus=", NODES)).toEqual({ id: null, asked: null });
  expect(resolveFocus("", NODES)).toEqual({ id: null, asked: null });
});

// --- UI18: title truncated to the width ---

test("truncateToWidth : un titre qui tient reste intact, un long titre est coupé avec une ellipse et tient", () => {
  const measure = (s: string) => s.length * 7;
  expect(truncateToWidth("Court", 100, measure)).toBe("Court");
  const long = "Un très long titre de source qui dépasse largement la largeur du canvas";
  const out = truncateToWidth(long, 120, measure);
  expect(out.endsWith("…")).toBe(true);
  expect(measure(out)).toBeLessThanOrEqual(120);
  expect(measure(truncateToWidth(long, 121, measure))).toBeLessThanOrEqual(121);
  expect(truncateToWidth(long, 120, measure).length).toBeGreaterThan(10); // not too short: cuts as close as possible
  expect(truncateToWidth(long, 3, measure)).toBe("…");
  expect(truncateToWidth("", 10, measure)).toBe("");
});

// --- D04 / D02 : shapes ---

test("shapeOf : une forme distincte par type, cercle par défaut", () => {
  expect(new Set(["Concept", "Entity", "Synthesis", "Source"].map(shapeOf)).size).toBe(4);
  expect(shapeOf("Autre")).toBe("circle");
});

test("shapePoints : polygones centrés, cercle sans sommets", () => {
  expect(shapePoints("circle", 0, 0, 5)).toBeNull();
  for (const s of ["square", "diamond", "triangle"] as const) {
    const pts = shapePoints(s, 10, 20, 5)!;
    expect(pts.length).toBe(s === "triangle" ? 3 : 4);
    for (const [x, y] of pts) { expect(Math.abs(x - 10)).toBeLessThanOrEqual(7); expect(Math.abs(y - 20)).toBeLessThanOrEqual(7); }
  }
  expect(shapePoints("square", 0, 0, 10)![0]).toEqual([-9, -9]);
});

test("starPoints : dix sommets alternés, branche vers le haut", () => {
  const p = starPoints(0, 0, 10);
  expect(p).toHaveLength(10);
  expect(p[0][0]).toBeCloseTo(0);
  expect(p[0][1]).toBeCloseTo(-10);
  expect(Math.hypot(...p[1])).toBeCloseTo(4.5);
});

test("svgPoints : chaîne de points pour la légende, null pour le cercle", () => {
  expect(svgPoints("circle", 14)).toBeNull();
  expect(svgPoints("diamond", 14)).toMatch(/^[\d.,\- ]+$/);
  expect(svgPoints("triangle", 14)!.split(" ")).toHaveLength(3);
});

// --- UI01: non-regression guard on the filtering effect (the crash came from reactive dependencies read in apply) ---

test("graph-view : l'effet de filtrage n'appelle apply() que sous untrack, avec la vue en seul suivi", async () => {
  const src = await Bun.file(new URL("../site/src/lib/components/graph-view.svelte", import.meta.url)).text();
  const effect = src.match(/\$effect\(\(\) => \{[\s\S]*?\n\t\}\);/)![0];
  expect(effect).toContain("untrack(() => apply?.(v))");
  expect(effect).not.toMatch(/\bsel\b/);
});

test("focusNodes: camera limits hubs without removing any visible relations", () => {
  const center = node("center");
  const peers = Array.from({ length: 50 }, (_, i) => ({ ...node(`n${i}`), x: i + 1 }));
  const view = buildView({ nodes: [center, ...peers], links: peers.map((p) => ({ source: center.id, target: p.id })) }, { off: new Set(), tag: "" });
  expect(focusNodes(center.id, view)).toHaveLength(31);
  expect(focusNodes(center.id, view).at(-1)!.x).toBe(30);
  expect(view.links).toHaveLength(50);
  expect(focusNodes("missing", view)).toEqual([]);
});

test("gestureNodes: bounded landmarks preserve the focus and communities without changing the scope", () => {
  const nodes = Array.from({ length: 2000 }, (_, i) => ({ ...node(`n${i}`), degree: i % 80, community: `c${i % 65}` }));
  const view = { nodes, links: [], ids: new Set(nodes.map((n) => n.id)) };
  const focus = new Set(["n0", "n100", "missing"]), kept = gestureNodes(view, focus);
  expect(kept.size).toBe(120);
  expect(kept.has("n0") && kept.has("n100")).toBe(true);
  expect(kept.has("missing")).toBe(false);
  expect(new Set(nodes.filter((n) => kept.has(n.id)).map((n) => n.community)).size).toBe(65);
  expect(view.nodes).toHaveLength(2000);
});
