import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
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

test("schemaText: the space's schema, else the global one, else the built-in one for the content of the space (resources, notes, both)", async () => {
  const { schemaText } = await import("./schema");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  const write = (c: object) => Bun.write(join(root, "cortex.json"), JSON.stringify(c));
  for (const n of ["pro", "perso", "veille", "mix"]) mkdirSync(join(root, "spaces", n, "wiki"), { recursive: true });
  await Bun.write(join(root, "global.md"), "Global in {{language}}.\n");
  await Bun.write(join(root, "schemas/perso.md"), "Perso in {{language}}.\n");
  await write({ language: "French", schema: "global.md", spaces: { pro: { content: ["notes"] }, perso: { schema: "schemas/perso.md", content: ["notes"] }, mix: { content: ["resources", "notes"], schema: "schemas/perso.md" } } });
  const text = (n: string) => schemaText(join(root, "spaces", n));
  expect(await text("perso")).toBe("Perso in French.\n"); // a path, relative to the instance root, overrides the content
  expect(await text("mix")).toBe("Perso in French.\n");
  expect(await text("pro")).toBe("Global in French.\n"); // a global schema overrides the content too
  expect(await text("veille")).toBe("Global in French.\n");
  expect(await schemaText(root)).toBe("Global in French.\n"); // the instance root itself (legacy)
  await write({ language: "French", spaces: { pro: { content: ["notes"] }, mix: { content: ["notes", "resources"] }, veille: { content: ["resources"] } } });
  const [pro, mix, veille, perso] = [await text("pro"), await text("mix"), await text("veille"), await text("perso")];
  expect(pro).toContain("a space of personal notes");
  expect(pro).toContain("Wiki language: **French**");
  expect(pro).toContain("The notes are the human's words");
  expect(veille).toContain("the second brain");
  expect(veille).not.toContain("From notes to pages");
  expect(perso).toBe(veille); // no content: resources
  expect(mix.startsWith(veille.trimEnd())).toBe(true); // the default schema, then what notes add
  expect(mix).toContain("## Notes in this space");
  expect(mix).toContain("## From notes to pages");
  expect(mix).toContain("- **The notes are the human's words.**");
  expect(mix).not.toContain("a space of personal notes"); // not the notes schema's own title and intro
  expect(pro).toContain("## From notes to pages"); // the spliced part is the notes schema's own text
  for (const t of [pro, mix, veille]) expect(t).not.toContain("notes:begin");
  for (const t of [pro, mix, veille]) expect(t).not.toContain("{{language}}");
  await write({ spaces: { perso: { schema: "absent.md" } } });
  await expect(text("perso")).rejects.toThrow("schema not found: absent.md");
  const notes = await Bun.file(join(import.meta.dir, "schema-notes.md")).text();
  expect(notes).not.toMatch(/\p{Extended_Pictographic}/u);
  expect(notes).toContain("{{language}}");
  expect(notes).toContain("No emojis");
});
