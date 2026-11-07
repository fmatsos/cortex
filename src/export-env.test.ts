import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportSite } from "./export";

// exportSite must leave no process-global trace: environment, working directory, console.
test("export : ni CORTEX_SITE_* dans l'environnement, ni chdir, ni console.log patché", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-env-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  await Bun.write(join(root, "wiki/concepts/a.md"), "---\ntype: Concept\ntitle: Alpha\ndescription: Description.\ntags: [alpha]\nstatus: stable\n---\nUn texte.\n");
  const siteKeys = () => Object.keys(process.env).filter((k) => k.startsWith("CORTEX_SITE")).sort();
  const before = { env: siteKeys(), cwd: process.cwd(), log: console.log };
  await exportSite(root, join(root, ".cortex/site"), () => {});
  expect(siteKeys()).toEqual(before.env);
  expect(process.cwd()).toBe(before.cwd);
  expect(console.log).toBe(before.log);
}, 120_000);
