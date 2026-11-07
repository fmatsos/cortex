import { interactiveWith, split, type Backend } from "./backend";
import { BUILTINS } from "./claude";
import { packMcpConfig } from "./tools";
import { confine } from "./sandbox";

// --- Agnostic (default): any agent CLI, no SDK--------------------------------------------------

export default function agnostic(): Backend {
  return {
    interactive: interactiveWith((p) => ["claude", p]),
    async run(root, prompt, mode) {
      const cmd = split(process.env.CORTEX_AGENT_BATCH ?? "claude -p");
      // `claude -p` gets the cortex tool pack (cortex mcp --agent) and none of its own tools; any other agent CLI keeps
      // its own tools. Whatever the agent, bubblewrap makes the whole repo except wiki/ read-only, and cortex checks after.
      // The flags are variadic: the prompt goes through standard input
      const args = cmd[0] === "claude"
        ? [...cmd, "--strict-mcp-config", "--mcp-config", packMcpConfig(root, mode), "--allowedTools", "mcp__cortex__*", "--disallowedTools", ...BUILTINS]
        : cmd;
      const p = Bun.spawn(confine(root, args, mode), { cwd: root, stdin: new TextEncoder().encode(prompt), stdout: "pipe", stderr: "inherit" });
      const out = await new Response(p.stdout).text();
      if (await p.exited) throw new Error(`${cmd[0]} exited with an error`);
      return out.trim();
    },
  };
}

