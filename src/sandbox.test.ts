import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("bubblewrap confinement: only wiki/ is writable", async () => {
  const { confine } = await import("./backends/sandbox");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "wiki/.keep"), "");
  await Bun.write(join(root, "raw/.keep"), "");
  const sh = (mode: "read" | "write", f: string) =>
    Bun.spawnSync(confine(root, ["sh", "-c", `touch ${join(root, f)}`], mode), { stderr: "pipe" }).exitCode;
  expect(sh("write", "wiki/ok.md")).toBe(0);
  expect(sh("write", "raw/non.md")).not.toBe(0);
  expect(sh("write", "cortex.json")).not.toBe(0);
  expect(sh("read", "wiki/non.md")).not.toBe(0);
});
