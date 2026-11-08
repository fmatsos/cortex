import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { override, withOverride } from "./config";

test("cortex.json: absent = agnostic, unknown client = error", async () => {
  const { loadConfig } = await import("./config");
  const { backendFor } = await import("./backends/index");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  expect(await loadConfig(root)).toEqual({});
  await Bun.write(join(root, "cortex.json"), '{"client":"gpt"}');
  expect(loadConfig(root)).rejects.toThrow("unknown client");
  await Bun.write(join(root, "cortex.json"), '{"client":"opencode"}');
  expect((await backendFor(root)).interactive("p")).toEqual(["opencode", "--model", "opencode/big-pickle", "--prompt", "p"]);
  // effort: translated into each CLI's vocabulary
  const it = async (cfg: object) => { await Bun.write(join(root, "cortex.json"), JSON.stringify(cfg)); return (await backendFor(root)).interactive("p"); };
  expect(await it({ client: "opencode", effort: "high" })).toEqual(["opencode", "--model", "opencode/big-pickle#high", "--prompt", "p"]);
  expect(await it({ client: "claude", model: "opus", effort: "max" })).toEqual(["claude", "--model", "opus", "--effort", "max", "p"]);
  expect(await it({ client: "codex", effort: "low" })).toEqual(["codex", "-c", 'model_reasoning_effort="low"', "p"]);
  await Bun.write(join(root, "cortex.json"), "{}");
  expect((await backendFor(root)).interactive("p")).toEqual(["claude", "p"]);
});

test("cortex config: init, set, get, remove, lint", async () => {
  const { configCmd } = await import("./config-cmd");
  const { lintConfig, loadConfig } = await import("./config");
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  expect((await configCmd(root, ["init"])).ok).toBe(true);
  expect(await loadConfig(root)).toEqual({}); // all-null skeleton: agnostic
  expect(configCmd(root, ["init"])).rejects.toThrow("already exists");
  await configCmd(root, ["set", "client", "codex"]);
  await configCmd(root, ["set", "effort", "low"]);
  expect(configCmd(root, ["set", "effort", "turbo"])).rejects.toThrow("for codex");
  expect(configCmd(root, ["set", "couleur", "x"])).rejects.toThrow("Expected a property");
  expect(await loadConfig(root)).toEqual({ client: "codex", effort: "low" });
  await configCmd(root, ["remove", "effort"]);
  expect(await loadConfig(root)).toEqual({ client: "codex" });
  await Bun.write(join(root, "cortex.json"), "{ pas du json");
  expect((await configCmd(root, ["lint"])).ok).toBe(false);
  expect(lintConfig({ client: "opencode", effort: "n'importe" })).toEqual([]); // model-specific variant
  expect(lintConfig({ effort: "high" })[0].level).toBe("warning");
  expect(lintConfig([])[0].level).toBe("error");
  await Bun.write(join(root, "cortex.json"), "{}");
  await configCmd(root, ["set", "max_tags", "6"]); // a CLI string, read as a number
  expect(await loadConfig(root)).toEqual({ max_tags: 6 });
  expect(configCmd(root, ["set", "max_tags", "0"])).rejects.toThrow("max_tags");
  expect(lintConfig({ max_tags: 2.5 })[0].level).toBe("error");
  expect(lintConfig({ fetch_timeout: 0 })[0].level).toBe("error");
  expect(lintConfig({ fetch_timeout: 7.5 })).toEqual([]);
  expect(lintConfig({ parser: { social: { linkedin: { card: "a.card" } } } })).toEqual([]);
  expect(lintConfig({ parser: { social: { linkedin: { bogus: "x" } } } })[0].level).toBe("error");
  expect(lintConfig({ parser: { social: { linkedin: "a.card" } } })[0].level).toBe("error");
  expect(lintConfig({ linkedin: { card: "a.card" } })[0].level).toBe("error"); // not at the root
  expect(lintConfig({ parser: { social: { external_link: { limit: 0 }, x: { external_link: { limit: 2 } }, linkedin: { card: "a", external_link: { limit: 1 } } } } })).toEqual([]);
  expect(lintConfig({ parser: { social: { external_link: { limit: -1 } } } })[0].level).toBe("error");
  expect(lintConfig({ parser: { social: { tiktok: { external_link: { limit: 1 } } } } })[0].level).toBe("error");
  expect(lintConfig({ external_link: { limit: 0 } })[0].level).toBe("error"); // not at the root
});

test("--model/--effort override cortex.json; a bare model keeps the opencode provider", () => {
  Object.assign(override, { model: "qwen-3.5", effort: "high" });
  try {
    expect(withOverride({ client: "opencode", model: "openai/gpt-x" })).toEqual({ client: "opencode", model: "openai/qwen-3.5", effort: "high" });
    expect(withOverride({ client: "claude" })).toEqual({ client: "claude", model: "qwen-3.5", effort: "high" });
  } finally { Object.assign(override, { model: undefined, effort: undefined }); }
});
