import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { endpoint, type Config } from "./config";
import { DEFAULT_LANGUAGE } from "./schema";
import { LIMITS } from "./limits";
import { prompt } from "./prompts";

/** Image kinds `add` reads: the media type by the file's own first bytes (a name proves nothing), with the extension it is saved under. */
export function imageType(b: Uint8Array): { mime: string; ext: string } | undefined {
  const at = (o: number, s: string) => s.split("").every((c, i) => b[o + i] === c.charCodeAt(0));
  if (b[0] === 0x89 && at(1, "PNG\r\n\x1a\n")) return { mime: "image/png", ext: "png" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (at(0, "RIFF") && at(8, "WEBP")) return { mime: "image/webp", ext: "webp" };
  if (at(0, "GIF87a") || at(0, "GIF89a")) return { mime: "image/gif", ext: "gif" };
}

/**
 * `<client>:<model>`, the `extractor` of an image source: the model of the installation (`client`, `model`, `base_url` of cortex.json) describes it.
 * Throws when it cannot: no client, or one with no way to take an image (opencode).
 */
export function imageModel(cfg: Config): string {
  if (!cfg.client) throw new Error("an image is described by the model of the installation, and no client is set: cortex config set client openai|claude|codex (with the model, and base_url for openai).");
  if (cfg.client === "opencode") throw new Error("the opencode client cannot take an image: use the openai, claude or codex client to add images.");
  if (cfg.client === "openai" && !cfg.model) throw new Error("the openai client needs a model to describe an image: cortex config set model <name> (a multimodal one).");
  return `${cfg.client}:${cfg.model ?? "default"}`;
}

/**
 * The model's description of an image (Markdown: `# title`, the description, `## Text`), by the client of the installation: one
 * request, no tool. Throws when the model cannot be reached or answers nothing; the caller writes nothing then.
 */
export async function describeImage(bytes: Uint8Array, mime: string, cfg: Config): Promise<string> {
  imageModel(cfg);
  const text = prompt("describe-image", { language: cfg.language ?? DEFAULT_LANGUAGE });
  const b64 = Buffer.from(bytes).toString("base64");
  const out = cfg.client === "openai" ? await viaOpenai(text, mime, b64, cfg) : cfg.client === "claude" ? await viaClaude(text, mime, b64, cfg) : await viaCodex(text, bytes, mime, cfg);
  if (!out.trim()) throw new Error(`${imageModel(cfg)} described nothing: is the model multimodal?`);
  return out;
}

/** An OpenAI-compatible server: one chat completion with the image as a data URL part (the endpoint and the key as the openai client has them). */
async function viaOpenai(text: string, mime: string, b64: string, cfg: Config): Promise<string> {
  const { cache, route, thinking } = await import("./backends/openai");
  const { url, key } = endpoint(cfg);
  const res = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key && { authorization: `Bearer ${key}` }) },
    body: JSON.stringify({
      model: cfg.model, max_tokens: LIMITS.llmMaxTokens, ...cache(url), ...route(url), ...thinking(cfg.effort),
      messages: [{ role: "user", content: [{ type: "text", text }, { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }] }],
    }),
    signal: AbortSignal.timeout(LIMITS.llmRequestMs), timeout: false, // Bun cuts a fetch at 5 min by default: llmRequestMs decides
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`${url} answered ${res.status}: ${t.length > 300 ? `${t.slice(0, 300)}…` : t}`); }
  const body = await res.json();
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error(`${url}: answer without a message: ${JSON.stringify(body).slice(0, 300)}`);
  return content;
}

/** The Claude Agent SDK: a user message with an image block, no tool offered, one turn, no settings file loaded, run from an empty folder. */
async function viaClaude(text: string, mime: string, b64: string, cfg: Config): Promise<string> {
  const { cli, load } = await import("./backends/backend");
  const { query } = await load<typeof import("@anthropic-ai/claude-agent-sdk")>("@anthropic-ai/claude-agent-sdk", () => import("@anthropic-ai/claude-agent-sdk"));
  const message = { role: "user" as const, content: [{ type: "image" as const, source: { type: "base64" as const, media_type: mime as "image/png", data: b64 } }, { type: "text" as const, text }] };
  const dir = mkdtempSync(join(tmpdir(), "cortex-image-"));
  try {
    let out: string | undefined;
    for await (const m of query({
      prompt: (async function* () { yield { type: "user" as const, message, parent_tool_use_id: null }; })(),
      options: { cwd: dir, model: cfg.model, effort: cfg.effort as any, pathToClaudeCodeExecutable: cli("claude"), settingSources: [], tools: [], allowedTools: [], maxTurns: 1 },
    })) {
      if (m.type !== "result") continue;
      if (m.subtype !== "success") throw new Error(`Claude agent failed (${m.subtype})`);
      out = m.result;
    }
    return out ?? "";
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** The Codex SDK: the image as a local file (`local_image`) in an empty folder that is the thread's whole workspace, read-only sandbox, shell off. */
async function viaCodex(text: string, bytes: Uint8Array, mime: string, cfg: Config): Promise<string> {
  const { cli, load } = await import("./backends/backend");
  const { Codex } = await load<typeof import("@openai/codex-sdk")>("@openai/codex-sdk", () => import("@openai/codex-sdk"));
  const dir = mkdtempSync(join(tmpdir(), "cortex-image-"));
  try {
    const path = join(dir, `image.${imageType(bytes)?.ext ?? mime.split("/")[1]}`);
    await Bun.write(path, bytes);
    const thread = new Codex({ codexPathOverride: cli("codex"), config: { features: { shell_tool: false } } as any }).startThread({
      workingDirectory: dir, sandboxMode: "read-only", approvalPolicy: "never", skipGitRepoCheck: true, model: cfg.model, modelReasoningEffort: cfg.effort as any,
    });
    return (await thread.run([{ type: "text", text }, { type: "local_image", path }])).finalResponse;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
