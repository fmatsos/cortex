import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("lint: blocking errors and warnings", async () => {
  const { lint } = await import("./lint");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "wiki/concepts/a.md"),
    "---\ntype: Concept\ntitle: A\ndescription: D.\ngenerated: { by: x, at: 2026-11-04T11:00:00+01:00 }\nverified: { by: y, at: 2026-11-04T10:00:00+01:00 }\n---\nVoir [B](/wiki/concepts/b.md). Fait.[^z]\n");
  await Bun.write(join(root, "raw/2026/01/019b76ff-c400-7000-8000-000000000001/source.md"), "---\ntype: RawSource\ntitle: X\nfetched_at: 2026-01-01T00:00:00+01:00\nnote: \"\"\nstatus: pending\n---\nx\n");
  const msgs = (await lint(root, new Date("2026-11-04T12:00:00+01:00"))).map((i) => `${i.level} ${i.msg}`);
  expect(msgs).toContain("error broken link: /wiki/concepts/b.md");
  expect(msgs).toContain("error footnote [^z] has no sources[] entry");
  expect(msgs.some((m) => m.startsWith("warning modified since review"))).toBe(true);
  expect(msgs).toContain("warning missing note: ask for it before compiling");
  expect(msgs).toContain("warning pending for more than 7 days");
});
