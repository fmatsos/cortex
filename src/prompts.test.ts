import { expect, test } from "bun:test";
import { askPrompt, compilePrompt, mcpInstructions, prompt, scopePrefix } from "./prompts";
import { buildServer } from "./mcp";

const compile = (language?: string, batch = false) =>
  scopePrefix("/r", true, language) + compilePrompt({ agentFile: "CLAUDE.md", source: "/raw/x/source.md", batch, language });
const ask = (language?: string, file = false) =>
  scopePrefix("/r", file, language) + askPrompt({ agentFile: "CLAUDE.md", question: "Q ?", file, language });

test("the prompts follow the wiki language, and no French is left", () => {
  for (const p of [compile("English"), compile("English", true), ask("English"), ask("English", true)]) {
    expect(p).toContain("in English");
    expect(p).not.toMatch(/Racine du cerveau|Applique le workflow|Lecture seule|Tu n'écris/);
    expect(p).not.toContain("{{");
  }
  expect(compile("Japanese")).toContain("in Japanese");
});

test("default language: the same as the schema's (English)", () => {
  expect(compile()).toContain("in English");
  expect(ask()).toContain("in English");
  expect(mcpInstructions()).toContain("wiki in English");
});

test("same constraints as before: scope, workflows, batch vs interactive", () => {
  expect(scopePrefix("/r", true)).toContain("You only write under /r/wiki/.");
  expect(scopePrefix("/r", false)).toContain("Read-only.");
  expect(scopePrefix("/r", false)).not.toContain("You only write");
  expect(compile()).toContain("INGEST workflow of CLAUDE.md to the source /raw/x/source.md");
  expect(compile()).toContain("Do not touch the status of the raw source");
  expect(compile()).not.toContain("Non-interactive");
  expect(compile("English", true)).toContain("status: draft");
  expect(ask()).toContain("QUERY workflow of CLAUDE.md to the question: « Q ? »");
  expect(ask()).toContain("Do not modify any file");
  expect(ask("English", true)).toContain("cortex new Synthesis");
  expect(ask("English", true)).not.toContain("Do not modify any file");
});

test("placeholders are filled in one pass and an unknown prompt fails", () => {
  expect(askPrompt({ agentFile: "A.md", question: "{{language}} {{root}}", language: "French" })).toContain("« {{language}} {{root}} »");
  expect(() => prompt("nope", {})).toThrow("prompt introuvable");
});

test("MCP instructions are derived from language", () => {
  expect(mcpInstructions("French")).toContain("wiki in French");
  expect(mcpInstructions("French")).not.toContain("français");
  expect(mcpInstructions("English")).toContain("wiki in English");
  expect(() => buildServer("/nonexistent", "French")).not.toThrow();
});
