import { expect, test } from "bun:test";
import { truncateToWidth } from "../site/src/lib/graph-labels";
import {
  AMBIENT_MAX_LINKS, buildView, createTimer, particleCount, reconcileSelection, relationIndex, relationsOf, resolveFocus, searchNodes, simLinks,
  type GNode,
} from "../site/src/lib/graph-model";
import { shapeOf, shapePoints, starPoints, svgPoints } from "../site/src/lib/graph-shapes";

const node = (id: string, type = "Concept", tags: string[] = [], title = id): GNode => ({ id, title, description: "", type, tags, degree: 99 });
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

test("relationsOf : accepte des extrémités devenues des objets (force-graph)", () => {
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

test("simLinks : un lien réciproque reçoit un jumeau inverse, les autres gardent leur sens", () => {
  const out = simLinks(LINKS);
  expect(out).toHaveLength(5);
  expect(out.filter((l) => l.twin)).toEqual([{ source: "entities/c", target: "concepts/b", twin: true }]);
  expect(out[0]).toEqual({ source: "concepts/a", target: "concepts/b" }); // source → target: the direction of the particles
  expect(out.find((l) => l.source === "sources/d" && l.target === "concepts/a")).toBeDefined();
  expect(out.find((l) => l.source === "concepts/a" && l.target === "sources/d")).toBeUndefined();
});

test("particleCount : voisinage en valeur, ambiance, mouvement réduit, pause", () => {
  const base = { calm: false, paused: false, hot: false, dim: false, linkCount: 10 };
  expect(particleCount({ ...base, hot: true })).toBe(3);
  expect(particleCount(base)).toBe(1);
  expect(particleCount({ ...base, dim: true })).toBe(0); // a neighborhood is isolated: the rest goes quiet
  expect(particleCount({ ...base, linkCount: AMBIENT_MAX_LINKS + 1 })).toBe(0);
  expect(particleCount({ ...base, linkCount: AMBIENT_MAX_LINKS + 1, hot: true })).toBe(3);
  expect(particleCount({ ...base, calm: true, hot: true })).toBe(0); // prefers-reduced-motion
  expect(particleCount({ ...base, paused: true, hot: true })).toBe(0);
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

// --- UI06 / UX34: a single deferred refit, cancelable ---

test("createTimer : reprogrammer annule le précédent ; cancel l'annule ; l'échéance s'exécute une fois", () => {
  const pending = new Map<number, () => void>();
  let next = 1;
  const set = (fn: () => void) => { pending.set(next, fn); return next++; };
  const clear = (h: number) => { pending.delete(h); };
  const t = createTimer(set, clear);
  const ran: string[] = [];
  t.schedule(() => ran.push("a"), 700);
  t.schedule(() => ran.push("b"), 700);
  expect(pending.size).toBe(1);
  expect(t.pending).toBe(true);
  t.cancel(); // manual interaction or unmount
  expect(pending.size).toBe(0);
  expect(t.pending).toBe(false);
  t.cancel(); // no effect
  t.schedule(() => ran.push("c"), 700);
  [...pending.values()][0]();
  expect(ran).toEqual(["c"]);
  expect(t.pending).toBe(false);
});

test("createTimer : avec de vraies minuteries, l'annulation empêche l'exécution", async () => {
  const t = createTimer();
  let n = 0;
  t.schedule(() => n++, 5);
  t.cancel();
  t.schedule(() => n++, 5);
  await Bun.sleep(30);
  expect(n).toBe(1);
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
