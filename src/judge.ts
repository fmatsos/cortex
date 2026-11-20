import { endpoint, loadConfig } from "./config";
import { LIMITS } from "./limits";
import { note, warn } from "./style";

// --- Judge: a System One model (d3-mini behind llama.cpp's `POST <base_url>/systemone`, TypeSafe's request format) that
// answers questions about one `state`: noul = probability of yes, choice = probabilities over named options. Off unless
// cortex.json has a `judge` block; every caller works without it.

export const JUDGE = {
  /** One call: past it the server counts as down and the caller goes on without a judge. */
  timeoutMs: 10_000,
  /** The same for a call of many questions (the model reads the state once per question: ~1200 tokens/s on the GPU of the test server). */
  longTimeoutMs: 30_000,
  /** Seconds the server is left alone after a failed call. */
  downMs: 30_000,
  /** Characters of state the model takes (d3-mini: 4096 tokens of context, for the state and every question). */
  stateChars: 3000,
  /** A noul at or above this is a yes. */
  yes: 0.7,
} as const;

export type Question = { type: "noul"; instructions: string } | { type: "choice"; instructions: string; criteria: Record<string, string> };
export type Answer = { type: "noul"; noul: number } | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
/**
 * The judge's tunable settings (they depend on the model): `judge.<name>` in cortex.json, else $CORTEX_JUDGE_<NAME> (for CI
 * workflows), else the default of limits.ts. An invalid environment value is ignored with a warning.
 */
export const JUDGE_SETTINGS = {
  route_yes: { limit: "routeYes", min: 0, max: 1, int: false },
  dup_yes: { limit: "dupJudge", min: 0, max: 1, int: false },
  route_candidates: { limit: "routeCandidates", min: 1, max: Infinity, int: true },
  dup_candidates: { limit: "dupCandidates", min: 1, max: Infinity, int: true },
  route_chars: { limit: "routeChars", min: 1, max: Infinity, int: true },
} as const;
export type JudgeSettingName = keyof typeof JUDGE_SETTINGS;

export type JudgeConfig = { url: string; key?: string; model: string; routeYes: number; dupYes: number; routeCandidates: number; dupCandidates: number; routeChars: number };

const warnedEnv = new Set<string>();
function setting(name: JudgeSettingName, own: number | null | undefined): number {
  const s = JUDGE_SETTINGS[name];
  if (own != null) return own;
  const env = `CORTEX_JUDGE_${name.toUpperCase()}`, raw = process.env[env]?.trim();
  if (raw) {
    const v = Number(raw);
    if (Number.isFinite(v) && v >= s.min && v <= s.max && (!s.int || Number.isInteger(v))) return v;
    if (!warnedEnv.has(env)) { warnedEnv.add(env); warn(`$${env}="${raw}" ignored: expected ${s.int ? "an integer" : "a number"} ${s.max === 1 ? "between 0 and 1" : `of at least ${s.min}`}.`); }
  }
  return LIMITS[s.limit];
}

/**
 * The effective `judge` settings, undefined when the feature is off. Server: `judge.base_url`, else $CORTEX_JUDGE_BASE_URL
 * (a hosted System One such as TypeSafe's Jev), else the same rule as `embed`. $CORTEX_JUDGE_API_KEY only goes to
 * $CORTEX_JUDGE_BASE_URL (or a `judge.base_url` equal to it), as $CORTEX_ASK_API_KEY for `site_ask`. Model: `judge.model`,
 * else $CORTEX_JUDGE_MODEL, else d3-mini. The other settings: JUDGE_SETTINGS.
 */
export async function judgeConfig(root: string): Promise<JudgeConfig | undefined> {
  const c = await loadConfig(root).catch(() => undefined);
  if (!c?.judge) return;
  const j = c.judge, own = j.base_url?.replace(/\/+$/, ""), env = process.env.CORTEX_JUDGE_BASE_URL?.replace(/\/+$/, "");
  const settings = {
    model: j.model ?? (process.env.CORTEX_JUDGE_MODEL?.trim() || "d3-mini"),
    routeYes: setting("route_yes", j.route_yes), dupYes: setting("dup_yes", j.dup_yes),
    routeCandidates: setting("route_candidates", j.route_candidates), dupCandidates: setting("dup_candidates", j.dup_candidates),
    routeChars: setting("route_chars", j.route_chars),
  };
  if (env && (!own || own === env)) return { url: env, key: process.env.CORTEX_JUDGE_API_KEY, ...settings };
  return { ...endpoint(c, j.base_url ?? undefined), ...settings };
}

let warned = false;
const downUntil = new Map<string, number>(); // by server: a long-lived `cortex mcp` tries again after `downMs`

/**
 * Answers of the judge to `questions` (by id, all asked in one call: they see the same `state`, independently), or
 * undefined when it is not available: no `judge` config, server down or slow (one warning, then left alone for `downMs`),
 * unreadable answer.
 */
export async function judge(root: string, state: unknown, questions: Record<string, Question>, timeoutMs: number = JUDGE.timeoutMs, what = "judge"): Promise<Record<string, Answer> | undefined> {
  const cfg = await judgeConfig(root);
  const n = Object.keys(questions).length;
  if (!cfg || !n) return;
  const call = `judge: ${what}, ${cfg.model} at ${host(cfg.url)}, ${n} question${n > 1 ? "s" : ""}`;
  if (Date.now() < (downUntil.get(cfg.url) ?? 0)) { note(`${call}: skipped (server down a moment ago)`); return; }
  const t0 = performance.now();
  try {
    const res = await fetch(`${cfg.url}/systemone`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cfg.key && { authorization: `Bearer ${cfg.key}` }) },
      body: JSON.stringify({ model: cfg.model, state, questions }),
      signal: AbortSignal.timeout(timeoutMs), timeout: false,
    });
    if (!res.ok) throw new Error(`${cfg.url} answered ${res.status}`);
    const body = (await res.json()) as { answers?: Record<string, Answer>; usage?: { input_tokens?: number } };
    const answers = body.answers;
    for (const [id, q] of Object.entries(questions)) {
      const a = answers?.[id];
      if (a?.type !== q.type || (a.type === "noul" ? typeof a.noul !== "number" : !a.probabilities)) throw new Error(`${cfg.url}: no usable answer for a ${q.type} question`);
    }
    note(`${call}, ${secs(t0)}${body.usage?.input_tokens != null ? `, ${body.usage.input_tokens} tokens` : ""}: ${Object.entries(answers!).map(([id, a]) => `${id} ${brief(a)}`).join(", ")}`);
    return answers;
  } catch (e) {
    note(`${call}, ${secs(t0)}: failed (${(e as Error).message})`);
    downUntil.set(cfg.url, Date.now() + JUDGE.downMs);
    if (!warned) { warned = true; warn(`judge: ${(e as Error).message}. Going on without it.`); }
  }
}

// --- One log line per call on stderr (CI logs; stdout stays the command's output, and cortex mcp's protocol)
const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };
const secs = (t0: number) => `${((performance.now() - t0) / 1000).toFixed(2)} s`;
const brief = (a: Answer) => a.type === "noul" ? a.noul.toFixed(2) : `${a.choice} (${(a.probabilities[a.choice] ?? 0).toFixed(2)})`;

/** The state text cut to what the model takes. */
export const clip = (s: string, n: number = JUDGE.stateChars) => s.length > n ? `${s.slice(0, n)}…` : s;
