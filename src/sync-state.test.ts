import { expect, test } from "bun:test";
import { plan, readServer, stateKey, toBody, type SyncState } from "../site/src/lib/sync-state";
import { journeyQuery, parseRoute } from "../site/src/lib/journey";

const local: SyncState = { theme: "dark", lang: "fr", reading: true, comfort: false, favs: ["a", "b"] };

test("readServer: keeps the recognised valid fields and nothing else", () => {
  expect(readServer({ theme: "light", lang: "en", reading: true, comfort: false, favs: ["x", "x", "", 3, "y"], other: 1 })).toEqual({ theme: "light", lang: "en", reading: true, comfort: false, favs: ["x", "y"] });
  expect(readServer({ theme: "purple", lang: 3, reading: "yes", comfort: 1, favs: "x" })).toEqual({});
  for (const bad of [null, undefined, "text", 4, [], [1]]) expect(readServer(bad)).toEqual({});
});

test("plan: a server that holds nothing we know (first synchronisation of the account) takes the local state", () => {
  for (const empty of [{}, null, [], { unrelated: true }, { theme: "nope" }, { reading: "1" }]) expect(plan(local, empty)).toEqual({ apply: local, push: true });
});

test("plan: the server wins for theme and language, favorites are the union (server order first)", () => {
  const r = plan(local, { theme: "light", lang: "system", reading: false, comfort: true, favs: ["b", "c"] });
  expect(r.apply).toEqual({ theme: "light", lang: "system", reading: false, comfort: true, favs: ["b", "c", "a"] });
  expect(r.push).toBe(true); // the local favorite "a" is not on the server yet
});

test("plan: nothing to send when the server already holds everything", () => {
  expect(plan(local, { theme: "dark", lang: "fr", reading: true, comfort: false, favs: ["b", "a", "z"] })).toEqual({ apply: { theme: "dark", lang: "fr", reading: true, comfort: false, favs: ["b", "a", "z"] }, push: false });
  expect(plan({ ...local, favs: [] }, { theme: "light", lang: "en", reading: false, comfort: false, favs: [] }).push).toBe(false);
  // the server wins for the reading options too
  expect(plan(local, { theme: "dark", lang: "fr", reading: false, comfort: true, favs: ["a", "b"] }).apply).toMatchObject({ reading: false, comfort: true });
});

test("plan: a partial server state is completed from the local one and sent back", () => {
  const r = plan(local, { theme: "light" });
  expect(r.apply).toEqual({ theme: "light", lang: "fr", reading: true, comfort: false, favs: ["a", "b"] });
  expect(r.push).toBe(true);
  // an account that predates the reading options: completed from this browser, sent back
  const old = plan(local, { theme: "dark", lang: "fr", favs: ["a", "b"] });
  expect(old.apply).toEqual(local);
  expect(old.push).toBe(true);
});

test("toBody: the whole object, keys of a newer front end kept, our keys replaced", () => {
  expect(toBody({ theme: "light", future: { x: 1 } }, local)).toEqual({ theme: "dark", lang: "fr", reading: true, comfort: false, favs: ["a", "b"], future: { x: 1 } });
  expect(toBody(null, local)).toEqual(local);
  expect(toBody([1], local)).toEqual(local);
});

test("stateKey: equal states give equal keys, any difference changes it", () => {
  expect(stateKey(local)).toBe(stateKey({ ...local, favs: [...local.favs] }));
  for (const other of [{ ...local, theme: "light" as const }, { ...local, lang: "en" as const }, { ...local, reading: false }, { ...local, comfort: true }, { ...local, favs: ["b", "a"] }]) expect(stateKey(other)).not.toBe(stateKey(local));
});

test("journeyQuery: the graph page reads back exactly the route that was saved", () => {
  const route = ["concepts/alpha", "concepts/beta", "weird,id%1"];
  const params = new URLSearchParams(journeyQuery(route));
  expect(params.get("view")).toBe("journey");
  const index = new Map(route.map((id) => [id, { cites: route, citedBy: route }])) as never;
  expect(parseRoute(params.get("route"), index)).toEqual(route);
});
