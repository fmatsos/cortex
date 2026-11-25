import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { OUTPUTS, ROOT, buildOutputs, loadTokens, staleOutputs, writeOutputs } from "../scripts/build-design";

const tokens = loadTokens();
const refs = (value: string) => [...value.matchAll(/\{(--[\w-]+)\}/g)].map((m) => m[1]);

test("the generator is deterministic and covers the four outputs", () => {
  const a = buildOutputs(tokens);
  expect(buildOutputs(loadTokens())).toEqual(a);
  expect(Object.keys(a).sort()).toEqual([...OUTPUTS].sort());
  for (const [path, content] of Object.entries(a)) {
    expect(content, path).toContain("do not edit");
    expect(content.endsWith("\n"), path).toBe(true);
  }
});

test("--check passes on the committed outputs", () => {
  expect(staleOutputs()).toEqual([]);
  const run = Bun.spawnSync(["bun", join(ROOT, "scripts/build-design.ts"), "--check"], { stdout: "pipe", stderr: "pipe" });
  expect(run.exitCode).toBe(0);
});

test("a stale or missing output is detected, and writing restores it", () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-design-"));
  mkdirSync(join(root, "design"));
  cpSync(join(ROOT, "design/tokens.json"), join(root, "design/tokens.json"));
  expect(staleOutputs(root)).toEqual([...OUTPUTS]); // nothing written yet
  writeOutputs(root);
  expect(staleOutputs(root)).toEqual([]);
  writeFileSync(join(root, "extension/generated/theme.js"), "// hand edit\n");
  expect(staleOutputs(root)).toEqual(["extension/generated/theme.js"]);
  const tokensPath = join(root, "design/tokens.json");
  writeFileSync(tokensPath, readFileSync(tokensPath, "utf8").replace('"#ffffff"', '"#fefefe"'));
  expect(staleOutputs(root)).toEqual(expect.arrayContaining(["site/src/lib/design/tokens.css", "extension/generated/cortex.css"]));
});

test("light and dark define the same tokens", () => {
  expect(Object.keys(tokens.dark).sort()).toEqual(Object.keys(tokens.light).sort());
  expect(Object.keys(tokens.light).length).toBeGreaterThan(30);
});

test("colors are sRGB hex (shadows are box-shadow lists), every reference resolves, no alias cycle", () => {
  for (const set of [tokens.light, tokens.dark, tokens.print]) {
    for (const [k, v] of Object.entries(set)) expect(v, k).toMatch(k.startsWith("--shadow-") ? /^0 \d+px \d+px rgb\([\d ]+ \/ [\d.]+\)(, 0 \d+px \d+px rgb\([\d ]+ \/ [\d.]+\))*$/ : /^#[0-9a-f]{6}$/i);
  }
  const all = { ...tokens.shared, ...tokens.light, ...tokens.aliases };
  for (const [k, v] of Object.entries(tokens.aliases)) {
    expect(refs(v).length, k).toBe(1);
    for (const r of refs(v)) {
      expect(r in tokens.light && r in tokens.dark, `${k} -> ${r}`).toBe(true);
      expect(r in tokens.aliases, `${k} must point at a themed token, not at another alias`).toBe(false);
    }
  }
  expect(Object.keys(all).length).toBe(Object.keys(tokens.shared).length + Object.keys(tokens.light).length + Object.keys(tokens.aliases).length); // no name defined twice
  for (const k of Object.keys(tokens.print)) expect(k in tokens.light, `print override ${k}`).toBe(true);
});

test("the extension and share outputs carry the same tokens as the site", () => {
  const out = buildOutputs(tokens);
  const names = Object.keys({ ...tokens.light, ...tokens.shared, ...tokens.aliases });
  for (const path of ["extension/generated/cortex.css", "extension/generated/theme.js", "scripts/generated/cortex-css.ts", "site/src/lib/design/tokens.css"] as const) {
    for (const n of names) expect(out[path], `${path} ${n}`).toContain(`${n}:`);
  }
  // classic script: no ESM syntax, Shadow DOM host selector, system dark only
  const theme = out["extension/generated/theme.js"];
  expect(theme).not.toMatch(/^\s*(export|import)\s/m);
  expect(theme).toContain(":host");
  expect(theme).toContain("prefers-color-scheme: dark");
  expect(theme).not.toContain("data-theme");
  const sandbox: { CORTEX_THEME_CSS?: string } = {};
  runInNewContext(theme, sandbox); // runs as a plain script and defines the global
  expect(sandbox.CORTEX_THEME_CSS).toStartWith(":host {");
  expect(out["extension/generated/cortex.css"]).not.toContain("data-theme");
  expect(out["scripts/generated/cortex-css.ts"]).toMatch(/^export const CORTEX_CSS = "/m);
});
