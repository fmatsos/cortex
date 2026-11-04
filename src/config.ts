import { join } from "node:path";
import { z } from "zod";
import { checkTemplate, type NamingKey } from "./template";

/**
 * cortex.json: schema, defaults, reading and linting. Imports nothing from naming.ts, schema.ts or backends/
 * (the template validator lives in template.ts), so every module can read the config without a cycle.
 */

/** Agent clients. Without `client`, the CLI stays agnostic. */
export const CLIENT_NAMES = ["claude", "codex", "opencode"] as const;
export type Client = (typeof CLIENT_NAMES)[number];

// effort: vocabulary of each SDK; opencode = variant name, specific to each model (checked by opencode at launch)
export const EFFORTS = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"],
} as const satisfies Partial<Record<Client, readonly string[]>>;
/** Effort levels of a client that has a fixed vocabulary (claude, codex). */
export type Effort<C extends keyof typeof EFFORTS> = (typeof EFFORTS)[C][number];

const str = (k: string) => z.string({ error: `« ${k} » doit être une chaîne ou null.` }).nullish();
const template = (k: NamingKey) => str(k).superRefine((v, ctx) => {
  const e = v && checkTemplate(k, v);
  if (e) ctx.addIssue({ code: "custom", message: e, input: v });
});
const SHAPE = {
  client: z.enum(CLIENT_NAMES, { error: (i) => `client inconnu « ${i.input} » (${CLIENT_NAMES.join(", ")}).` }).nullish(),
  model: str("model"),
  effort: str("effort"),
  language: str("language"),
  schema: str("schema"),
  raw_path: template("raw_path"),
  page_path: template("page_path"),
};
export const CONFIG_KEYS = Object.keys(SHAPE) as (keyof typeof SHAPE)[];

/** Schema of cortex.json; null means « not set ». */
export const ConfigSchema = z.strictObject(SHAPE).superRefine((c, ctx) => {
  const allowed: readonly string[] | undefined = c.client ? (EFFORTS as Partial<Record<Client, readonly string[]>>)[c.client] : undefined;
  if (c.effort && allowed && !allowed.includes(c.effort))
    ctx.addIssue({ code: "custom", path: ["effort"], message: `effort « ${c.effort} » invalide pour ${c.client} (${allowed.join(", ")}).`, input: c.effort });
});

/** Content of a valid cortex.json as the schema reads it (null = « not set »). */
export type RawConfig = z.infer<typeof ConfigSchema>;
/** Effective config: the schema's shape with the unset (null) keys dropped, as `loadConfig` returns it. */
export type Config = { [K in keyof RawConfig]?: NonNullable<RawConfig[K]> };
export type ConfigIssue = { level: "error" | "warning"; msg: string };

const issueMsg = (i: z.core.$ZodIssue) =>
  i.code === "unrecognized_keys" ? `propriété inconnue « ${i.keys.join(", ")} » (${CONFIG_KEYS.join(", ")}).`
  : !i.path.length && i.code === "invalid_type" ? "cortex.json doit contenir un objet JSON."
  : i.message;

/** Checks of cortex.json: zod schema errors, then warnings. */
export function lintConfig(c: unknown): ConfigIssue[] {
  const r = ConfigSchema.safeParse(c);
  if (!r.success) return r.error.issues.map((i) => ({ level: "error", msg: issueMsg(i) }));
  return !r.data.client && (r.data.model || r.data.effort)
    ? [{ level: "warning", msg: "model/effort sans client : ignorés par le mode agnostique ($CORTEX_AGENT, $CORTEX_AGENT_BATCH)." }] : [];
}

export const configFile = (root: string) => Bun.file(join(root, "cortex.json"));

/** Raw content of cortex.json ({} if absent); invalid JSON = error. */
export async function readConfig(root: string): Promise<Record<string, unknown>> {
  const f = configFile(root);
  if (!(await f.exists())) return {};
  try { return await f.json(); } catch { throw new Error("cortex.json : JSON invalide."); }
}

export async function loadConfig(root: string): Promise<Config> {
  const c = await readConfig(root);
  const e = lintConfig(c).find((i) => i.level === "error");
  if (e) throw new Error(`cortex.json : ${e.msg} (cortex config lint)`);
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v != null)) as Config;
}

/** Agent file the schema is written to: the one the configured client loads on its own. */
export const agentFile = (client?: Client) => (client === "codex" || client === "opencode" ? "AGENTS.md" : "CLAUDE.md");

/** Agent file of this brain (CLAUDE.md or AGENTS.md, per the configured client). */
export const agentFileFor = async (root: string) => agentFile((await loadConfig(root)).client);
