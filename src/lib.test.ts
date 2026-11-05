import { expect, test } from "bun:test";
import { localIso, normUrl, setFmLine, slugify } from "./lib";

test("setFmLine: only the key's lines change, comments and the rest of the frontmatter stay byte for byte", () => {
  const page = "---\ntype: Concept\n# verified: { by: \"human:f\" }   ← to add after review\ntags:\n  - agents\n  - x\ntitle: 'A: b'\n---\nbody\n";
  const out = setFmLine(setFmLine(page, "tags", 'tags: ["agent","x"]'), "generated", 'generated: { by: "c/m", at: 2026-11-05T10:00:00+01:00 }');
  expect(out).toBe("---\ntype: Concept\n# verified: { by: \"human:f\" }   ← to add after review\ntags: [\"agent\",\"x\"]\ntitle: 'A: b'\ngenerated: { by: \"c/m\", at: 2026-11-05T10:00:00+01:00 }\n---\nbody\n");
  expect(setFmLine(out, "generated", "generated: { by: x }")).toContain("title: 'A: b'\ngenerated: { by: x }\n---");
  expect(setFmLine("no frontmatter\n", "tags", "tags: []")).toBe("no frontmatter\n");
});
import { ftsQuery } from "./search";
import { newId, UUID } from "./test-helpers";

test("utilities: local ISO date, v7 ids, slugify, normUrl, ftsQuery", () => {
  expect(localIso(new Date())).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
  const ids = Array.from({ length: 1000 }, () => newId(new Date("2026-11-04T10:00:00Z")));
  expect(ids.every((id) => UUID.test(id) && id[14] === "7")).toBe(true); // v7
  expect(new Set(ids).size).toBe(1000); // same millisecond: always distinct
  expect(newId(new Date("2026-01-01")) < newId(new Date("2026-11-04"))).toBe(true); // creation order
  expect(UUID.test("20261104-abcd-x")).toBe(false);
  expect(slugify("Le C++26 refusé à l'ISO : une première")).toBe("le-c-26-refuse-a-l-iso-une-premiere");
  expect(normUrl("https://X.com/a/?utm_source=z&hl=en#f")).toBe(normUrl("https://x.com/a?hl=en"));
  expect(ftsQuery(`l'IA "spec"`)).toBe(`"l'IA" """spec"""`);
});
