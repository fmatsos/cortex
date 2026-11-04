import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { add } from "./add";
import { renderIndex } from "./index";
import { localIso, normUrl, randomId4, slugify } from "./lib";
import { ftsQuery, search } from "./search";

test("utilitaires", () => {
  expect(localIso(new Date())).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
  for (let i = 0; i < 200; i++) expect(randomId4()).toMatch(/^[a-z0-9]{4}$/);
  expect(slugify("Le C++26 refusé à l'ISO : une première")).toBe("le-c-26-refuse-a-l-iso-une-premiere");
  expect(normUrl("https://X.com/a/?utm_source=z&hl=en#f")).toBe(normUrl("https://x.com/a?hl=en"));
  expect(ftsQuery(`l'IA "spec"`)).toBe(`"l'IA" """spec"""`);
});

test("add → index → search, idempotent", async () => {
  const root = mkdtempSync(join(tmpdir(), "brain-"));
  await Bun.write(join(root, "BRAIN.md"), "");
  await Bun.write(join(root, "wiki/log.md"), "# Log\n\n## 2000-01-01\n- ancien\n");
  await Bun.write(join(root, "wiki/concepts/x.md"), "---\ntype: Concept\ntitle: Relecture\ndescription: D.\n---\nCorps sur la relecture.\n");
  const note = join(root, "n.md");
  await Bun.write(note, "# Ma note\n\nUne idée sur l'hydroponie et la relecture.\n");

  const now = new Date("2026-11-04T10:00:00");
  const a = await add(root, note, { note: "test", now });
  expect(a.duplicate).toBe(false);
  expect((await add(root, note, { note: "test", now })).duplicate).toBe(true);
  const log = await Bun.file(join(root, "wiki/log.md")).text();
  expect(log).toStartWith(`# Log\n\n## 2026-11-04\n- **Add** \`${a.id}\``);

  expect(await renderIndex(root)).toContain("- [Relecture](/wiki/concepts/x.md) — D.");
  const hits = await search(root, "relecture");
  expect(hits.map((h) => h.area)).toEqual(["wiki", "raw"]); // wiki d'abord
  expect((await search(root, "hydroponie", { in: "raw" }))[0].path).toContain(a.id);
});
