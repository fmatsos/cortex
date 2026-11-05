import { expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("journal entry: parse and serialize, empty fields omitted, invalid entries refused", async () => {
  const { parseEntry, readLog } = await import("./log");
  const ok: any = { at: "2026-11-04T10:00:00+01:00", kind: "ingest", text: "Fait.", sources: ["01a1a5c9-5e80-7075-ae13-aab03b0a8697"], pages: ["wiki/concepts/a.md"] };
  expect(parseEntry(ok)).toEqual(ok);
  expect(parseEntry({ at: "2026-11-04", kind: "lint", text: "0 erreur" })).toEqual({ at: "2026-11-04", kind: "lint", text: "0 erreur" });
  for (const bad of [null, [], { ...ok, kind: "creation" }, { ...ok, at: "hier" }, { ...ok, at: "2026-13-45" }, { ...ok, at: "2026-11-04T10:00:00" }, { ...ok, text: "" }, { ...ok, text: "a\nb" },
    { ...ok, extra: 1 }, { ...ok, sources: [] }, { ...ok, sources: ["../x"] }, { ...ok, sources: ["a b"] }, { ...ok, pages: ["concepts/a.md"] }, { ...ok, pages: "wiki/a.md" }, { at: "2026-11-04", kind: "add" }])
    expect(typeof parseEntry(bad)).toBe("string");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "wiki/log.jsonl"), `${JSON.stringify(ok)}\n\nn'importe quoi\n{"at":"2026-11-04","kind":"zz","text":"x"}\n`);
  const r = readLog(root);
  expect(r.entries).toEqual([ok]);
  expect(r.errors).toEqual([{ line: 3, msg: "invalid JSON" }, { line: 4, msg: expect.stringContaining("kind") }]);
});

test("log.md: generated, deterministic, newest first, references not repeated", async () => {
  const { renderLogMd } = await import("./log");
  const entries: any[] = [
    { at: "2026-11-03", kind: "update", text: "Ancien." },
    { at: "2026-11-04T09:00:00+01:00", kind: "add", text: "`01a1a5c9-5e80-7075-ae13-aab03b0a8697`.", sources: ["01a1a5c9-5e80-7075-ae13-aab03b0a8697"] },
    { at: "2026-11-04T10:00:00+01:00", kind: "ingest", text: "Créé sources/x, concepts/{a, c}.", sources: ["01a1a5c9-5e80-7075-ae13-aab03b0a8697"], pages: ["wiki/sources/x.md", "wiki/concepts/a.md", "wiki/concepts/c.md", "wiki/entities/b.md"] },
  ];
  const md = renderLogMd([...entries]);
  expect(md).toBe(`# Log

> Generated from \`wiki/log.jsonl\`: do not edit by hand (\`cortex log add\`, then \`cortex index\`).

## 2026-11-04
- **Ingest** Créé sources/x, concepts/{a, c}. (sources: \`01a1a5c9-5e80-7075-ae13-aab03b0a8697\`; pages: [entities/b](/wiki/entities/b.md))
- **Add** \`01a1a5c9-5e80-7075-ae13-aab03b0a8697\`.

## 2026-11-03
- **Update** Ancien.
`);
  expect(renderLogMd([...entries])).toBe(md);
  expect(renderLogMd([])).toStartWith("# Log\n");
});

test("cortex log add: validates kind, pages and sources, writes one line, regenerates log.md; cortex log reads", async () => {
  const { logAdd, readLog } = await import("./log");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  await Bun.write(join(root, "cortex.json"), "{}");
  await Bun.write(join(root, "raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md"), "---\ntype: RawSource\n---\nx\n");
  await Bun.write(join(root, "wiki/concepts/a.md"), "---\ntype: Concept\n---\n");
  await Bun.write(join(root, "wiki/log.md"), "à écraser");
  await expect(logAdd(root, "creation", "x")).rejects.toThrow("unknown kind");
  await expect(logAdd(root, "update", "  ")).rejects.toThrow("empty text");
  await expect(logAdd(root, "update", "x", [], ["wiki/concepts/nope.md"])).rejects.toThrow("page not found");
  await expect(logAdd(root, "update", "x", [], ["wiki/../cortex.json"])).rejects.toThrow("page not found");
  await expect(logAdd(root, "update", "x", [], ["wiki/log.md"])).rejects.toThrow("page not found");
  await expect(logAdd(root, "update", "x", ["01a1a5c9-5e80-7075-ae13-000000000000"])).rejects.toThrow("raw source not found");
  await expect(logAdd(root, "update", "x", ["../../etc"])).rejects.toThrow("raw source not found");
  expect(existsSync(join(root, "wiki/log.jsonl"))).toBe(false); // no refusal writes
  const d = new Date("2026-11-04T10:00:00");
  const e = await logAdd(root, "ingest", "Ligne un\n  suite.", ["01a1a5c9-5e80-7075-ae13-aab03b0a8697", "01a1a5c9-5e80-7075-ae13-aab03b0a8697"], ["/wiki/concepts/a.md", "wiki/concepts/a.md"], d);
  expect(e).toMatchObject({ kind: "ingest", text: "Ligne un suite.", sources: ["01a1a5c9-5e80-7075-ae13-aab03b0a8697"], pages: ["wiki/concepts/a.md"] });
  await logAdd(root, "lint", "0 erreur.", [], [], new Date("2026-11-04T11:00:00"));
  const raw = await Bun.file(join(root, "wiki/log.jsonl")).text();
  expect(raw.split("\n")).toHaveLength(3); // two complete lines + newline
  expect(JSON.parse(raw.split("\n")[1])).not.toHaveProperty("sources"); // empty fields omitted
  expect(readLog(root).errors).toEqual([]);
  const md = await Bun.file(join(root, "wiki/log.md")).text();
  expect(md).toContain("## 2026-11-04\n- **Lint** 0 erreur.\n- **Ingest** Ligne un suite. (sources: `01a1a5c9-5e80-7075-ae13-aab03b0a8697`; pages: [concepts/a](/wiki/concepts/a.md))\n");
  // file edited without a trailing newline: the next entry does not stick to the previous one
  await Bun.write(join(root, "wiki/log.jsonl"), raw.trimEnd());
  await logAdd(root, "update", "suite", [], [], d);
  expect(readLog(root).errors).toEqual([]);
  expect(readLog(root).entries).toHaveLength(3);

  // CLI
  const run = (...a: string[]) => Bun.spawnSync(["bun", join(import.meta.dir, "cortex.ts"), ...a], { env: { ...process.env, CORTEX_ROOT: root } });
  expect(run("log", "add", "update", "via la CLI ; | >", "--source", "01a1a5c9-5e80-7075-ae13-aab03b0a8697", "--page", "wiki/concepts/a.md").exitCode).toBe(0);
  expect(run("log", "add", "update", "x", "--page", "wiki/concepts/nope.md").exitCode).toBe(1);
  expect(run("log", "add", "update").exitCode).toBe(2); // usage error
  // `add` is the subcommand only right after `log`: the (read-only) agent guards rely on this order
  const count = () => readLog(root).entries.length, before = count();
  for (const a of [["log", "--json", "add", "update", "x"], ["log", "--", "add", "update", "x"], ["log", "--kind", "lint", "add", "update", "x"]]) {
    expect(run(...a).exitCode).toBe(2); // usage error
    expect(count()).toBe(before);
  }
  const j = JSON.parse(run("log", "--json", "--limit", "2").stdout.toString());
  expect(j.map((x: any) => x.text)).toEqual(["via la CLI ; | >", "suite"]);
  expect(JSON.parse(run("log", "--json", "--kind", "lint").stdout.toString()).map((x: any) => x.text)).toEqual(["0 erreur."]);
  expect(run("log", "--kind", "zz").exitCode).toBe(2); // usage error
  await Bun.write(join(root, "wiki/log.md"), "édité");
  expect(run("index").exitCode).toBe(0);
  expect(await Bun.file(join(root, "wiki/log.md")).text()).toContain("via la CLI ; | >"); // cortex index also regenerates log.md
});

test("journal lint: invalid line = error, hand-edited log.md = warning", async () => {
  const { lint } = await import("./lint");
  const { writeLogMd } = await import("./log");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  const msgs = async () => (await lint(root)).map((i) => `${i.level} ${i.path} ${i.msg}`);
  expect(await msgs()).toEqual([]); // no journal: nothing to say
  await Bun.write(join(root, "wiki/log.jsonl"), '{"at":"2026-11-04","kind":"add","text":"x"}\n');
  expect(await msgs()).toEqual([expect.stringContaining("warning wiki/log.md differs")]); // never generated
  await writeLogMd(root);
  expect(await msgs()).toEqual([]);
  await Bun.write(join(root, "wiki/log.md"), (await Bun.file(join(root, "wiki/log.md")).text()) + "- à la main\n");
  expect(await msgs()).toEqual([expect.stringContaining("warning wiki/log.md differs")]);
  await writeLogMd(root);
  await Bun.write(join(root, "wiki/log.jsonl"), '{"at":"2026-11-04","kind":"add","text":"x"}\n{pas du json\n{"at":"2026-11-04","kind":"zz","text":"x"}\n');
  const m = await msgs();
  expect(m).toContain("error wiki/log.jsonl:2 invalid JSON");
  expect(m.some((x) => x.startsWith("error wiki/log.jsonl:3 kind"))).toBe(true);
});
