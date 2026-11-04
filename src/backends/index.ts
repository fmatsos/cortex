import { join } from "node:path";
import type { Backend, Config } from "./backend";
import agnostic from "./default";
import claude from "./claude";
import codex from "./codex";
import opencode from "./opencode";
import { z } from "zod";
import { checkTemplate, type NamingKey } from "../naming";

export type { Backend, Config, Mode } from "./backend";

/**
 * Bridge : les commandes (compile, ask : l'abstraction, dans agent.ts) ne connaissent que `Backend`.
 * Implémentations : default.ts (agnostique, sous-processus, aucun SDK), claude.ts, codex.ts, opencode.ts.
 * config.json à la racine choisit le client ; sans `client`, le CLI reste agnostique.
 */
const CLIENTS: Record<string, (cfg: Config) => Backend> = { claude, codex, opencode };

// effort : vocabulaire de chaque SDK ; opencode = nom de variante, propre à chaque modèle (vérifié par opencode au lancement)
const EFFORTS: Record<string, string[] | undefined> = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"],
};
const str = (k: string) => z.string({ error: `« ${k} » doit être une chaîne ou null.` }).nullish();
const template = (k: NamingKey) => str(k).superRefine((v, ctx) => {
  const e = v && checkTemplate(k, v);
  if (e) ctx.addIssue({ code: "custom", message: e, input: v });
});
const SHAPE = {
  client: z.enum(Object.keys(CLIENTS) as [string, ...string[]], { error: (i) => `client inconnu « ${i.input} » (${Object.keys(CLIENTS).join(", ")}).` }).nullish(),
  model: str("model"),
  effort: str("effort"),
  raw_path: template("raw_path"),
  page_path: template("page_path"),
};
export const CONFIG_KEYS = Object.keys(SHAPE) as (keyof typeof SHAPE)[];

/** Schéma de config.json ; null vaut « non défini ». */
export const ConfigSchema = z.strictObject(SHAPE).superRefine((c, ctx) => {
  const allowed = c.client && EFFORTS[c.client];
  if (c.effort && allowed && !allowed.includes(c.effort))
    ctx.addIssue({ code: "custom", path: ["effort"], message: `effort « ${c.effort} » invalide pour ${c.client} (${allowed.join(", ")}).`, input: c.effort });
});
export type ConfigIssue = { level: "error" | "warning"; msg: string };

const issueMsg = (i: z.core.$ZodIssue) =>
  i.code === "unrecognized_keys" ? `propriété inconnue « ${i.keys.join(", ")} » (${CONFIG_KEYS.join(", ")}).`
  : !i.path.length && i.code === "invalid_type" ? "config.json doit contenir un objet JSON."
  : i.message;

/** Contrôles de config.json : erreurs du schéma zod, puis avertissements. */
export function lintConfig(c: unknown): ConfigIssue[] {
  const r = ConfigSchema.safeParse(c);
  if (!r.success) return r.error.issues.map((i) => ({ level: "error", msg: issueMsg(i) }));
  return !r.data.client && (r.data.model || r.data.effort)
    ? [{ level: "warning", msg: "model/effort sans client : ignorés par le mode agnostique ($CORTEX_AGENT, $CORTEX_AGENT_BATCH)." }] : [];
}

const configFile = (root: string) => Bun.file(join(root, "config.json"));

/** Contenu brut de config.json ({} s'il est absent) ; JSON invalide = erreur. */
export async function readConfig(root: string): Promise<Record<string, unknown>> {
  const f = configFile(root);
  if (!(await f.exists())) return {};
  try { return await f.json(); } catch { throw new Error("config.json : JSON invalide."); }
}

export async function loadConfig(root: string): Promise<Config> {
  const c = await readConfig(root);
  const e = lintConfig(c).find((i) => i.level === "error");
  if (e) throw new Error(`config.json : ${e.msg} (cortex config lint)`);
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v != null)) as Config;
}

/** cortex config init|lint|get|set|remove. Toute écriture est validée avant d'être faite. */
export async function configCmd(root: string, [sub, key, value]: string[]): Promise<number> {
  const f = configFile(root);
  const save = async (c: Record<string, unknown>) => {
    const e = lintConfig(c).filter((i) => i.level === "error");
    if (e.length) throw new Error(e.map((i) => i.msg).join(" "));
    await Bun.write(f, JSON.stringify(c, null, 2) + "\n");
  };
  const checkKey = () => {
    if (!(CONFIG_KEYS as readonly string[]).includes(key ?? "")) throw new Error(`Propriété attendue : ${CONFIG_KEYS.join(", ")}.`);
  };
  switch (sub) {
    case "init":
      if (await f.exists()) throw new Error("config.json existe déjà.");
      await save({ client: null, model: null, effort: null, raw_path: null, page_path: null }); // null = non défini : agnostique, nommage par défaut (UUID v7)
      console.log("config.json créé (agnostique). Renseigne-le avec cortex config set client claude|codex|opencode.");
      return 0;
    case "lint": {
      if (!(await f.exists())) { console.log("Pas de config.json : mode agnostique."); return 0; }
      let issues: ConfigIssue[];
      try { issues = lintConfig(await readConfig(root)); } catch (e) { issues = [{ level: "error", msg: (e as Error).message }]; }
      for (const i of issues) console.log(`${i.level === "error" ? "✗" : "!"} ${i.msg}`);
      if (!issues.length) console.log("config.json valide.");
      return issues.some((i) => i.level === "error") ? 1 : 0;
    }
    case "get": {
      const c = await readConfig(root);
      if (!key) { console.log(JSON.stringify(c, null, 2)); return 0; }
      checkKey();
      if (c[key] != null) console.log(c[key]);
      return 0;
    }
    case "set":
      checkKey();
      if (!value) throw new Error(`Usage : cortex config set ${key} <valeur>`);
      await save({ ...(await readConfig(root)), [key]: value });
      return 0;
    case "remove": {
      checkKey();
      const c = await readConfig(root);
      delete c[key];
      await save(c);
      return 0;
    }
    default:
      throw new Error("Usage : cortex config init | lint | get [clé] | set <clé> <valeur> | remove <clé>");
  }
}

export async function backendFor(root: string): Promise<Backend> {
  const cfg = await loadConfig(root);
  return cfg.client ? CLIENTS[cfg.client](cfg) : agnostic();
}
