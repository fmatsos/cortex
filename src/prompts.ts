import { LIMITS } from "./limits";
import { join } from "node:path";
import PROMPTS from "./prompts.md" with { type: "text" }; // embedded: a compiled binary has no src/ next to it
import PIPELINE from "./pipeline.md" with { type: "text" };
import { DEFAULT_LANGUAGE } from "./schema";

const cached = new Map<string, Map<string, string>>();
/** `## name` sections of a prompts file (prompts.md, pipeline.md), trimmed (text before the first heading is ignored). */
function sections(text = PROMPTS): Map<string, string> {
  const hit = cached.get(text);
  if (hit) return hit;
  const m = new Map<string, string>();
  for (const part of text.split(/^## /m).slice(1)) {
    const nl = part.indexOf("\n");
    m.set(part.slice(0, nl).trim(), part.slice(nl + 1).trim());
  }
  cached.set(text, m);
  return m;
}

/** Fills `{{key}}` in one pass (values are never re-expanded: a question may contain "{{language}}"); unknown keys stay as is. */
const fill = (t: string, vars: Record<string, string>) => t.replace(/\{\{(\w+)\}\}/g, (m, k: string) => vars[k] ?? m);

/** Prompt section `name`, placeholders filled. */
export function prompt(name: string, vars: Record<string, string>): string {
  const t = sections().get(name);
  if (t === undefined) throw new Error(`prompt not found: ${name}`);
  return fill(t, vars);
}

/** Instructions of a pipeline step (src/pipeline.md, `## name`), placeholders filled: the `system` message of the call. */
export function pipelinePrompt(name: string, vars: Record<string, string>): string {
  const t = sections(PIPELINE).get(name);
  if (t === undefined) throw new Error(`pipeline prompt not found: ${name}`);
  return fill(t, vars);
}

const lang = (language?: string) => language ?? DEFAULT_LANGUAGE;

/** Header prepended to every agent prompt: root, wiki language, and write scope (read-only unless `write`). */
export function scopePrefix(root: string, write: boolean, language?: string): string {
  const vars = { root, wiki: join(root, "wiki"), language: lang(language) };
  return `${prompt("root", vars)} ${prompt(write ? "scope-write" : "scope-read", vars)} `;
}

/** INGEST prompt for one raw source (`source` = its /raw/… resource path). */
export function compilePrompt(o: { agentFile: string; source: string; id: string; batch?: boolean; language?: string; page?: string; tags?: string[]; maxTags?: number; candidates?: string[] }): string {
  const vars = { agentFile: o.agentFile, source: o.source, id: o.id, language: lang(o.language), page: o.page ?? "", tags: o.tags?.length ? o.tags.join(", ") : "none yet", maxTags: String(o.maxTags ?? LIMITS.maxTags),
    candidates: o.candidates?.length ? ` Pages the source probably updates (judged by meaning; look at them before creating any page): ${o.candidates.join("; ")}.` : "" };
  return `${prompt("compile", vars)} ${prompt(o.batch ? "compile-batch" : "compile-interactive", vars)}${o.page ? ` ${prompt("compile-prepared", vars)}` : ""}`;
}

/** QUERY prompt; `file` allows storing the answer as a Synthesis page, otherwise the agent only answers. */
export function askPrompt(o: { agentFile: string; question: string; file?: boolean; language?: string }): string {
  const vars = { agentFile: o.agentFile, question: o.question, language: lang(o.language) };
  return `${prompt("ask", vars)} ${prompt(o.file ? "ask-file" : "ask-read", vars)}`;
}

/** `instructions` string of the MCP server, in the wiki language. */
export const mcpInstructions = (language?: string) => prompt("mcp-instructions", { language: lang(language) });
