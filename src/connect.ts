import { z } from "zod";
import { estimateTokens } from "./chunk";
import type { Config } from "./config";
import type { Fact } from "./cite";
import type { Subject } from "./extraction";
import { clip } from "./judge";
import { LIMITS } from "./limits";
import { structured } from "./llm";
import type { Report } from "./print";
import { pipelinePrompt } from "./prompts";
import type { Candidate } from "./route";
import { DEFAULT_LANGUAGE } from "./schema";
import { collator } from "./text";

// --- Step 4bis (docs/PIPELINE.md §2.9): one call per source, after the reduction. What the agent found by reading the
// neighbouring pages and the extraction does not see: a source that adds to, illustrates or contradicts a page without
// being about it. The answer becomes `update` steps (facts to add) and links (nothing to add), as data for the orchestrator.

export const RELATIONS = ["extends", "contradicts", "example", "related"] as const;
export type Relation = (typeof RELATIONS)[number];
export type Connection = { page: number; relation: Relation; facts: number[]; why: string };

/** An `update` step (§2.6) decided by the connections: add `facts` to `path`; `contradiction`: the instruction asks to fill `contradiction`. */
export type ConnectUpdate = { path: string; title: string; facts: Fact[]; contradiction: boolean; why: string };
/** A page to link only: a line in « Pages liées » of the Source page (`linkLine`), and an entry of the `[[p:N]]` list of the `write` steps. */
export type ConnectLink = { path: string; title: string; relation: Relation; why: string };
export type Connected = { updates: ConnectUpdate[]; links: ConnectLink[] };

const object = (required: string[], properties: object) => ({ type: "object", additionalProperties: false, required, properties });

/** JSON Schema of `connect` (§2.9). */
export const connectSchema = object(["connections"], {
  connections: {
    type: "array", maxItems: LIMITS.pipelineMaxConnections,
    items: object(["page", "relation", "facts", "why"], {
      page: { type: "integer", minimum: 0 }, relation: { enum: [...RELATIONS] },
      facts: { type: "array", maxItems: 6, items: { type: "integer", minimum: 0 } }, why: { type: "string", maxLength: 200 },
    }),
  },
});

/** zod of `connect`; `pages` and `facts` = how many were offered: `page` is in [0, pages - 1], each fact number in [0, facts - 1]. */
export const connectZod = (pages: number, facts: number) => z.object({
  connections: z.array(z.object({
    page: z.number().int().min(0).max(pages - 1), relation: z.enum(RELATIONS),
    facts: z.array(z.number().int().min(0).max(facts - 1)).max(6), why: z.string().trim().max(200),
  })).max(LIMITS.pipelineMaxConnections),
});

/** Link line of the Source page: `- [Title](/wiki/…md) — why` (the title cannot close the link). */
export const linkLine = (l: { path: string; title: string; why?: string }) => `- [${l.title.replace(/[[\]]/g, "")}](/${l.path})${l.why ? ` — ${l.why.replace(/\s+/g, " ")}` : ""}`;

/**
 * Connections as steps. A page named twice keeps its first relation. `extends` and `contradicts` with at least one fact
 * (numbers out of range and repeats dropped) become an update; with none they fall back to a link, as do `example` and
 * `related`. At most `pipelineMaxConnections`, then sorted by title (collator) so that two runs write the same diff.
 */
export function connectionSteps(connections: Connection[], pages: Candidate[], facts: Fact[]): Connected {
  const seen = new Set<number>(), updates: ConnectUpdate[] = [], links: ConnectLink[] = [];
  for (const c of connections) {
    const page = pages[c.page];
    if (!page || seen.has(c.page) || seen.size >= LIMITS.pipelineMaxConnections) continue;
    seen.add(c.page);
    const picked = [...new Set(c.facts)].flatMap((i) => (facts[i] ? [facts[i]!] : []));
    if ((c.relation === "extends" || c.relation === "contradicts") && picked.length) updates.push({ path: page.path, title: page.title, facts: picked, contradiction: c.relation === "contradicts", why: c.why });
    else links.push({ path: page.path, title: page.title, relation: c.relation, why: c.why });
  }
  const byTitle = (a: { title: string }, b: { title: string }) => collator.compare(a.title, b.title);
  return { updates: updates.sort(byTitle), links: links.sort(byTitle) };
}

const CONNECT_TOKENS = 4000;

/** What the call reads (§2.9): summary, key points, numbered facts, numbered pages (one line each; the tail goes while the input exceeds 4k tokens); `pages` = how many were kept. */
function connectInput(o: { summary: string; keyPoints: string[]; facts: { subject: string; fact: Fact }[]; pages: Candidate[] }): { text: string; pages: number } {
  const head = `Summary: ${o.summary}\n\nKey points:\n${o.keyPoints.map((k) => `- ${k}`).join("\n")}\n\nFacts the source states:\n`
    + o.facts.map((f, i) => `${i}. [${f.subject}] ${f.fact.claim}`).join("\n");
  const list = (n: number) => `${head}\n\nExisting pages:\n${o.pages.slice(0, n).map((p, i) => `${i}. ${p.title} (${p.type}): ${clip(p.description.replace(/\s+/g, " "), 120)}`).join("\n")}`;
  let n = o.pages.length;
  while (n > 1 && estimateTokens(list(n)) > CONNECT_TOKENS) n--;
  return { text: list(n), pages: n };
}

/** `pool` = the near pages of routing (best first); `targeted` = paths already updated by a subject, left out of the list. */
export type ConnectOpts = { summary: string; keyPoints: string[]; subjects: Pick<Subject, "title" | "facts">[]; pool: Candidate[]; targeted?: string[]; language?: string; id?: string; report?: Report };

/**
 * Step 4bis. Skipped (nothing asked, empty result) when no page is left near the source or no fact was verified. A call
 * that fails is reported and gives an empty result: the connections are an addition, the source compiles without them.
 */
export async function connectSource(cfg: Config, o: ConnectOpts): Promise<Connected> {
  const taken = new Set(o.targeted ?? []);
  const pages = o.pool.filter((p) => !taken.has(p.path)).slice(0, LIMITS.pipelineCandidatesPool);
  const facts = o.subjects.flatMap((s) => s.facts.map((fact) => ({ subject: s.title, fact }))).slice(0, LIMITS.pipelineConnectFacts);
  if (!pages.length || !facts.length) return { updates: [], links: [] };
  try {
    // the list may have been shortened to fit 4k tokens: the bounds are those of the pages the model saw
    const { text: user, pages: seen } = connectInput({ summary: o.summary, keyPoints: o.keyPoints, facts, pages });
    const r = await structured(cfg, { name: "connect", system: pipelinePrompt("connect", { language: o.language ?? DEFAULT_LANGUAGE }), user, schema: connectSchema, zod: connectZod(seen, facts.length), maxTokens: 600, source: o.id, report: o.report });
    return connectionSteps(r.connections, pages, facts.map((f) => f.fact));
  } catch (e) {
    o.report?.({ level: "warn", text: `connexions : sans résultat (${(e as Error).message}), source compilée sans elles`, mark: "  ⚠" });
    return { updates: [], links: [] };
  }
}
