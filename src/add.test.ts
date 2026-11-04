import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { add } from "./add";
import { renderIndex } from "./catalog";
import { rawPath } from "./lib";
import { search } from "./search";
import { UUID } from "./test-helpers";

test("add → index → search, idempotent", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  await Bun.write(join(root, "wiki/log.jsonl"), '{"at":"2000-01-01","kind":"update","text":"ancien"}\n');
  await Bun.write(join(root, "wiki/concepts/x.md"), "---\ntype: Concept\ntitle: Relecture\ndescription: D.\n---\nCorps sur la relecture.\n");
  const note = join(root, "n.md");
  await Bun.write(note, "# Ma note\n\nUne idée sur l'hydroponie et la relecture.\n");

  const now = new Date("2026-11-04T10:00:00");
  const a = await add(root, note, { note: "test", now });
  expect(a.duplicate).toBe(false);
  expect((await add(root, note, { note: "test", now })).duplicate).toBe(true);
  const jsonl = (await Bun.file(join(root, "wiki/log.jsonl")).text()).trim().split("\n").map((l) => JSON.parse(l));
  expect(jsonl).toHaveLength(2); // the duplicate add writes nothing
  expect(UUID.test(a.id)).toBe(true);
  expect(rawPath(root, a.id)).toBe(`raw/2026/11/${a.id}/source.md`); // filed by month of addition
  expect(jsonl[1]).toMatchObject({ kind: "add", text: `\`${a.id}\`.`, sources: [a.id] });
  expect(jsonl[1].at).toMatch(/^2026-11-04T10:00:00[+-]\d\d:\d\d$/);
  const log = await Bun.file(join(root, "wiki/log.md")).text();
  expect(log).toContain(`## 2026-11-04\n- **Add** \`${a.id}\`.\n\n## 2000-01-01\n- **Update** ancien\n`); // without repeating the id already in the text

  expect(await renderIndex(root)).toContain("- [Relecture](/wiki/concepts/x.md) — D.");
  const hits = await search(root, "relecture");
  expect(hits.map((h) => h.area)).toEqual(["wiki", "raw"]); // wiki first
  expect((await search(root, "hydroponie", { in: "raw" }))[0].path).toContain(a.id);
});
