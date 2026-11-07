import { expect, test } from "bun:test";
import { cleanUrl, localIso, normUrl, setFmLine, slugify } from "./lib";

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

test("cleanUrl: tracking parameters out, the others and the fragment kept", () => {
  expect(cleanUrl("https://x.com/a?utm_source=li&lmd_x=1&fbclid=z&id=42#f")).toBe("https://x.com/a?id=42#f");
  expect(cleanUrl("https://x.com/a?utm_medium=m&trackingId=t&trk=u")).toBe("https://x.com/a");
  expect(cleanUrl("https://x.com/a?trk=u#frag")).toBe("https://x.com/a#frag");
  expect(cleanUrl("https://x.com/a?ref=nl&source=s&q=a%20b")).toBe("https://x.com/a?ref=nl&source=s&q=a%20b");
  expect(cleanUrl("https://x.com/a?mc_cid=1&mc_eid=2&igshid=3&gclid=4&ref_src=5")).toBe("https://x.com/a");
  expect(cleanUrl("https://x.com/a")).toBe("https://x.com/a");
  expect(normUrl("https://x.com/a?lmd_x=1&id=1")).toBe(normUrl("https://x.com/a?id=1"));
});
