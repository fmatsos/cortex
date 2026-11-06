import { z } from "zod";
import { estimateTokens } from "./chunk";
import { type Fact, normalizeNotes } from "./cite";
import type { Config } from "./config";
import { structured } from "./llm";
import type { Report } from "./print";
import { pipelinePrompt } from "./prompts";

// --- The model's writing steps (docs/PIPELINE.md §2.5, §2.6, §2.8): `write` a new page, `update` an existing one (the
// model only adds, `mergeUpdate` in merge.ts applies it), `repair` a body. One independent call each, the model sees
// text and numbered lists, never paths. What it writes is cleaned before it is believed.

/** A page the model may mention as `[[p:N]]` (N = its index in the list): `path` is known once the page exists. */
export type PageRef = { title: string; path?: string };

// Bounds of §2.5, §2.6 and §2.8: input a page of the prompt, output in tokens, text in characters (the grammar cuts at maxLength, so they stay wide).
const BODY = { min: 300, max: 6000, tokens: 1200 };
const ADD = { min: 100, max: 2500, tokens: 800, contradiction: 400 };
const REPAIR = { max: 8000, tokens: 2000 };
/** Tokens of an existing page given whole to `update`; beyond, its list of sections and its beginning. */
const PAGE_TOKENS = 3000;
const LISTED = 30;

const WriteJson = { type: "object", additionalProperties: false, required: ["body"], properties: { body: { type: "string", minLength: BODY.min, maxLength: BODY.max } } };
const UpdateJson = {
  type: "object", additionalProperties: false, required: ["section", "addition", "contradiction"],
  properties: { section: { type: "string", maxLength: 80 }, addition: { type: "string", minLength: ADD.min, maxLength: ADD.max }, contradiction: { type: ["string", "null"], maxLength: ADD.contradiction } },
};
const RepairJson = { type: "object", additionalProperties: false, required: ["body"], properties: { body: { type: "string", maxLength: REPAIR.max } } };

/** Link to a wiki page or to a raw file written by the model, which knows no path: the text stays, `[Title](/wiki/…md)` goes. An external link (`https://…`, `mailto:`), even to a `.md` file, is left alone. */
const LINK = /\[([^\]]*)\]\((?:(?![a-z][a-z0-9+.-]*:|\/\/)[^)\s]*\.md(?:#[^)\s]*)?|(?:\.{1,2}\/)*\/?(?:wiki|raw)\/[^)\s]*)\)/g;

/**
 * A text written by the model, made safe: frontmatter, a leading `#` title and note definitions removed (cortex writes
 * those), links to wiki or raw files reduced to their text, `[[p:N]]` kept when N < `pages` (spaces allowed) and removed
 * otherwise, every `[^x]` pointed at `id`. `notes` = how many notes the text carries.
 */
export function tidy(text: string, id: string, pages: number): { text: string; notes: number } {
  const t = text.replace(/^\s*---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "").replace(/^\s*# [^\n]*\n/, "").replace(/^\[\^[\w-]+\]:.*$/gm, "")
    .replace(LINK, "$1").replace(/\[\[\s*p\s*:\s*(\d+)\s*\]\]/g, (_, n) => (Number(n) < pages ? `[[p:${Number(n)}]]` : "")).trim();
  const r = normalizeNotes(t, id);
  return { text: r.body, notes: r.count };
}

/** Turns `[[p:N]]` into `[Title](/wiki/…md)` (the form `weave` writes) once the paths are known; a page without a path becomes its plain title, an unknown N disappears. */
export function linkPages(text: string, pages: PageRef[]): string {
  return text.replace(/\[\[p:(\d+)\]\]/g, (_, n) => {
    const p = pages[Number(n)];
    if (!p) return "";
    const title = p.title.replace(/[[\]]/g, "");
    return p.path ? `[${title}](/${p.path})` : title;
  });
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const facts = (fs: Fact[]) => fs.map((f, i) => `${i + 1}. ${one(f.claim)} — source: «${one(f.quote).replace(/"/g, "'")}»`).join("\n");

/** True for the failure of `structured` that left a parsed answer we may still use (the checks of ours that kept failing). */
const exhausted = (e: unknown) => /no valid answer/.test(String((e as Error)?.message));

export type Written = { body: string; /** The body carries the note: false = cortex still creates the page (draft), lint will say so (§2.5). */ noted: boolean };

/**
 * `write`: the body of a new page. `pages` are the titles the model may mention as `[[p:N]]`; `id` is the note it ends
 * its sentences with. A body that never carried the note (or stayed short) after the retries is returned all the same,
 * with `noted: false`; any other failure throws.
 */
export async function writePage(cfg: Config, o: { kind: string; title: string; description?: string; facts: Fact[]; id: string; pages?: PageRef[]; language: string; source?: string; report?: Report }): Promise<Written> {
  const pages = o.pages ?? [];
  let last: { text: string; notes: number } | undefined;
  const zod = z.object({ body: z.string() }).superRefine((v, ctx) => {
    const t = (last = tidy(v.body, o.id, pages.length));
    const add = (message: string) => ctx.addIssue({ code: "custom", path: ["body"], message });
    if (v.body.length > BODY.max) add(`too long (${v.body.length} characters, at most ${BODY.max})`);
    else if (t.text.length < BODY.min) add(`too short (${t.text.length} characters, at least ${BODY.min}): develop the facts, without adding any`);
    else if (!t.notes) add(`no note: end each factual sentence with [^${o.id}]`);
  });
  const user = [`Type: ${o.kind}`, `Title: ${one(o.title)}`, o.description && `Description: ${one(o.description)}`, `Note to cite: [^${o.id}]`,
    pages.length ? `Pages you may mention:\n${pages.map((p, i) => `[[p:${i}]] ${one(p.title)}`).join("\n")}` : "No page to mention.", `Facts:\n${facts(o.facts)}`].filter(Boolean).join("\n");
  try {
    const r = await structured(cfg, { name: "write", system: pipelinePrompt("write", { language: o.language }), user, schema: WriteJson, zod, maxTokens: BODY.tokens, source: o.source, report: o.report });
    const t = tidy(r.body, o.id, pages.length);
    return { body: t.text, noted: t.notes > 0 };
  } catch (e) {
    if (!exhausted(e) || !last?.text) throw e;
    return { body: last.text, noted: last.notes > 0 };
  }
}

export type Addition = { section: string; addition: string; contradiction: string | null; noted: boolean };

/** The body of a page cut for the prompt: whole up to `PAGE_TOKENS`, else its `##` titles and its beginning, said to be cut. */
export function pageForPrompt(body: string): string {
  const text = body.replace(/^\[\^[\w-]+\]:.*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  if (estimateTokens(text) <= PAGE_TOKENS) return text;
  const titles = [...text.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => `- ${m[1]}`).slice(0, LISTED);
  const cut = text.slice(0, PAGE_TOKENS * 4);
  return `(This page is long: here are its sections, then its beginning, cut.)\nSections:\n${titles.join("\n") || "- (none)"}\nBeginning:\n${cut.slice(0, Math.max(cut.lastIndexOf("\n"), 0) || cut.length)}\n(cut)`;
}

/**
 * `update`: what a source adds to an existing page (`body` = the page as it is). `id` is the note it ends its sentences
 * with: `sourceId` (merge.ts) gives it. `contradicts` (the connection step found the source against the page) asks it to
 * fill `contradiction`. Same fallback as `writePage` for a missing note.
 */
export async function updatePage(cfg: Config, o: { title: string; body: string; facts: Fact[]; id: string; contradicts?: boolean; language: string; source?: string; report?: Report }): Promise<Addition> {
  let last: { addition: string; notes: number; section: string; contradiction: string | null } | undefined;
  const zod = z.object({ section: z.string(), addition: z.string(), contradiction: z.string().nullable() }).superRefine((v, ctx) => {
    const a = tidy(v.addition, o.id, 0), c = v.contradiction && tidy(v.contradiction, o.id, 0).text;
    last = { addition: a.text, notes: a.notes, section: v.section.replace(/^[#\s]+/, "").trim(), contradiction: c || null };
    const add = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (v.section.length > 80) add("section", "too long (80 characters at most)");
    if (v.addition.length > ADD.max) add("addition", `too long (${v.addition.length} characters, at most ${ADD.max})`);
    else if (a.text.length < ADD.min) add("addition", `too short (${a.text.length} characters, at least ${ADD.min}): state every fact given, without adding any`);
    else if (!a.notes) add("addition", `no note: end each factual sentence with [^${o.id}]`);
    if (v.contradiction && v.contradiction.length > ADD.contradiction) add("contradiction", `too long (${ADD.contradiction} characters at most)`);
  });
  const user = [`Page: ${one(o.title)}`, `Note to cite: [^${o.id}]`, o.contradicts && "This source contradicts the page: say how in `contradiction`.", `Page body:\n${pageForPrompt(o.body)}`, `Facts to add:\n${facts(o.facts)}`].filter(Boolean).join("\n");
  try {
    const r = await structured(cfg, { name: "update", system: pipelinePrompt("update", { language: o.language }), user, schema: UpdateJson, zod, maxTokens: ADD.tokens, source: o.source, report: o.report });
    const a = tidy(r.addition, o.id, 0), c = r.contradiction && tidy(r.contradiction, o.id, 0).text;
    return { section: r.section.replace(/^[#\s]+/, "").trim(), addition: a.text, contradiction: c || null, noted: a.notes > 0 };
  } catch (e) {
    if (!exhausted(e) || !last?.addition) throw e;
    return { section: last.section, addition: last.addition, contradiction: last.contradiction, noted: last.notes > 0 };
  }
}

/** `repair`: the whole body corrected for the problems `errors` that cortex could not fix itself (one try per page: the caller decides what a failure means). */
export async function repairPage(cfg: Config, o: { body: string; errors: string[]; language: string; source?: string; report?: Report }): Promise<string> {
  const zod = z.object({ body: z.string().refine((b) => b.trim() !== "", "empty body").refine((b) => b.length <= REPAIR.max, `too long (${REPAIR.max} characters at most)`) });
  const user = `Problems:\n${o.errors.map((e) => `- ${one(e)}`).join("\n")}\nPage body:\n${o.body.trim()}`;
  const r = await structured(cfg, { name: "repair", system: pipelinePrompt("repair", { language: o.language }), user, schema: RepairJson, zod, maxTokens: REPAIR.tokens, source: o.source, report: o.report });
  return r.body.trim();
}
