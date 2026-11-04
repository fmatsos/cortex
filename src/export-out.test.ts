import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkOut } from "./export";

test("checkOut refuse un --out dans raw/, wiki/, inbox/ ou .git/, accepte .cortex/site et un dossier vide ailleurs", () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  for (const d of ["raw/site", "wiki/site", "inbox/x", ".git/x"]) expect(() => checkOut(root, join(root, d))).toThrow("refusé");
  expect(() => checkOut(root, join(root, ".cortex/site"))).not.toThrow();
  expect(() => checkOut(root, mkdtempSync(join(tmpdir(), "cortex-out-")))).not.toThrow();
});
