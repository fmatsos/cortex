import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import agnostic from "./backends/default";

// `run` of the agnostic backend with a fake $CORTEX_AGENT_BATCH (never a real agent). The argv of `claude -p`
// and the --allowedTools lists are pinned in policy.test.ts; the compile/ask exit codes in cli-commands.test.ts.

const batch0 = process.env.CORTEX_AGENT_BATCH;
afterEach(() => { if (batch0 === undefined) delete process.env.CORTEX_AGENT_BATCH; else process.env.CORTEX_AGENT_BATCH = batch0; });

const root = () => {
  const r = mkdtempSync(join(tmpdir(), "cortex-"));
  mkdirSync(join(r, "wiki"));
  return r;
};
const confined = process.platform !== "linux" || !!Bun.which("bwrap"); // the backend confines the agent: bubblewrap is required on Linux

test.skipIf(!confined)("default backend: the prompt reaches the agent on standard input, its output comes back trimmed", async () => {
  process.env.CORTEX_AGENT_BATCH = "sh -c cat"; // echoes the prompt
  expect(await agnostic().run(root(), "bonjour l'agent\n\n", "read")).toBe("bonjour l'agent");
});

test.skipIf(!confined)("default backend: a non-zero exit throws, naming the command", async () => {
  process.env.CORTEX_AGENT_BATCH = "false";
  await expect(agnostic().run(root(), "x", "read")).rejects.toThrow("false sorti en erreur");
});

test("default backend: without bwrap in the PATH, a clear message and the agent never runs", () => {
  if (process.platform !== "linux") return;
  const script = `import agnostic from ${JSON.stringify(`${import.meta.dir}/backends/default`)};
    process.env.CORTEX_AGENT_BATCH = "sh -c cat";
    try { await agnostic().run(${JSON.stringify(root())}, "x", "read"); process.stdout.write("pas d'erreur"); } catch (e) { process.stdout.write((e as Error).message); }`;
  const p = Bun.spawnSync([process.execPath, "-e", script], { env: { PATH: "/nonexistent", HOME: process.env.HOME ?? "/" } });
  expect(p.stdout.toString()).toContain("bubblewrap (bwrap) introuvable");
});
