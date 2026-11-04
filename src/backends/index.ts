import { join } from "node:path";
import type { Backend, Config } from "./backend";
import agnostic from "./default";
import claude from "./claude";
import codex from "./codex";
import opencode from "./opencode";

export type { Backend, Config, Mode } from "./backend";

/**
 * Bridge : les commandes (compile, ask : l'abstraction, dans agent.ts) ne connaissent que `Backend`.
 * Implémentations : default.ts (agnostique, sous-processus, aucun SDK), claude.ts, codex.ts, opencode.ts.
 * config.json à la racine choisit le client ; sans `client`, le CLI reste agnostique.
 */
const CLIENTS: Record<string, (cfg: Config) => Backend> = { claude, codex, opencode };

export async function loadConfig(root: string): Promise<Config> {
  const f = Bun.file(join(root, "config.json"));
  if (!(await f.exists())) return {};
  const c = (await f.json()) as Config;
  if (c.client && !(c.client in CLIENTS))
    throw new Error(`config.json : client inconnu « ${c.client} » (${Object.keys(CLIENTS).join(", ")}).`);
  return c;
}

export async function backendFor(root: string): Promise<Backend> {
  const cfg = await loadConfig(root);
  return cfg.client ? CLIENTS[cfg.client](cfg) : agnostic();
}
