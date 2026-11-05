import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { add } from "./add";
import { rawPath } from "./lib";
import { UUID } from "./test-helpers";

test("cortex new: page named by UUID v7 by default, unique title, name lint, log named by title", async () => {
  const { newPage } = await import("./naming");
  const { lint } = await import("./lint");
  const { logAdd } = await import("./log");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  const p = await newPage(root, "concept", "Context rot");
  expect(p).toMatch(/^wiki\/concepts\/[0-9a-f-]{36}\.md$/);
  expect(UUID.test(p.slice(14, -3))).toBe(true);
  expect(await Bun.file(join(root, p)).text()).toBe("---\ntype: Concept\ntitle: Context rot\nstatus: draft\n---\n");
  await expect(newPage(root, "Entity", "context  ROT")).rejects.toThrow(p); // same title: the existing page is named
  await expect(newPage(root, "Note", "x")).rejects.toThrow("unknown type");
  expect((await newPage(root, "Synthesis", "Autre")).startsWith("wiki/syntheses/")).toBe(true);

  await Bun.write(join(root, "wiki/concepts/a-la-main.md"), "---\ntype: Concept\ntitle: Main\ndescription: D.\n---\nx\n");
  for (const d of ["2026/11/20261104-abcd-x", "2025/01/20261104-abcd-x"]) await Bun.write(join(root, `raw/${d}/source.md`), "---\ntype: RawSource\nnote: n\nstatus: compiled\n---\nx\n");
  const issues = (await lint(root)).map((i) => `${i.level} ${i.path} ${i.msg}`);
  expect(issues).toContain('warning wiki/concepts/a-la-main.md name outside the page_path template \"{type}/{uuid}\" (pages are created with cortex new)');
  expect(issues).toContain('warning raw/2026/11/20261104-abcd-x/source.md path outside the raw_path template \"{yyyy}/{mm}/{uuid}\" (sources are added with cortex add)');
  expect(issues.filter((i) => i.includes("duplicate raw id: 20261104-abcd-x"))).toHaveLength(1);
  expect(issues.some((i) => i.includes(p) && i.includes("template"))).toBe(false);

  // log.md names pages by their title, and does not repeat them when the text already names them
  await logAdd(root, "ingest", "Créé context-rot.", [], [p, "wiki/concepts/a-la-main.md"]);
  expect(await Bun.file(join(root, "wiki/log.md")).text()).toContain("- **Ingest** Créé context-rot. (pages: [Main](/wiki/concepts/a-la-main.md))\n");
});

test("configurable naming: validated templates, placeholders, subfolders, collisions", async () => {
  const { checkTemplate, expand, pattern } = await import("./template");
  const { newPage } = await import("./naming");
  const { lintConfig } = await import("./config");
  const { lint } = await import("./lint");
  const at = new Date("2026-11-04T09:05:07");
  // validation
  expect(checkTemplate("raw_path", "{yyyy}/{mm}/{uuid}")).toBeUndefined();
  expect(checkTemplate("page_path", "{type}/{yyyy}{mm}{dd}-{slug}")).toBeUndefined();
  expect(checkTemplate("raw_path", "{type}/{uuid}")).toContain("unknown placeholder {type}"); // {type}: pages only
  expect(checkTemplate("page_path", "{kind}/{uuid}")).toContain("unknown placeholder {kind}");
  expect(checkTemplate("page_path", "../{uuid}")).toContain("empty segments");
  expect(checkTemplate("page_path", "{type}//{uuid}")).toContain("empty segments");
  expect(checkTemplate("page_path", "{type}/a b{uuid}")).toContain("only letters");
  expect(checkTemplate("page_path", "{uuid}/page")).toContain("last segment");
  expect(lintConfig({ page_path: "{oops}" })[0].msg).toContain("unknown placeholder {oops}");
  expect(lintConfig({ raw_path: "{yyyy}/{rand}-{slug}", page_path: null })).toEqual([]);
  // values and patterns
  const v = { at, title: "Le C++26 refusé", type: "Concept" as const, kind: "pdf" };
  expect(expand("{type}/{yyyy}{mm}{dd}-{hh}{mi}{ss}-{slug}", v)).toBe("concepts/20261104-090507-le-c-26-refuse");
  expect(expand("{kind}/{rand}", v)).toMatch(/^pdf\/[a-z0-9]{4}$/);
  for (const t of ["{type}/{uuid}", "{yyyy}/{mm}/{dd}-{rand}-{slug}", "{type}/{yyyy}{mm}{dd}-{slug}"]) {
    expect(pattern(t).test(expand(t, v))).toBe(true);
    expect(pattern(t).test(`${expand(t, v)}-2`)).toBe(true); // collision suffix
    expect(pattern(t).test(`x/${expand(t, v)}`)).toBe(false);
  }

  // a wiki with timestamped naming, no folder per type
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ raw_path: "{yyyy}{mm}{dd}-{rand}-{slug}", page_path: "{yyyy}/{slug}" }));
  const note = join(root, "n.md");
  await Bun.write(note, "# Ma note\n\nUne idée.\n");
  const a = await add(root, note, { note: "n", now: at });
  expect(a.id).toMatch(/^20261104-[a-z0-9]{4}-ma-note$/);
  expect(rawPath(root, a.id)).toBe(`raw/${a.id}/source.md`);
  expect(await newPage(root, "Concept", "Context rot", at)).toBe("wiki/2026/context-rot.md");
  await Bun.write(join(root, "wiki/2026/context-rot.md"), "---\ntype: Concept\ntitle: Autre titre\n---\n"); // the name is taken, not the title
  expect(await newPage(root, "Entity", "Context  rot!", at)).toBe("wiki/2026/context-rot-2.md");
  const issues = (await lint(root)).filter((i) => i.msg.includes("template"));
  expect(issues).toEqual([]);
});

test("expand: a placeholder whose variable is not supplied is an error, never the text « undefined »", async () => {
  const { expand } = await import("./template");
  const at = new Date("2026-11-04T09:05:07");
  expect(() => expand("{kind}/{uuid}", { at, title: "x" })).toThrow("{kind}");
  expect(() => expand("{type}/{uuid}", { at, title: "x" })).toThrow("{type}");
  expect(expand("{yyyy}/{slug}", { at, title: "Un titre" })).toBe("2026/un-titre"); // the others need nothing more
});

test("free: the first untaken suffix, -2 then -3", async () => {
  const { free } = await import("./naming");
  expect(free("a/b", () => false)).toBe("a/b");
  expect(free("a/b", (p) => p === "a/b")).toBe("a/b-2");
  expect(free("a/b", (p) => ["a/b", "a/b-2"].includes(p))).toBe("a/b-3");
  expect(free("a/b", (p) => ["a/b", "a/b-3"].includes(p))).toBe("a/b-2"); // the first gap, not the highest
});
