import { interactiveWith, split, type Backend } from "./backend";
import { toAllowedTools } from "./policy";
import { confine } from "./sandbox";

// --- Agnostic (default): any agent CLI, no SDK--------------------------------------------------

export default function agnostic(): Backend {
  return {
    interactive: interactiveWith((p) => ["claude", p]),
    async run(root, prompt, mode) {
      const cmd = split(process.env.CORTEX_AGENT_BATCH ?? "claude -p");
      // tools granted to `claude -p`; whatever the agent, bubblewrap makes the whole repo except wiki/ read-only
      const tools = toAllowedTools(mode);
      // --allowedTools is variadic: the prompt goes through standard input
      const args = cmd[0] === "claude" ? [...cmd, "--allowedTools", ...tools] : cmd;
      const p = Bun.spawn(confine(root, args, mode), { cwd: root, stdin: new TextEncoder().encode(prompt), stdout: "pipe", stderr: "inherit" });
      const out = await new Response(p.stdout).text();
      if (await p.exited) throw new Error(`${cmd[0]} sorti en erreur`);
      return out.trim();
    },
  };
}

