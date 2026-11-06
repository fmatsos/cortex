import { z } from "zod";
import { cache, metrics, thinking, tokens } from "./backends/openai";
import { endpoint, type Config } from "./config";
import { LIMITS } from "./limits";
import type { Report } from "./print";

// --- One structured call to the local OpenAI-compatible server (llama.cpp): JSON constrained by a grammar, checked by zod.
// Every pipeline step (docs/PIPELINE.md §2) goes through `structured`: independent call, no history, thinking always off.

export interface StructuredCall<T> {
  /** Name of the schema (`json_schema.name`) and of the step in the metrics. */
  name: string;
  /** Instructions of the step: constant, so that the server's prompt cache keeps the prefix. */
  system: string;
  /** The matter of the call: variable. */
  user: string;
  /** JSON Schema of the answer, sent to the server (grammar). Default: derived from `zod`. */
  schema?: object;
  /** What cortex checks after the grammar: shape plus the rules the grammar cannot carry. */
  zod: z.ZodType<T>;
  maxTokens: number;
  /** Raw id of the source being compiled, for the metrics. */
  source?: string;
  /** Receives the notices (fallback to a weaker `response_format`). */
  report?: Report;
}

/** Keywords llama.cpp's schema converter may refuse (`pattern`…): the schema goes again without them, zod checks them anyway. */
const UNSUPPORTED = new Set(["pattern", "minLength", "minimum"]);

/** The schema without `pattern`, `minLength` and `minimum` (a property named like one is left alone: its value is a schema). */
export function stripSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripSchema);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(Object.entries(node).filter(([k, v]) => !(UNSUPPORTED.has(k) && typeof v !== "object")).map(([k, v]) => [k, stripSchema(v)]));
}

/** JSON of an answer; tolerates a fence or a sentence around it (servers without a grammar). */
function parse(text: string): unknown {
  try { return JSON.parse(text); } catch (e) {
    const [a, b] = [text.indexOf("{"), text.lastIndexOf("}")];
    if (a < 0 || b < a) throw e;
    return JSON.parse(text.slice(a, b + 1));
  }
}

const problems = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);

/**
 * Asks the model for a JSON object that satisfies `schema` and `zod`, and returns it validated. An invalid, incomplete or
 * cut answer is asked again with the list of its errors (`LIMITS.pipelineRetries` times), then the call throws. Thinking is
 * always off: with a grammar the model reasons for hundreds of tokens first, or never stops (WP0). `seed` is sent but no
 * logic relies on it: the server's output is not reproducible.
 */
export async function structured<T>(cfg: Config, c: StructuredCall<T>): Promise<T> {
  if (!cfg.model) throw new Error("the pipeline needs a model: cortex config set model <name>.");
  const { url, key } = endpoint(cfg);
  const full = c.schema ?? z.toJSONSchema(c.zod);
  const stripped = stripSchema(full);
  // response_format, from the strictest to the weakest: the schema, the schema without the keywords the server may refuse, a bare JSON object
  const modes = ["json_schema", ...(JSON.stringify(stripped) !== JSON.stringify(full) ? ["stripped"] : []), "json_object"] as const;
  let mode = 0;
  const messages: { role: string; content: string }[] = [{ role: "system", content: c.system }, { role: "user", content: c.user }];
  const format = () => modes[mode] === "json_object" ? { type: "json_object" }
    : { type: "json_schema", json_schema: { name: c.name, schema: modes[mode] === "stripped" ? stripped : full, strict: true } };

  const t0 = Date.now(), sum = { prompt_tokens: 0, cached_tokens: 0, completion_tokens: 0, prompt_ms: 0, predicted_ms: 0 };
  let retries = 0, ok = false, serverRetried = false, errors: string[] = [];
  try {
    for (;;) {
      const res = await fetch(`${url}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(key && { authorization: `Bearer ${key}` }) },
        body: JSON.stringify({
          model: cfg.model, messages, temperature: 0, seed: 7, max_tokens: c.maxTokens, response_format: format(),
          ...cache(cfg), ...thinking("none"),
        }),
        signal: AbortSignal.timeout(LIMITS.llmRequestMs), timeout: false, // Bun cuts a fetch at 5 min by default: llmRequestMs decides
      });
      if (!res.ok) {
        const t = await res.text();
        // the server refuses the schema (unsupported keyword, no json_schema at all): a weaker format, not a retry. A full context is not that.
        // A 500 or 503 is the server's trouble, not the schema's: the same request once more, then the failure.
        if ([500, 503].includes(res.status) && !serverRetried) { serverRetried = true; continue; }
        if ([400, 422].includes(res.status) && !/context/i.test(t) && mode < modes.length - 1) {
          mode++;
          if (modes[mode] === "json_object") {
            messages[0] = { role: "system", content: `${c.system}\n\nAnswer with one JSON object that matches this JSON Schema, and nothing else:\n${JSON.stringify(full)}` };
            c.report?.({ level: "warn", text: `${url} refuses response_format json_schema: json_object and validation by cortex (${c.name})`, mark: "  ⚠" });
          }
          continue;
        }
        throw new Error(`${url} answered ${res.status}: ${t.length > 300 ? `${t.slice(0, 300)}…` : t}`);
      }
      const body = await res.json();
      const n = tokens(body);
      for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += n[k] ?? 0;
      const choice = body.choices?.[0];
      if (!choice?.message) throw new Error(`${url}: answer without a message: ${JSON.stringify(body).slice(0, 300)}`);
      const text: string = choice.message.content ?? "";

      let next: { role: string; content: string }[];
      if (choice.finish_reason === "length") {
        errors = [`cut by the output limit (${c.maxTokens} tokens)`];
        next = [{ role: "user", content: `Your last answer was cut by the output limit (${c.maxTokens} tokens). Answer again, shorter: fewer items, shorter strings.` }];
      } else {
        let value: unknown, bad: string[] = [];
        try { value = parse(text); } catch (e) { bad = [text.trim() ? `not valid JSON: ${(e as Error).message}` : "empty answer"]; }
        if (!bad.length) {
          const r = c.zod.safeParse(value);
          if (r.success) { ok = true; return r.data; }
          bad = problems(r.error);
        }
        errors = bad;
        next = [{ role: "assistant", content: text }, { role: "user", content: `Your answer is not valid:\n${bad.map((e) => `- ${e}`).join("\n")}\nAnswer again with the corrected JSON object only.` }];
      }
      if (retries >= LIMITS.pipelineRetries) throw new Error(`${c.name}: no valid answer after ${retries + 1} attempts: ${errors.slice(0, 5).join("; ")}`);
      retries++;
      messages.push(...next);
    }
  } finally {
    metrics({ source: c.source, step: c.name, model: cfg.model, ...sum, ms: Date.now() - t0, retries, ok });
  }
}
