import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lint } from "./lint";
import { parseDoc } from "./lib";

test("normal LF file: output pinned", () => {
  const d = parseDoc("p.md", "---\ntype: Concept\ntitle: A\ntags: [x, y]\n---\nCorps\n\nSuite\n");
  expect(d).toEqual({ path: "p.md", fm: { type: "Concept", title: "A", tags: ["x", "y"] }, body: "Corps\n\nSuite\n" });
});

test("CRLF file is parsed", () => {
  const d = parseDoc("p.md", "---\r\ntype: Concept\r\ntitle: A\r\n---\r\nCorps\r\n");
  expect(d.fm).toEqual({ type: "Concept", title: "A" });
  expect(d.body).toBe("Corps\r\n");
});

test("BOM file is parsed", () => {
  const d = parseDoc("p.md", "﻿---\ntype: Concept\n---\nCorps\n");
  expect(d.fm).toEqual({ type: "Concept" });
  expect(d.body).toBe("Corps\n");
});

test("empty frontmatter gives {}", () => {
  expect(parseDoc("p.md", "---\n---\nCorps\n")).toEqual({ path: "p.md", fm: {}, body: "Corps\n" });
  expect(parseDoc("p.md", "---\n\n---\nCorps\n").fm).toEqual({});
});

test("scalar frontmatter throws", () => {
  expect(() => parseDoc("p.md", "---\njust a string\n---\nCorps\n")).toThrow("frontmatter invalide");
});

test("array frontmatter throws", () => {
  expect(() => parseDoc("p.md", "---\n- a\n- b\n---\nCorps\n")).toThrow("frontmatter invalide");
});

test("--- inside a quoted string does not end the frontmatter", () => {
  const d = parseDoc("p.md", '---\ntitle: "a --- b"\ntype: Concept\n---\nCorps\n');
  expect(d.fm).toEqual({ title: "a --- b", type: "Concept" });
  expect(d.body).toBe("Corps\n");
});

test("body starting with --- (horizontal rule) is kept", () => {
  const d = parseDoc("p.md", "---\ntype: Concept\n---\n---\nSuite\n");
  expect(d.fm).toEqual({ type: "Concept" });
  expect(d.body).toBe("---\nSuite\n");
});

test("lint reports a scalar frontmatter as an invalid-frontmatter error", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-doc-"));
  writeFileSync(join(root, "cortex.json"), "{}");
  mkdirSync(join(root, "wiki/concepts"), { recursive: true });
  writeFileSync(join(root, "wiki/concepts/bad.md"), "---\njust a string\n---\nCorps\n");
  const issues = await lint(root);
  const e = issues.find((i) => i.path === "wiki/concepts/bad.md");
  expect(e?.level).toBe("error");
  expect(e?.msg).toContain("frontmatter invalide");
});
