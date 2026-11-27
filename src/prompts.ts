import { LIMITS } from "./limits";
import { join } from "node:path";
import PROMPTS from "./prompts.md" with { type: "text" }; // embedded: a compiled binary has no src/ next to it
import { DEFAULT_LANGUAGE } from "./schema";

let cache: Map<string, string> | undefined;
/** `## name` sections of prompts.md, trimmed (text before the first heading is ignored). */
function sections(): Map<string, string> {
  if (cache) return cache;
  const m = new Map<string, string>();
  for (const part of PROMPTS.split(/^## /m).slice(1)) {
    const nl = part.indexOf("\n");
    m.set(part.slice(0, nl).trim(), part.slice(nl + 1).trim());
  }
  return (cache = m);
}

/** Fills `{{key}}` in one pass (values are never re-expanded: a question may contain "{{language}}"); unknown keys stay as is. */
const fill = (t: string, vars: Record<string, string>) => t.replace(/\{\{(\w+)\}\}/g, (m, k: string) => vars[k] ?? m);

/** Prompt section `name`, placeholders filled. */
export function prompt(name: string, vars: Record<string, string>): string {
  const t = sections().get(name);
  if (t === undefined) throw new Error(`prompt not found: ${name}`);
  return fill(t, vars);
}

const lang = (language?: string) => language ?? DEFAULT_LANGUAGE;

/** Header prepended to every agent prompt: root, wiki language, and write scope (read-only unless `write`). */
export function scopePrefix(root: string, write: boolean, language?: string): string {
  const vars = { root, wiki: join(root, "wiki"), language: lang(language) };
  return `${prompt("root", vars)} ${prompt(write ? "scope-write" : "scope-read", vars)} `;
}

/** Header of a question that reads several spaces (instance root, the spaces, read-only): in place of `scopePrefix`. */
export function spacesPrefix(root: string, spaces: string[], language?: string): string {
  return `${prompt("root-spaces", { root, spaces: spaces.join(", "), language: lang(language) })} ${prompt("scope-read", {})} `;
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

/** QUERY prompt of a question that reads several spaces: read-only, citations carry the space. */
export const askSpacesPrompt = (o: { agentFile: string; question: string }) => prompt("ask-spaces", { agentFile: o.agentFile, question: o.question });
/** System prompt of the SDK clients for a question that reads several spaces, in place of the wiki schema. */
export const askSpacesSystem = (spaces: string[], language?: string) => prompt("ask-spaces-system", { spaces: spaces.join(", "), language: lang(language) });

/** Site question (cortex serve): read-only; `pages` and `history` are built by ask-site.ts (the pages up front save the cheap model some turns). */
export const askSitePrompt = (o: { question: string; pages: string; history?: string; blocks?: boolean; language?: string; spaces?: string[] }) =>
  prompt("ask-site", { question: o.question, pages: o.pages, history: o.history ?? "", blocks: o.blocks ? prompt("ask-site-blocks", {}) : "", language: lang(o.language) }).replace(/\n{3,}/g, "\n\n")
  + (o.spaces ? `\n\n${prompt("ask-site-spaces", { spaces: o.spaces.join(", ") })}` : "");

/** System prompt of the site's agent, in place of the wiki schema: what the wiki is and how to link its pages. */
export const askSiteSystem = (language?: string, spaces?: string[]) => spaces ? prompt("ask-site-spaces-system", { spaces: spaces.join(", "), language: lang(language) }) : prompt("ask-site-system", { language: lang(language) });

/** `instructions` string of the MCP server, in the wiki language. */
export const mcpInstructions = (language?: string) => prompt("mcp-instructions", { language: lang(language) });
