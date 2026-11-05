import { expect, test } from "bun:test";

test("search query: filters, quotes, exclusions, accents", async () => {
  const { parseQuery, matches, removeToken, canonType, isEmpty, chips, wantsFav } = await import("../site/src/lib/query");
  const p = parseQuery(`context  #Mémoire tag:LLM type:Synthèses status:draft is:fav "Phrase Exacte" -rot -#vieux -"à éviter" -type:source`);
  expect(p.words).toEqual(["context"]);
  expect(p.ops.map((o) => [o.key, o.value, o.neg])).toEqual([
    ["tag", "memoire", false], ["tag", "llm", false], ["type", "Synthesis", false], ["status", "draft", false], ["is", "fav", false],
    ["tag", "vieux", true], ["type", "Source", true],
  ]);
  expect(p.phrases.map((x) => x.text)).toEqual(["phrase exacte"]);
  expect(p.exclude.map((x) => x.text)).toEqual(["rot", "a eviter"]);
  expect(canonType("entités")).toBe("Entity");
  // unknown key = ordinary word; hyphen inside a word ≠ exclusion; empty query
  expect(parseQuery("foo:bar chain-of-thought").words).toEqual(["foo", "bar", "chain", "of", "thought"]);
  expect(parseQuery("chain-of-thought").exclude).toEqual([]);
  expect(isEmpty(parseQuery("  "))).toBe(true);
  // unclosed quote: blocks nothing
  expect(parseQuery('"jamais fermé').words).toEqual(["jamais", "ferme"]);
  // removal of a chip
  expect(removeToken("a #tag b", "#tag")).toBe("a b");
  // repeated filter: a single chip (unique key), which removes all its occurrences; removal by whole token
  const labels = (q: string) => chips(parseQuery(q)).map((c) => c.label);
  expect(labels("#llm #llm")).toEqual(["#llm"]);
  expect(labels("#llm tag:LLM")).toEqual(["#llm"]);
  expect(labels("-x -x type:source -type:source -#llm #llm")).toEqual(["type:Source", "without type:Source", "without #llm", "#llm", "without x"]);
  expect(labels('"a b" "a b"')).toEqual(["“a b”"]);
  expect(chips(parseQuery("#llm x #llm"))[0].raws).toEqual(["#llm", "#llm"]);
  expect(removeToken("#llm x #llm", "#llm")).toBe("x");
  expect(removeToken("#llm2 #llm", "#llm")).toBe("#llm2");
  expect(removeToken('a "b c" d', '"b c"')).toBe("a d");
  expect(removeToken("a -x.y b", "-x.y")).toBe("a b");
  expect(wantsFav(parseQuery("x is:fav"))).toBe(true);
  expect(wantsFav(parseQuery("-is:fav"))).toBe(false);

  const doc = { id: "concepts/a", title: "Mémoire vive", description: "RAM", type: "Concept", tags: ["Matériel", "ram"], status: "stable", verified: false, text: "La mémoire coûte cher en 2026." };
  const ok = (q: string, fav = false) => matches(doc, parseQuery(q), () => fav);
  expect(ok("#materiel type:concept status:stable")).toBe(true); // tag without accent, type in lowercase
  expect(ok("type:source")).toBe(false);
  expect(ok("-type:source -#absent")).toBe(true);
  expect(ok("-#ram")).toBe(false);
  expect(ok("is:unverified")).toBe(true);
  expect(ok("is:fav")).toBe(false);
  expect(ok("is:favoris", true)).toBe(true);
  expect(ok('"coute cher"')).toBe(true); // exact phrase, without accents
  expect(ok('"cher coute"')).toBe(false);
  expect(ok("-cher")).toBe(false);
  expect(ok("-prix")).toBe(true);
});
