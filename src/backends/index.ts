import type { Backend, Config } from "./backend";
import { loadConfig, type Client } from "../config";
import agnostic from "./default";
import claude from "./claude";
import codex from "./codex";
import opencode from "./opencode";
import openai from "./openai";

export type { Backend, Mode } from "./backend";

/**
 * Bridge: the commands (compile, ask: the abstraction, in agent.ts) only know `Backend`.
 * Implementations: default.ts (agnostic, subprocess, no SDK), claude.ts, codex.ts, opencode.ts, openai.ts.
 * cortex.json at the root chooses the client; without `client`, the CLI stays agnostic.
 * Only agent.ts imports this module: capture commands (add, new, lint) never load the agent backends.
 */
const CLIENTS = { claude, codex, opencode, openai } satisfies Record<Client, (cfg: Config) => Backend>;

export async function backendFor(root: string, config?: Config): Promise<Backend> {
  const cfg = config ?? await loadConfig(root);
  return cfg.client ? CLIENTS[cfg.client](cfg) : agnostic();
}
