import { join } from "node:path";
import { cli, flag, interactiveWith, load, type Backend, type Config } from "./backend";

// --- Codex SDK: OS sandbox; when writing, only wiki/ is writable---------------------------------

export default function codex(cfg: Config): Backend {
  return {
    interactive: interactiveWith((p) => ["codex", ...flag("-m", cfg.model), ...flag("-c", cfg.effort && `model_reasoning_effort="${cfg.effort}"`), p]),
    async run(root, prompt, mode) {
      const { Codex } = await load<typeof import("@openai/codex-sdk")>("@openai/codex-sdk");
      const thread = new Codex({ codexPathOverride: cli("codex") }).startThread({
        // workspace-write only allows writing under workingDirectory (verified: raw/ and the agent file stay read-only)
        workingDirectory: mode === "write" ? join(root, "wiki") : root,
        sandboxMode: mode === "write" ? "workspace-write" : "read-only",
        approvalPolicy: "never",
        skipGitRepoCheck: true,
        model: cfg.model,
        modelReasoningEffort: cfg.effort as any, // minimal | low | medium | high | xhigh…
      });
      return (await thread.run(prompt)).finalResponse;
    },
  };
}

