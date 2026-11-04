import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changed, outOfScope } from "./agent";

const sh = (cwd: string, ...a: string[]) => Bun.spawnSync(a, { cwd, stderr: "pipe" });
const put = (root: string, p: string, c = "x") => { mkdirSync(join(root, p, ".."), { recursive: true }); writeFileSync(join(root, p), c); };

function repo() {
  const root = mkdtempSync(join(tmpdir(), "cortex-scope-"));
  sh(root, "git", "init", "-q");
  for (const f of ["wiki/concepts/a.md", "wiki/concepts/b.md", "raw/y.md", "cortex.json"]) put(root, f);
  sh(root, "git", "add", "-A");
  sh(root, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  return root;
}

test("T1 : périmètre de l'agent — chemins non ASCII, renommage, suppression", async () => {
  const root = repo();
  const before = await changed(root);
  put(root, "wiki/concepts/étude.md");
  renameSync(join(root, "wiki/concepts/a.md"), join(root, "wiki/concepts/c.md"));
  sh(root, "git", "add", "-A"); // staged rename: porcelain R form
  rmSync(join(root, "wiki/concepts/b.md"));
  expect(await outOfScope(root, before)).toEqual([]);
  put(root, "raw/x.md");
  writeFileSync(join(root, "cortex.json"), "{}");
  expect((await outOfScope(root, before)).sort()).toEqual(["cortex.json", "raw/x.md"]);
  // a rename out of wiki/ is reported through both its paths
  renameSync(join(root, "raw/y.md"), join(root, "raw/z.md"));
  sh(root, "git", "add", "-A");
  expect((await outOfScope(root, before)).sort()).toEqual(["cortex.json", "raw/x.md", "raw/y.md", "raw/z.md"]);
});

test("REL-13 : hors dépôt git, un avertissement est émis une seule fois", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-nogit-"));
  const lines: string[] = [], orig = console.error;
  console.error = (...a: unknown[]) => { lines.push(a.join(" ")); };
  try { await changed(root); await changed(root); } finally { console.error = orig; }
  expect(lines.filter((l) => l.includes("pas de dépôt git : le périmètre de l'agent n'est pas vérifié"))).toHaveLength(1);
});
