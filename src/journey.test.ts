import { expect, test } from "bun:test";
import { relationIndex, type GNode } from "../site/src/lib/graph-model";
import { destinations, linked, parseRoute, serializeRoute, truncateRoute } from "../site/src/lib/journey";

const node = (id: string, title = id): GNode => ({ id, title, description: "", type: "Concept", tags: [], degree: 1, x: 0, y: 0, community: "t" });
const NODES = [node("concepts/a", "Alpha"), node("concepts/b", "Été"), node("entities/c", "Chroma, Inc"), node("syntheses/d", "Delta"), node("sources/e", "Echo"), node("x/lonely", "Seul")];
const LINKS = [
	{ source: "concepts/a", target: "concepts/b", mutual: true as const },
	{ source: "concepts/b", target: "entities/c" },
	{ source: "sources/e", target: "concepts/a" },
	{ source: "entities/c", target: "syntheses/d" },
];
const view = { nodes: NODES, links: LINKS };
const index = relationIndex(view), nodes = new Map(NODES.map((n) => [n.id, n]));

test("journey: the route survives the URL, whatever the ids contain", () => {
	const route = ["concepts/a", "concepts/b", "entities/c"];
	expect(serializeRoute(route)).toBe("concepts/a,concepts/b,entities/c");
	// through the URL and back, as the page does it
	const search = new URL(`http://x/graph/?${new URLSearchParams({ route: serializeRoute(route) })}`).search;
	expect(parseRoute(new URLSearchParams(search).get("route"), index)).toEqual(route);
	// a comma or a percent sign inside an id is encoded, not taken for a separator
	expect(serializeRoute(["a,b", "100%"])).toBe("a%2Cb,100%25");
	const odd = relationIndex({ nodes: [node("a,b"), node("100%")], links: [{ source: "a,b", target: "100%" }] });
	expect(parseRoute(serializeRoute(["a,b", "100%"]), odd)).toEqual(["a,b", "100%"]);
	// a hand-typed value works too
	expect(parseRoute("concepts/a,concepts/b", index)).toEqual(["concepts/a", "concepts/b"]);
});

test("journey: unknown ids and steps not linked to the previous one are ignored", () => {
	expect(parseRoute(null, index)).toEqual([]);
	expect(parseRoute("", index)).toEqual([]);
	expect(parseRoute("nope,concepts/a,missing,concepts/b", index)).toEqual(["concepts/a", "concepts/b"]);
	expect(parseRoute("concepts/a,syntheses/d,concepts/b", index)).toEqual(["concepts/a", "concepts/b"]); // d is not linked to a; b is
	expect(parseRoute("concepts/a,concepts/a", index)).toEqual(["concepts/a"]); // not a step
	expect(parseRoute("x/lonely,concepts/a", index)).toEqual(["x/lonely"]);
	expect(parseRoute("concepts/a,%E0%A4%A,concepts/b", index)).toEqual(["concepts/a", "concepts/b"]); // malformed escape
	expect(parseRoute("sources/e,concepts/a,concepts/b,entities/c,concepts/b", index)).toEqual(["sources/e", "concepts/a", "concepts/b", "entities/c", "concepts/b"]); // a page may be revisited
	expect(linked(index, "concepts/b", "concepts/a")).toBe(true); // either direction
	expect(linked(index, "sources/e", "concepts/b")).toBe(false);
});

test("journey: going back cuts the route right after the chosen step", () => {
	const route = ["a", "b", "c", "d"];
	expect(truncateRoute(route, 1)).toEqual(["a", "b"]);
	expect(truncateRoute(route, 3)).toEqual(route);
	expect(route).toHaveLength(4);
});

test("journey: destinations are the pages it cites, then those that cite it, sorted, a mutual page once", () => {
	const d = destinations("concepts/b", index, nodes);
	expect(d.cites.map((n) => n.id)).toEqual(["concepts/a", "entities/c"]); // a is mutual: cited, and not repeated below
	expect(d.citedBy).toEqual([]);
	const c = destinations("entities/c", index, nodes);
	expect(c.cites.map((n) => n.id)).toEqual(["syntheses/d"]);
	expect(c.citedBy.map((n) => n.id)).toEqual(["concepts/b"]);
	const a = destinations("concepts/a", index, nodes);
	expect(a.cites.map((n) => n.title)).toEqual(["Été"]);
	expect(a.citedBy.map((n) => n.title)).toEqual(["Echo"]);
	expect(destinations("x/lonely", index, nodes)).toEqual({ cites: [], citedBy: [] });
	expect(destinations("unknown", index, nodes)).toEqual({ cites: [], citedBy: [] });
	expect(destinations("concepts/a", index, new Map([["sources/e", nodes.get("sources/e")!]])).cites).toEqual([]); // hidden by a filter: not offered
});
