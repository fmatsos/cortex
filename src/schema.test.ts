import { expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("schema: built-in file, written to CLAUDE.md or AGENTS.md at init, language and override from cortex.json", async () => {
  const { configCmd } = await import("./config-cmd");
  const { agentFile } = await import("./config");
  const { schemaText, writeSchema } = await import("./schema");
  for (const [client, file] of [[undefined, "CLAUDE.md"], ["claude", "CLAUDE.md"], ["codex", "AGENTS.md"], ["opencode", "AGENTS.md"]] as const) {
    const root = mkdtempSync(join(tmpdir(), "cortex-"));
    expect((await configCmd(root, ["init", ...(client ? [client] : [])])).ok).toBe(true);
    expect(agentFile(client)).toBe(file);
    const txt = await Bun.file(join(root, file)).text();
    expect(txt).toContain("## INGEST workflow");
    expect(txt).toContain("Wiki language: **English**");
    expect(existsSync(join(root, file === "CLAUDE.md" ? "AGENTS.md" : "CLAUDE.md"))).toBe(false);
  }
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "CLAUDE.md"), "mine");
  await configCmd(root, ["init"]);
  expect(await Bun.file(join(root, "CLAUDE.md")).text()).toBe("mine"); // an existing file is kept…
  await configCmd(root, ["set", "language", "French"]);
  await writeSchema(root, true); // …until cortex schema --write
  expect(await Bun.file(join(root, "CLAUDE.md")).text()).toContain("Wiki language: **French**");
  await Bun.write(join(root, "my-schema.md"), "Custom, in {{language}}.\n");
  await configCmd(root, ["set", "schema", "my-schema.md"]);
  expect(await schemaText(root)).toBe("Custom, in French.\n");
  await configCmd(root, ["set", "schema", "missing.md"]);
  await expect(schemaText(root)).rejects.toThrow("schema not found");
});
