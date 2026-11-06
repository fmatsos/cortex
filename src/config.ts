import { join } from "node:path";
import { z } from "zod";
import { checkTemplate, type NamingKey } from "./template";

/**
 * cortex.json: schema, defaults, reading and linting. Imports nothing from naming.ts, schema.ts or backends/
 * (the template validator lives in template.ts), so every module can read the config without a cycle.
 */

/** Agent clients. Without `client`, the CLI stays agnostic. */
export const CLIENT_NAMES = ["claude", "codex", "opencode", "openai"] as const;
export type Client = (typeof CLIENT_NAMES)[number];

// effort: vocabulary of each SDK; opencode = variant name, specific to each model (checked by opencode at launch)
export const EFFORTS = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"],
} as const satisfies Partial<Record<Client, readonly string[]>>;
/** Effort levels of a client that has a fixed vocabulary (claude, codex). */
export type Effort<C extends keyof typeof EFFORTS> = (typeof EFFORTS)[C][number];

const str = (k: string) => z.string({ error: `"${k}" must be a string or null.` }).nullish();
const template = (k: NamingKey) => str(k).superRefine((v, ctx) => {
  const e = v && checkTemplate(k, v);
  if (e) ctx.addIssue({ code: "custom", message: e, input: v });
});
/** Social networks with a `parser.social.<network>` block (ids of src/social). */
export const SOCIAL_NETWORKS = ["x", "bluesky", "mastodon", "linkedin"] as const;
/** Pages a social post links to, captured as sources tied to it: at most `limit` per post (default LIMITS.maxLinkedSources), 0 = none. */
const externalLink = (k: string) => z.strictObject({
  limit: z.number({ error: `"${k}.limit" must be an integer of at least 0, or null.` }).int({ error: `"${k}.limit" must be an integer of at least 0, or null.` }).min(0, { error: `"${k}.limit" must be an integer of at least 0, or null.` }).nullish(),
}, { error: `"${k}" must be an object (limit), or null.` }).nullish();
const SHAPE = {
  client: z.enum(CLIENT_NAMES, { error: (i) => `unknown client "${i.input}" (${CLIENT_NAMES.join(", ")}).` }).nullish(),
  model: str("model"),
  effort: str("effort"),
  base_url: str("base_url"),
  language: str("language"),
  schema: str("schema"),
  raw_path: template("raw_path"),
  page_path: template("page_path"),
  /** Most tags on a page an agent creates (default LIMITS.maxTags). */
  max_tags: z.number({ error: '"max_tags" must be an integer of at least 1, or null.' }).int({ error: '"max_tags" must be an integer of at least 1, or null.' }).min(1, { error: '"max_tags" must be an integer of at least 1, or null.' }).nullish(),
  /** Seconds before a URL fetch gives up (default LIMITS.fetchTimeoutMs / 1000); each --via mirror gets that much. */
  fetch_timeout: z.number({ error: '"fetch_timeout" must be a number of seconds above 0, or null.' }).positive({ error: '"fetch_timeout" must be a number of seconds above 0, or null.' }).nullish(),
  /** Semantic search (`cortex index` embeds the pages, `search` fuses it with BM25). Absent = off. base_url: default as the openai client's; model: default `qwen3-embed`; dims: default 256. */
  embed: z.strictObject({
    base_url: str("embed.base_url"), model: str("embed.model"),
    dims: z.number({ error: '"embed.dims" must be an integer of at least 1, or null.' }).int({ error: '"embed.dims" must be an integer of at least 1, or null.' }).min(1, { error: '"embed.dims" must be an integer of at least 1, or null.' }).nullish(),
  }, { error: '"embed" must be an object (base_url, model, dims), or null.' }).nullish(),
  /** Judge: a small System One model (d3-mini behind llama.cpp's `POST <base_url>/systemone`) that answers yes/no and choice questions (duplicate guard, ingest routing). Absent = off. base_url as `embed`; model: default `d3-mini`. */
  judge: z.strictObject({ base_url: str("judge.base_url"), model: str("judge.model") }, { error: '"judge" must be an object (base_url, model), or null.' }).nullish(),
  /** Page parsers' settings. parser.social.linkedin: CSS selectors LinkedIn is read with outside JSON-LD (link card, activity page, carousel), updated here when LinkedIn's page changes. Unset keys: social/linkedin.ts defaults. */
  parser: z.strictObject({
    social: z.strictObject({
      external_link: externalLink("parser.social.external_link"),
      linkedin: z.strictObject({
        card: str("parser.social.linkedin.card"), activity_text: str("parser.social.linkedin.activity_text"), activity_author: str("parser.social.linkedin.activity_author"),
        activity_images: str("parser.social.linkedin.activity_images"), shortlink: str("parser.social.linkedin.shortlink"), carousel: str("parser.social.linkedin.carousel"),
        external_link: externalLink("parser.social.linkedin.external_link"),
      }, { error: '"parser.social.linkedin" must be an object (card, activity_text, activity_author, activity_images, shortlink, carousel, external_link), or null.' }).nullish(),
      ...Object.fromEntries(SOCIAL_NETWORKS.filter((n) => n !== "linkedin").map((n) => [n, z.strictObject({ external_link: externalLink(`parser.social.${n}.external_link`) },
        { error: `"parser.social.${n}" must be an object (external_link), or null.` }).nullish()])) as Record<"x" | "bluesky" | "mastodon", z.ZodOptional<z.ZodNullable<z.ZodObject<{ external_link: ReturnType<typeof externalLink> }>>>>,
    }, { error: `"parser.social" must be an object (external_link, ${SOCIAL_NETWORKS.join(", ")}), or null.` }).nullish(),
  }, { error: '"parser" must be an object (social), or null.' }).nullish(),
};
export const CONFIG_KEYS = Object.keys(SHAPE) as (keyof typeof SHAPE)[];

/** Schema of cortex.json; null means « not set ». */
export const ConfigSchema = z.strictObject(SHAPE).superRefine((c, ctx) => {
  const allowed: readonly string[] | undefined = c.client ? (EFFORTS as Partial<Record<Client, readonly string[]>>)[c.client] : undefined;
  if (c.effort && allowed && !allowed.includes(c.effort))
    ctx.addIssue({ code: "custom", path: ["effort"], message: `invalid effort "${c.effort}" for ${c.client} (${allowed.join(", ")}).`, input: c.effort });
});

/** Content of a valid cortex.json as the schema reads it (null = « not set »). */
export type RawConfig = z.infer<typeof ConfigSchema>;
/** Effective config: the schema's shape with the unset (null) keys dropped, as `loadConfig` returns it. */
export type Config = { [K in keyof RawConfig]?: NonNullable<RawConfig[K]> };
export type ConfigIssue = { level: "error" | "warning"; msg: string };

const issueMsg = (i: z.core.$ZodIssue) =>
  i.code === "unrecognized_keys" ? `unknown property "${i.keys.join(", ")}" (${CONFIG_KEYS.join(", ")}).`
  : !i.path.length && i.code === "invalid_type" ? "cortex.json must contain a JSON object."
  : i.message;

/** Checks of cortex.json: zod schema errors, then warnings. */
export function lintConfig(c: unknown): ConfigIssue[] {
  const r = ConfigSchema.safeParse(c);
  if (!r.success) return r.error.issues.map((i) => ({ level: "error", msg: issueMsg(i) }));
  if (r.data.client === "openai" && !r.data.model) return [{ level: "warning", msg: "the openai client needs a model (e.g. qwen3:8b)." }];
  return !r.data.client && (r.data.model || r.data.effort || r.data.base_url)
    ? [{ level: "warning", msg: "model/effort/base_url without a client: ignored by the agnostic mode ($CORTEX_AGENT, $CORTEX_AGENT_BATCH)." }] : [];
}

/**
 * Server of an optional feature (`embed`, `judge`): its own `base_url`, else the global one, else $OPENAI_BASE_URL, else a
 * local Ollama, as the openai client (backends/openai.ts). The $OPENAI_API_KEY only goes to a URL that the environment
 * names (a cloned wiki must not send it to another host).
 */
export function endpoint(c: Config, own?: string): { url: string; key?: string } {
  const named = own ?? c.base_url;
  return {
    url: (named ?? process.env.OPENAI_BASE_URL ?? "http://localhost:11434/v1").replace(/\/+$/, ""),
    key: !named || named === process.env.OPENAI_BASE_URL ? process.env.OPENAI_API_KEY : undefined,
  };
}

export const configFile = (root: string) => Bun.file(join(root, "cortex.json"));

/** Raw content of cortex.json ({} if absent); invalid JSON = error. */
export async function readConfig(root: string): Promise<Record<string, unknown>> {
  const f = configFile(root);
  if (!(await f.exists())) return {};
  try { return await f.json(); } catch { throw new Error("cortex.json: invalid JSON."); }
}

export async function loadConfig(root: string): Promise<Config> {
  const c = await readConfig(root);
  const e = lintConfig(c).find((i) => i.level === "error");
  if (e) throw new Error(`cortex.json: ${e.msg} (cortex config lint)`);
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v != null)) as Config;
}

/** Agent file the schema is written to: the one the configured client loads on its own. */
export const agentFile = (client?: Client) => (client && client !== "claude" ? "AGENTS.md" : "CLAUDE.md");

/** Agent file of this wiki (CLAUDE.md or AGENTS.md, per the configured client). */
export const agentFileFor = async (root: string) => agentFile((await loadConfig(root)).client);
