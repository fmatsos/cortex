import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changed, outOfScope } from "./agent";
import type { Message } from "./print";

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
  const msgs: Message[] = [];
  await changed(root, (m) => msgs.push(m));
  await changed(root, (m) => msgs.push(m));
  expect(msgs.filter((m) => m.level === "warn" && m.text.includes("pas de dépôt git : le périmètre de l'agent n'est pas vérifié"))).toHaveLength(1);
});

test("REL-30 : racine du wiki dans un sous-dossier d'un dépôt plus grand", async () => {
  const top = mkdtempSync(join(tmpdir(), "cortex-scope-sub-"));
  sh(top, "git", "init", "-q");
  const root = join(top, "brain");
  for (const f of ["brain/wiki/a.md", "brain/raw/y.md", "autre/z.md"]) put(top, f);
  sh(top, "git", "add", "-A");
  sh(top, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  const before = await changed(root);
  expect([...before.keys()]).toEqual([]);
  put(top, "autre/z.md", "modifié hors de la racine"); // elsewhere in the repository: not reported
  put(root, "wiki/b.md");
  put(root, "raw/x.md");
  expect([...(await changed(root)).keys()].sort()).toEqual(["raw/x.md", "wiki/b.md"]); // root-relative paths
  expect(await outOfScope(root, before)).toEqual(["raw/x.md"]);
});
