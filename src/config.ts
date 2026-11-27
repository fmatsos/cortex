import { renameSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { checkTemplate, type NamingKey } from "./template";
import { LIMITS } from "./limits";
import { instanceRoot, SPACE_NAME } from "./lib";

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
const prob = (k: string) => { const error = `"${k}" must be a number between 0 and 1, or null.`; return z.number({ error }).min(0, { error }).max(1, { error }).nullish(); };
const count = (k: string) => { const error = `"${k}" must be an integer of at least 1, or null.`; return z.number({ error }).int({ error }).min(1, { error }).nullish(); };
const template = (k: NamingKey) => str(k).superRefine((v, ctx) => {
  const e = v && checkTemplate(k, v);
  if (e) ctx.addIssue({ code: "custom", message: e, input: v });
});
/** Where the embeddings come from: a server speaking the OpenAI `/embeddings` API, or the model run inside cortex. */
export const EMBED_PROVIDERS = ["openai", "local"] as const;
/** Social networks with a `parser.social.<network>` block (ids of src/social). */
export const SOCIAL_NETWORKS = ["x", "bluesky", "mastodon", "linkedin"] as const;
/** Pages a social post links to, captured as sources tied to it: at most `limit` per post (default LIMITS.maxLinkedSources), 0 = none. */
const externalLink = (k: string) => z.strictObject({
  limit: z.number({ error: `"${k}.limit" must be an integer of at least 0, or null.` }).int({ error: `"${k}.limit" must be an integer of at least 0, or null.` }).min(0, { error: `"${k}.limit" must be an integer of at least 0, or null.` }).nullish(),
}, { error: `"${k}" must be an object (limit), or null.` }).nullish();

/** `auth.public_urls` entry: an origin (scheme + host[:port]), nothing after it. Returns an error message, or undefined. */
export function checkPublicUrl(v: string): string | undefined {
  let u: URL;
  try { u = new URL(v); } catch { return `"auth.public_urls" entry "${v}" is not a URL (e.g. https://cortex.example).`; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return `"auth.public_urls" entry "${v}" must start with https:// (or http://).`;
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/")
    return `"auth.public_urls" entry "${v}" must be an origin only (https://host[:port]): the API lives at the root of the server, \`CORTEX_SITE_BASE\` only affects the static export.`;
}
/** Loopback hosts: the only ones an http:// OIDC issuer is accepted for (tests, a local issuer). */
export const isLoopbackHost = (h: string) => /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(h);
function checkIssuer(v: string): string | undefined {
  let u: URL;
  try { u = new URL(v); } catch { return `"auth.oidc.issuer" "${v}" is not a URL (e.g. https://auth.example).`; }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && isLoopbackHost(u.hostname))) return `"auth.oidc.issuer" "${v}" must be an https:// URL.`;
  if (u.search || u.hash) return `"auth.oidc.issuer" "${v}" must not have a query or fragment.`;
}
/** Built-in schemas a `schema` value can name instead of a file (src/schema-notes.md). */
export const BUILT_IN_SCHEMAS = ["notes"] as const;
/** `schema` / `spaces.<name>.schema`: a file (has a `/` or `.md`) relative to the instance root, or a built-in name. */
const schemaRef = (k: string) => str(k).superRefine((v, ctx) => {
  if (v && !v.includes("/") && !v.includes(".md") && !(BUILT_IN_SCHEMAS as readonly string[]).includes(v))
    ctx.addIssue({ code: "custom", message: `unknown built-in schema "${v}" in "${k}" (${BUILT_IN_SCHEMAS.join(", ")}), or give a path to a .md file.`, input: v });
});
const text = (k: string) => z.string({ error: `"${k}" must be a non-empty string.` }).trim().min(1, { error: `"${k}" must be a non-empty string.` });
const refined = (k: string, check: (v: string) => string | undefined) => text(k).superRefine((v, ctx) => { const e = check(v); if (e) ctx.addIssue({ code: "custom", message: e, input: v }); });
const list = <T extends z.ZodType>(k: string, item: T, what: string) => z.array(item, { error: `"${k}" must be a list of ${what}.` }).min(1, { error: `"${k}" needs at least one entry (an empty list would refuse everyone): leave the provider out instead.` });
/** The secrets never go in cortex.json (versioned): a `client_secret` key gets its own message. */
const provider = <S extends z.ZodRawShape>(k: string, shape: S, keys: string) => z.strictObject(shape, {
  error: (i) => i.code === "unrecognized_keys" && i.keys.includes("client_secret")
    ? `"${k}.client_secret" does not belong in cortex.json (it is versioned): set $CORTEX_${k.slice(5).toUpperCase()}_CLIENT_SECRET in the server's environment.`
    : i.code === "unrecognized_keys" ? `unknown property "${i.keys.join(", ")}" in "${k}" (${keys}).` : `"${k}" must be an object (${keys}), or null.`,
});
const SHAPE = {
  client: z.enum(CLIENT_NAMES, { error: (i) => `unknown client "${i.input}" (${CLIENT_NAMES.join(", ")}).` }).nullish(),
  model: str("model"),
  effort: str("effort"),
  base_url: str("base_url"),
  language: str("language"),
  schema: schemaRef("schema"),
  raw_path: template("raw_path"),
  page_path: template("page_path"),
  /** Most tags on a page an agent creates (default LIMITS.maxTags). */
  max_tags: z.number({ error: '"max_tags" must be an integer of at least 1, or null.' }).int({ error: '"max_tags" must be an integer of at least 1, or null.' }).min(1, { error: '"max_tags" must be an integer of at least 1, or null.' }).nullish(),
  /** Seconds before a URL fetch gives up (default LIMITS.fetchTimeoutMs / 1000); each --via mirror gets that much. */
  fetch_timeout: z.number({ error: '"fetch_timeout" must be a number of seconds above 0, or null.' }).positive({ error: '"fetch_timeout" must be a number of seconds above 0, or null.' }).nullish(),
  /**
   * Hybrid search (`cortex index` embeds the pages and their sections, `search` fuses words, title fragments and vectors).
   * Absent = off (words only). provider: `openai` (default: an OpenAI-compatible `POST <base_url>/embeddings` server, llama.cpp…)
   * or `local` (the model runs in this process, downloaded once). model: default `qwen3-embed` (openai), `Xenova/multilingual-e5-small` (local).
   * base_url: openai only, default as the openai client's. dims: default 256 (qwen3-embed, Matryoshka), else the model's own (384 for e5-small).
   * threads: local only, ONNX threads of the model (default: 4 or the number of cores if fewer).
   */
  embed: z.strictObject({
    provider: z.enum(EMBED_PROVIDERS, { error: (i) => `unknown embed.provider "${String(i.input)}" (${EMBED_PROVIDERS.join(", ")}).` }).nullish(),
    base_url: str("embed.base_url"), model: str("embed.model"),
    dims: count("embed.dims"), threads: count("embed.threads"),
  }, { error: '"embed" must be an object (provider, base_url, model, dims, threads), or null.' }).nullish(),
  /**
   * Natural-language questions from the site's search bar (`cortex serve`: POST /api/ask), answered by an agent in read mode.
   * Absent = off (the route spends tokens). client: default the global one; model: default the client's cheapest (claude:
   * haiku, codex: gpt-6-luna), otherwise the global `model` when the client is the global one; effort: none sent by default;
   * base_url (openai client): default $CORTEX_ASK_BASE_URL, else as the openai client. $CORTEX_ASK_API_KEY only goes to $CORTEX_ASK_BASE_URL.
   * history_turns: earlier exchanges (question + answer) sent with each question; default the client's own limit (serve.ts), else 10.
   * temperature: 0 to 2; absent = none sent, the provider's default applies; only the openai client sends it.
   */
  site_ask: z.strictObject({
    client: z.enum(CLIENT_NAMES, { error: (i) => `unknown site_ask.client "${i.input}" (${CLIENT_NAMES.join(", ")}).` }).nullish(),
    base_url: str("site_ask.base_url"), model: str("site_ask.model"), effort: str("site_ask.effort"), history_turns: count("site_ask.history_turns"),
    temperature: z.number({ error: '"site_ask.temperature" must be a number between 0 and 2, or null.' }).min(0, { error: '"site_ask.temperature" must be a number between 0 and 2, or null.' }).max(2, { error: '"site_ask.temperature" must be a number between 0 and 2, or null.' }).nullish(),
  }, { error: '"site_ask" must be an object (client, base_url, model, effort, history_turns, temperature), or null.' }).nullish(),
  /** Review notion (verified pages, « to review again », « mark as reviewed »). Absent = off: the site shows none of it. */
  review: z.boolean({ error: '"review" must be true, false or null.' }).nullish(),
  /** Draft status. Absent = off: the site shows draft pages as stable and offers no draft filter. */
  drafts: z.boolean({ error: '"drafts" must be true, false or null.' }).nullish(),
  /**
   * Judge: a System One model (TypeSafe's hosted Jev, or d3-mini behind llama.cpp's `POST <base_url>/systemone`) that answers
   * yes/no and choice questions (duplicate guard, ingest routing). Absent = off. base_url: default $CORTEX_JEV_BASE_URL, else
   * as `embed`; model: default $CORTEX_JEV_MODEL, else `d3-mini`. Thresholds and sizes (they depend on the model): each one
   * default $CORTEX_JEV_<NAME>, else limits.ts (judge.ts JUDGE_SETTINGS). `*_related` must not exceed `*_retained`.
   */
  judge: z.strictObject({
    base_url: str("judge.base_url"), model: str("judge.model"),
    route_yes: prob("judge.route_yes"), dup_yes: prob("judge.dup_yes"),
    route_candidates: count("judge.route_candidates"), dup_candidates: count("judge.dup_candidates"), route_chars: count("judge.route_chars"),
    ask_retained: prob("judge.ask_retained"), ask_related: prob("judge.ask_related"), ask_candidates: count("judge.ask_candidates"),
    search_retained: prob("judge.search_retained"), search_related: prob("judge.search_related"), search_candidates: count("judge.search_candidates"),
    concurrency: count("judge.concurrency"),
  }, { error: '"judge" must be an object (base_url, model, route_yes, dup_yes, route_candidates, dup_candidates, route_chars, ask_retained, ask_related, ask_candidates, search_retained, search_related, search_candidates, concurrency), or null.' }).nullish(),
  /**
   * User accounts of `cortex serve` (src/auth.ts, docs in the README): sign-in through a generic OIDC provider (Authelia…),
   * GitHub (OAuth2) and/or Google (OIDC), each active only when configured AND its secret is in the environment
   * ($CORTEX_OIDC_CLIENT_SECRET, $CORTEX_GITHUB_CLIENT_SECRET, $CORTEX_GOOGLE_CLIENT_SECRET: never in this file). Absent = no sign-in.
   * public_urls: the origins the site is reached at (behind the proxies: serve only sees http); the redirect URI is built from
   * them, never from the request. oidc.groups: the user needs one of them (claim `groups`). github.allow: numeric user ids.
   * google.allow: e-mail addresses (the account's e-mail must be verified).
   */
  auth: z.strictObject({
    public_urls: z.array(refined("auth.public_urls", checkPublicUrl), { error: '"auth.public_urls" must be a list of origins (https://cortex.example).' }).nullish(),
    oidc: provider("auth.oidc", {
      label: str("auth.oidc.label"), issuer: refined("auth.oidc.issuer", checkIssuer), client_id: text("auth.oidc.client_id"),
      groups: list("auth.oidc.groups", text("auth.oidc.groups"), "group names").nullish(),
    }, "label, issuer, client_id, groups").nullish(),
    github: provider("auth.github", {
      client_id: text("auth.github.client_id"),
      allow: list("auth.github.allow", z.number({ error: '"auth.github.allow" holds numeric GitHub user ids (a login can be renamed and taken over): curl https://api.github.com/users/<login>.' }).int().positive(), "numeric GitHub user ids"),
    }, "client_id, allow").nullish(),
    google: provider("auth.google", {
      client_id: text("auth.google.client_id"),
      allow: list("auth.google.allow", text("auth.google.allow").refine((v) => /^[^@\s]+@[^@\s]+$/.test(v), { error: '"auth.google.allow" holds e-mail addresses.' }), "e-mail addresses"),
    }, "client_id, allow").nullish(),
  }, { error: (i) => i.code === "unrecognized_keys" ? `unknown property "${i.keys.join(", ")}" in "auth" (public_urls, oidc, github, google).` : '"auth" must be an object (public_urls, oidc, github, google), or null.' }).nullish(),
  /** Space used when none is chosen (--space, $CORTEX_SPACE, the folder): multi-space instances (`spaces/`), see `cortex space`. */
  default_space: str("default_space").refine((v) => v == null || SPACE_NAME.test(v), { error: `"default_space" must be a space name (${SPACE_NAME}).` }),
  /**
   * Per-space settings, by space name. repo: the space is its own git repository (cloned by `cortex space add --repo`, ignored by the instance's).
   * schema: the agent schema of the space, instead of the global one (a path relative to the instance root, or the built-in `notes`).
   */
  spaces: z.record(z.string(), z.strictObject({ repo: str("spaces.<name>.repo"), schema: schemaRef("spaces.<name>.schema") }, { error: '"spaces.<name>" must be an object (repo, schema).' }), {
    error: '"spaces" must be an object: one entry (repo, schema) per space name, or null.',
  }).nullish().superRefine((v, ctx) => {
    for (const n of Object.keys(v ?? {})) if (!SPACE_NAME.test(n)) ctx.addIssue({ code: "custom", message: `"spaces" has an invalid space name "${n}" (${SPACE_NAME}).`, input: n });
  }),
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
  const check = (path: string[], effort?: string | null, client?: Client | null) => {
    const allowed: readonly string[] | undefined = client ? (EFFORTS as Partial<Record<Client, readonly string[]>>)[client] : undefined;
    if (effort && allowed && !allowed.includes(effort))
      ctx.addIssue({ code: "custom", path, message: `invalid ${path.join(".")} "${effort}" for ${client} (${allowed.join(", ")}).`, input: effort });
  };
  check(["effort"], c.effort, c.client);
  check(["site_ask", "effort"], c.site_ask?.effort, c.site_ask?.client ?? c.client);
  const j = c.judge;
  if (j?.search_retained != null && j.search_related != null && j.search_related > j.search_retained)
    ctx.addIssue({ code: "custom", path: ["judge", "search_related"], message: `"judge.search_related" (${j.search_related}) cannot exceed "judge.search_retained" (${j.search_retained}).`, input: j.search_related });
  const a = c.auth;
  if (a && (a.oidc || a.github || a.google) && !a.public_urls?.length)
    ctx.addIssue({ code: "custom", path: ["auth", "public_urls"], message: '"auth.public_urls" is required with a provider: the redirect URI is built from it (e.g. ["https://cortex.example"]).' });
});

/** Content of a valid cortex.json as the schema reads it (null = « not set »). */
export type RawConfig = z.infer<typeof ConfigSchema>;
/** Effective config: the schema's shape with the unset (null) keys dropped, as `loadConfig` returns it. */
export type Config = { [K in keyof RawConfig]?: NonNullable<RawConfig[K]> };
export type ConfigIssue = { level: "error" | "warning"; msg: string };

const issueMsg = (i: z.core.$ZodIssue) =>
  i.code === "unrecognized_keys" && !i.path.length ? `unknown property "${i.keys.join(", ")}" (${CONFIG_KEYS.join(", ")}).`
  : !i.path.length && i.code === "invalid_type" ? "cortex.json must contain a JSON object."
  : i.message;

/** Checks of cortex.json: zod schema errors, then warnings. */
export function lintConfig(c: unknown): ConfigIssue[] {
  const r = ConfigSchema.safeParse(c);
  if (!r.success) return r.error.issues.map((i) => ({ level: "error", msg: issueMsg(i) }));
  const e = r.data.embed;
  if (e?.provider === "local" && e.base_url) return [{ level: "warning", msg: 'embed.base_url is ignored with embed.provider "local" (the model runs in cortex).' }];
  if (e?.threads && e.provider !== "local") return [{ level: "warning", msg: 'embed.threads only applies to embed.provider "local".' }];
  if (r.data.client === "openai" && !r.data.model) return [{ level: "warning", msg: "the openai client needs a model (e.g. qwen3:8b)." }];
  if (r.data.site_ask?.client === "openai" && !r.data.site_ask.model && r.data.client !== "openai")
    return [{ level: "warning", msg: "site_ask with the openai client needs site_ask.model." }];
  if (r.data.site_ask?.temperature != null && (r.data.site_ask.client ?? r.data.client) !== "openai")
    return [{ level: "warning", msg: "site_ask.temperature only applies to the openai client (the other clients do not take it)." }];
  const j = r.data.judge;
  // one of the two set alone is compared with the other's default: the related bar would be lowered at run time
  if (j && (j.search_retained != null) !== (j.search_related != null)) {
    const retained = j.search_retained ?? LIMITS.searchRetained, related = j.search_related ?? LIMITS.searchRelated;
    if (related > retained) return [{ level: "warning", msg: `judge.search_related (${related}) is above judge.search_retained (${retained}): the related bar is lowered to ${retained}. Set both.` }];
  }
  const plain = r.data.auth?.public_urls?.find((u) => u.startsWith("http:"));
  if (plain) return [{ level: "warning", msg: `auth.public_urls "${plain}" is plain http: the session cookie is not marked Secure there.` }];
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

/** cortex.json of the instance the content root belongs to (a space never has its own). */
export const configFile = (root: string) => Bun.file(join(instanceRoot(root), "cortex.json"));

/** Raw content of cortex.json ({} if absent); invalid JSON = error. */
export async function readConfig(root: string): Promise<Record<string, unknown>> {
  const f = configFile(root);
  if (!(await f.exists())) return {};
  try { return await f.json(); } catch { throw new Error("cortex.json: invalid JSON."); }
}

/** Writes cortex.json after validating it; tmp + rename, since cortex.json marks the root and a half-written one would break every command. */
export async function writeConfig(file: ReturnType<typeof Bun.file>, c: Record<string, unknown>) {
  const e = lintConfig(c).filter((i) => i.level === "error");
  if (e.length) throw new Error(e.map((i) => i.msg).join(" "));
  await Bun.write(`${file.name}.tmp`, JSON.stringify(c, null, 2) + "\n");
  renameSync(`${file.name}.tmp`, file.name!);
}

/** Per-command `--model` / `--effort` (cortex.ts): applied over cortex.json by every `loadConfig` of this process. */
export const override: { model?: string; effort?: string } = {};

/** cortex.json with `override` on top. `--model` is the bare name: an opencode `provider/model` keeps its provider. */
export function withOverride(c: Record<string, unknown>): Record<string, unknown> {
  const r = { ...c };
  if (override.model) r.model = typeof c.model === "string" && c.model.includes("/") ? c.model.replace(/[^/]*$/, override.model) : override.model;
  if (override.effort) r.effort = override.effort;
  return r;
}

export async function loadConfig(root: string): Promise<Config> {
  const c = withOverride(await readConfig(root));
  const e = lintConfig(c).find((i) => i.level === "error");
  if (e) throw new Error(`cortex.json: ${e.msg} (cortex config lint)`);
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v != null)) as Config;
}

/** Agent file the schema is written to: the one the configured client loads on its own. */
export const agentFile = (client?: Client) => (client && client !== "claude" ? "AGENTS.md" : "CLAUDE.md");

/** Agent file of this wiki (CLAUDE.md or AGENTS.md, per the configured client). */
export const agentFileFor = async (root: string) => agentFile((await loadConfig(root)).client);
