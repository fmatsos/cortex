import { confine, interactiveWith, split, type Backend } from "./backend";

// --- Agnostique (défaut) : n'importe quelle CLI d'agent, aucun SDK -----------------------------

export default function agnostic(): Backend {
  return {
    interactive: interactiveWith((p) => ["claude", p]),
    async run(root, prompt, mode) {
      const cmd = split(process.env.CORTEX_AGENT_BATCH ?? "claude -p");
      // outils accordés à `claude -p` ; quel que soit l'agent, bubblewrap rend tout le dépôt sauf wiki/ en lecture seule
      const tools = ["Read", "Glob", "Grep", "Bash(cortex search:*)", ...(mode === "write" ? ["Write", "Edit", "Bash(cortex index)", "Bash(cortex lint:*)", "Bash(cortex log add:*)"] : [])];
      // --allowedTools est variadique : le prompt passe par l'entrée standard
      const args = cmd[0] === "claude" ? [...cmd, "--allowedTools", ...tools] : cmd;
      const p = Bun.spawn(confine(root, args, mode), { cwd: root, stdin: new TextEncoder().encode(prompt), stdout: "pipe", stderr: "inherit" });
      const out = await new Response(p.stdout).text();
      if (await p.exited) throw new Error(`${cmd[0]} sorti en erreur`);
      return out.trim();
    },
  };
}

