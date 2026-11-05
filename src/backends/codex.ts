import { join } from "node:path";
import type { Effort } from "../config";
import { cli, flag, interactiveWith, load, type Backend, type Config } from "./backend";
import { packServer } from "./tools";

// --- Codex SDK: the cortex tool pack over MCP, Codex's shell off; OS sandbox, when writing only wiki/ is writable.
// apply_patch cannot be switched off (no config key): it stays, under the sandbox and cortex's checks after the run.

export default function codex(cfg: Config): Backend {
  return {
    interactive: interactiveWith((p) => ["codex", ...flag("-m", cfg.model), ...flag("-c", cfg.effort && `model_reasoning_effort="${cfg.effort}"`), p]),
    async run(root, prompt, mode) {
      const { Codex } = await load<typeof import("@openai/codex-sdk")>("@openai/codex-sdk", () => import("@openai/codex-sdk"));
      const config = { mcp_servers: { cortex: packServer(root, mode) }, features: { shell_tool: false } };
      const thread = new Codex({ codexPathOverride: cli("codex"), config: config as any }).startThread({
        // workspace-write only allows writing under workingDirectory (verified: raw/ and the agent file stay read-only)
        workingDirectory: mode === "write" ? join(root, "wiki") : root,
        sandboxMode: mode === "write" ? "workspace-write" : "read-only",
        approvalPolicy: "never",
        skipGitRepoCheck: true,
        model: cfg.model,
        modelReasoningEffort: cfg.effort as Effort<"codex"> | undefined, // validated against EFFORTS.codex by loadConfig (plain string in the schema)
      });
      return (await thread.run(prompt)).finalResponse;
    },
  };
}

