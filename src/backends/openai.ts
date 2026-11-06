import { interactiveWith, type Backend, type Config } from "./backend";
import { LIMITS } from "../limits";
import { callTool, toolPack } from "./tools";

export { part } from "./tools";

// --- Any OpenAI-compatible API (Ollama, llama.cpp, LM Studio, vLLM, OpenRouter…): cortex runs the agent loop itself.
// The tools are the cortex pack (tools.ts), the same as every other backend gets over MCP.

/**
 * `effort none` turns thinking off (Qwen3, DeepSeek…): the chat-template switch (vLLM, llama.cpp, OVMS) and Ollama's
 * `think`; servers ignore the field they do not know. Any other effort is sent as `reasoning_effort`.
 */
export const thinking = (effort?: string) =>
  effort === "none" ? { chat_template_kwargs: { enable_thinking: false }, think: false } : effort ? { reasoning_effort: effort } : {};

/** llama.cpp reuses the KV cache of the prompt prefix (`cache_prompt`). OpenAI rejects unknown parameters, the other servers ignore this one. */
export const cache = (cfg: Config) => (new URL(baseUrl(cfg)).hostname === "api.openai.com" ? {} : { cache_prompt: true });

/** What the model is told when its tool calls were cut by the output limit: nothing ran, write in smaller parts. */
const CUT = `Your last answer exceeded the output limit (${LIMITS.llmMaxTokens} tokens) and was cut: none of its tool calls ran. ` +
  "Send fewer calls at once, and write a long page in parts: WritePage with the start, then Append for the rest.";

/** Base URL: `base_url` of cortex.json, else $OPENAI_BASE_URL, else a local Ollama. */
export const baseUrl = (cfg: Config) => (cfg.base_url ?? process.env.OPENAI_BASE_URL ?? "http://localhost:11434/v1").replace(/\/+$/, "");

export default function openai(cfg: Config): Backend {
  return {
    // no CLI to start: interactive only through $CORTEX_AGENT
    interactive: interactiveWith(() => { throw new Error("the openai client runs in batch only: use --batch (or set $CORTEX_AGENT)."); }),
    async run(root, prompt, mode, report, check) {
      if (!cfg.model) throw new Error(`the openai client needs a model: cortex config set model <name>.`);
      const { schemaText } = await import("../schema");
      const tools = toolPack(mode).map((t) => ({ type: "function", function: t }));
      const messages: any[] = [{ role: "system", content: await schemaText(root) }, { role: "user", content: prompt }];
      // secret: environment only. Never sent to a base_url that only cortex.json names: a cloned wiki could point it at any host.
      const key = !cfg.base_url || cfg.base_url === process.env.OPENAI_BASE_URL ? process.env.OPENAI_API_KEY : undefined;
      let fixes = 0, cuts = 0, text = ""; // text: the parts of a final answer cut by the output limit
      for (let turn = 0; turn < LIMITS.agentTurns; turn++) {
        // before the request, not after a 400: one rewrite of the old results when the context nears its budget, so the
        // server's prompt cache keeps the prefix on the turns in between
        if (nearFull(messages) && elide(messages)) report?.({ level: "info", text: "context nearly full: old tool results elided", mark: "  ↻" });
        const res = await fetch(`${baseUrl(cfg)}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(key && { authorization: `Bearer ${key}` }) },
          body: JSON.stringify({ model: cfg.model, messages, tools, max_tokens: LIMITS.llmMaxTokens, ...cache(cfg), ...thinking(cfg.effort) }),
          signal: AbortSignal.timeout(LIMITS.llmRequestMs), timeout: false, // Bun cuts a fetch at 5 min by default: llmRequestMs decides
        });
        if (!res.ok) {
          const t = await res.text();
          // llama.cpp answers 500 when a cut answer leaves the tool arguments unreadable: same as finish_reason "length"
          if (res.status === 500 && /parse tool call arguments/i.test(t) && cuts++ < LIMITS.cutRetries) { messages.push({ role: "user", content: CUT }); continue; }
          // context full (llama.cpp's n_ctx): the old tool results go, the model can read them again; then retry
          if (res.status === 400 && /context/i.test(t) && elide(messages)) { report?.({ level: "info", text: "context full: old tool results elided", mark: "  ↻" }); continue; }
          // "does not support tools" (Ollama…): the model is the problem; any other body is cut, a runaway answer can be huge
          const hint = /(not|n't) support.{0,20}tool/i.test(t) ? " (the model must support tool calling)" : "";
          throw new Error(`${baseUrl(cfg)} answered ${res.status}: ${t.length > 300 ? `${t.slice(0, 300)}…` : t}${hint}`);
        }
        const body = await res.json();
        const msg = body.choices?.[0]?.message;
        if (!msg) throw new Error(`${baseUrl(cfg)}: answer without a message: ${JSON.stringify(body).slice(0, 300)}`);
        if (body.choices[0].finish_reason === "length") {
          // nothing of a cut answer is used as is: its tool calls may be incomplete, its text goes on in the next turn
          if (cuts++ >= LIMITS.cutRetries) throw new Error(`the model's answer exceeded ${LIMITS.llmMaxTokens} tokens ${LIMITS.cutRetries} times: raise LIMITS.llmMaxTokens.`);
          if (msg.tool_calls?.length) { messages.push({ role: "user", content: CUT }); continue; }
          text += msg.content ?? "";
          messages.push({ role: "assistant", content: msg.content ?? "" }, { role: "user", content: "Your answer was cut by the output limit. Continue exactly where it stopped, without repeating anything." });
          continue;
        }
        messages.push(msg);
        if (!msg.tool_calls?.length) {
          // the command's check (lint of the pages changed, compile's citation), fixed in this conversation: cheaper than a new run
          const errors = check && fixes < LIMITS.lintFixPasses ? await check() : [];
          if (!errors.length) return text + (msg.content ?? "");
          fixes++;
          report?.({ level: "info", text: `${errors.length} error(s), sent back to the model (pass ${fixes}/${LIMITS.lintFixPasses})`, mark: "  ↻" });
          messages.push({ role: "user", content: `The work is not complete (cortex lint and the compile check). Fix them with Edit or Write, then answer again:\n${errors.join("\n")}` });
          continue;
        }
        for (const c of msg.tool_calls) {
          let args: Record<string, any>;
          try { args = JSON.parse(c.function.arguments || "{}"); } catch (e) { args = {}; messages.push({ role: "tool", tool_call_id: c.id, content: `error: ${(e as Error).message}` }); continue; }
          const content = await callTool(root, mode, c.function.name, args, (reason) => report?.({ level: "warn", text: `refused: ${reason}`, mark: "  ⊘" }));
          messages.push({ role: "tool", tool_call_id: c.id, content });
        }
      }
      throw new Error(`openai agent stopped after ${LIMITS.agentTurns} turns.`);
    },
  };
}

/** Empties the tool results but the last two (read again if needed); false when nothing is left to elide. */
// ponytail: elides on the server's refusal, no token count; count tokens if a backend cuts silently instead
export function elide(messages: any[]): boolean {
  const tools = messages.filter((m) => m.role === "tool").slice(0, -2).filter((m) => m.content.length > 200);
  for (const m of tools) m.content = "[elided to free the context: call the tool again if you still need this]";
  return tools.length > 0;
}

/** Rough token count of the conversation (~3.5 characters per token: enough to act before the server refuses). */
export const estimateTokens = (messages: any[]) => Math.ceil(JSON.stringify(messages).length / 3.5);

/** Is the conversation above 80% of the context budget (LIMITS.llmContextTokens by default)? */
export const nearFull = (messages: any[], budget: number = LIMITS.llmContextTokens) => estimateTokens(messages) > budget * 0.8;
