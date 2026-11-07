import { endpoint, loadConfig } from "./config";
import { warn } from "./style";

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
export type JudgeConfig = { url: string; key?: string; model: string };

/** The effective `judge` settings, undefined when the feature is off. Same base_url and key rule as `embed`. */
export async function judgeConfig(root: string): Promise<JudgeConfig | undefined> {
  const c = await loadConfig(root).catch(() => undefined);
  if (!c?.judge) return;
  return { ...endpoint(c, c.judge.base_url ?? undefined), model: c.judge.model ?? "d3-mini" };
}

let warned = false;
const downUntil = new Map<string, number>(); // by server: a long-lived `cortex mcp` tries again after `downMs`

/**
 * Answers of the judge to `questions` (by id, all asked in one call: they see the same `state`, independently), or
 * undefined when it is not available: no `judge` config, server down or slow (one warning, then left alone for `downMs`),
 * unreadable answer.
 */
export async function judge(root: string, state: unknown, questions: Record<string, Question>, timeoutMs: number = JUDGE.timeoutMs): Promise<Record<string, Answer> | undefined> {
  const cfg = await judgeConfig(root);
  if (!cfg || !Object.keys(questions).length || Date.now() < (downUntil.get(cfg.url) ?? 0)) return;
  try {
    const res = await fetch(`${cfg.url}/systemone`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cfg.key && { authorization: `Bearer ${cfg.key}` }) },
      body: JSON.stringify({ model: cfg.model, state, questions }),
      signal: AbortSignal.timeout(timeoutMs), timeout: false,
    });
    if (!res.ok) throw new Error(`${cfg.url} answered ${res.status}`);
    const answers = ((await res.json()) as { answers?: Record<string, Answer> }).answers;
    for (const [id, q] of Object.entries(questions)) {
      const a = answers?.[id];
      if (a?.type !== q.type || (a.type === "noul" ? typeof a.noul !== "number" : !a.probabilities)) throw new Error(`${cfg.url}: no usable answer for a ${q.type} question`);
    }
    return answers;
  } catch (e) {
    downUntil.set(cfg.url, Date.now() + JUDGE.downMs);
    if (!warned) { warned = true; warn(`judge: ${(e as Error).message}. Going on without it.`); }
  }
}

/** The state text cut to what the model takes. */
export const clip = (s: string, n: number = JUDGE.stateChars) => s.length > n ? `${s.slice(0, n)}…` : s;
