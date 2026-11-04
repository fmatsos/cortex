import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// REVIEW §4.3: `cortex index` must not depend on the machine's locale or time zone (REL-17). The generated
// catalog is spawned twice on one fixture under opposite LANG / LC_ALL / TZ and compared byte for byte.

const CLI = join(import.meta.dir, "cortex.ts");
const page = (type: string, title: string) => `---\ntype: ${type}\ntitle: ${title}\ndescription: Description de ${title}.\n---\nCorps.\n`;

/** Titles whose order differs between a French, a C and a numeric collation: accents, case, digits. */
const TITLES = ["Étude", "Zèbre", "écrit", "Eden", "Page 10", "Page 2", "page 1", "Œuvre", "Ångström", "Ça", "cèdre", "Zoé", "zoé"];

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  for (const [i, t] of TITLES.entries()) {
    await Bun.write(join(root, `wiki/${i % 2 ? "concepts" : "entities"}/p${String(i).padStart(2, "0")}.md`), page(i % 2 ? "Concept" : "Entity", t));
  }
  // entries around midnight: a time-zone conversion would move them to another day
  await Bun.write(join(root, "wiki/log.jsonl"), [
    { at: "2026-11-04T23:30:00+01:00", kind: "update", text: "Tard le soir." },
    { at: "2026-11-05T00:30:00+01:00", kind: "update", text: "Tôt le matin." },
  ].map((e) => JSON.stringify(e)).join("\n") + "\n");
  return root;
}

function index(root: string, env: Record<string, string>) {
  const e: Record<string, string | undefined> = { ...process.env, NO_COLOR: "1", CORTEX_ROOT: root, ...env };
  delete e.LC_ALL;
  Object.assign(e, env);
  const p = Bun.spawnSync(["bun", CLI, "index"], { env: e });
  expect([p.exitCode, p.stderr.toString()]).toEqual([0, ""]);
  return Promise.all(["index.md", "log.md"].map((f) => Bun.file(join(root, "wiki", f)).text()));
}

test("cortex index: wiki/index.md and wiki/log.md are byte-identical under different LANG and TZ", async () => {
  const root = await fixture();
  const [fr, frLog] = await index(root, { LANG: "fr_FR.UTF-8", LC_ALL: "fr_FR.UTF-8", TZ: "Europe/Paris" });
  const [c, cLog] = await index(root, { LANG: "C", LC_ALL: "C", TZ: "Pacific/Auckland" });
  const [us, usLog] = await index(root, { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", TZ: "America/Los_Angeles" });
  expect(fr).toContain("- [Étude]");
  expect(c).toBe(fr);
  expect(us).toBe(fr);
  expect(cLog).toBe(frLog);
  expect(usLog).toBe(frLog);
  expect(fr.match(/^- \[/gm)).toHaveLength(TITLES.length); // sanity: every page is listed
  expect(frLog).toContain("## 2026-11-05\n- **Update** Tôt le matin.\n"); // the entry's own date, not the reader's
});
