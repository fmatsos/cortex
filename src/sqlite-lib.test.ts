import { expect, test } from "bun:test";
import { applySqlite, HOMEBREW_SQLITE, pickSqlite } from "./sqlite-lib";

const [arm, intel] = HOMEBREW_SQLITE;
const files = (...present: string[]) => (p: string) => present.includes(p);

test("which SQLite library: the variable first, then Homebrew's on macOS only, `system` forces the system's", () => {
  expect(pickSqlite({ CORTEX_SQLITE_LIB: "/opt/lib/libsqlite3.dylib" }, "darwin", files(arm))).toEqual({ path: "/opt/lib/libsqlite3.dylib", source: "env" });
  expect(pickSqlite({ CORTEX_SQLITE_LIB: " /x/libsqlite3.so " }, "linux", files())).toEqual({ path: "/x/libsqlite3.so", source: "env" }); // respected on Linux too
  expect(pickSqlite({}, "darwin", files(arm, intel))).toEqual({ path: arm, source: "homebrew" }); // Apple Silicon's before Intel's
  expect(pickSqlite({}, "darwin", files(intel))).toEqual({ path: intel, source: "homebrew" });
  expect(pickSqlite({}, "darwin", files())).toEqual({ source: "system" }); // no Homebrew SQLite: the system's
  expect(pickSqlite({ CORTEX_SQLITE_LIB: "system" }, "darwin", files(arm))).toEqual({ source: "system" }); // detection off
  expect(pickSqlite({}, "linux", files(arm))).toEqual({ source: "system" }); // nothing changes on Linux
  expect(pickSqlite({ CORTEX_SQLITE_LIB: "" }, "linux", files())).toEqual({ source: "system" });
});

test("a library that is missing or refused: one warning, the system's SQLite stays, never a throw", () => {
  const err = console.error; const lines: string[] = [];
  console.error = (...a: unknown[]) => { lines.push(a.join(" ")); };
  try {
    expect(applySqlite({ path: "/nope/libsqlite3.dylib", source: "env" }, files(), () => { throw new Error("must not be called"); })).toEqual({ source: "env", error: "file not found" });
    expect(applySqlite({ path: arm, source: "homebrew" }, files(arm), () => { throw new Error("wrong architecture"); })).toEqual({ source: "homebrew", error: "wrong architecture" });
    expect(applySqlite({ source: "system" })).toEqual({ source: "system" }); // nothing to do, nothing said
  } finally { console.error = err; }
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain("/nope/libsqlite3.dylib: file not found");
  const used: string[] = [];
  expect(applySqlite({ path: arm, source: "homebrew" }, files(arm), (p) => used.push(p), "darwin")).toEqual({ path: arm, source: "homebrew" });
  expect(used).toEqual([arm]);
  // elsewhere Bun ignores the call (checked on Linux): the state says so instead of naming a library that is not in use
  expect(applySqlite({ path: "/x/libsqlite3.so", source: "env" }, files("/x/libsqlite3.so"), () => {}, "linux")).toEqual({ source: "env", ignored: true });
});

test("cortex with CORTEX_SQLITE_LIB on a missing file: warns once and runs on its own SQLite, search included", async () => {
  const root = (await import("node:fs")).mkdtempSync(`${(await import("node:os")).tmpdir()}/cortex-sqlite-`);
  await Bun.write(`${root}/cortex.json`, "{}");
  await Bun.write(`${root}/wiki/concepts/a.md`, "---\ntype: Concept\ntitle: Alpha\ndescription: D.\n---\nUn texte.\n");
  const run = async (...args: string[]) => {
    const p = Bun.spawn([process.execPath, `${import.meta.dir}/cortex.ts`, ...args], { env: { ...process.env, CORTEX_ROOT: root, CORTEX_SQLITE_LIB: "/nowhere/libsqlite3.dylib" }, stdout: "pipe", stderr: "pipe" });
    return { code: await p.exited, out: await new Response(p.stdout).text(), err: await new Response(p.stderr).text() };
  };
  const s = await run("search", "alpha");
  expect(s.code).toBe(0);
  expect(s.out).toContain("Alpha");
  expect(s.err.match(/SQLite library \/nowhere\/libsqlite3\.dylib: file not found/g)).toHaveLength(1);
  const d = await run("doctor");
  expect(d.out).toContain("sqlite-vec"); // reported, loaded or not
  (await import("node:fs")).rmSync(root, { recursive: true, force: true });
});
