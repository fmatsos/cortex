import { z } from "zod";
import { actor, stamp, tagUsage } from "./agent";
import { regenerateCtx } from "./catalog";
import { estimateTokens } from "./chunk";
import { linkPages, tidy, type PageRef } from "./compose";
import { openWiki, type Wiki } from "./context";
import { fromResource, type Page } from "./doc";
import { clip, judge, judgeConfig } from "./judge";
import { isReservedPage, slugify } from "./lib";
import { LIMITS } from "./limits";
import { structured } from "./llm";
import { confident, enqueueOnce, type Item, logUpdate, type Say, type Task } from "./maintain";
import { parseBody } from "./maintain-split";
import { newPageCtx } from "./naming";
import { pipelinePrompt } from "./prompts";
import { closeCtx, enqueueCtx, openItems, queueItems, type QueueItem } from "./queue";
import { DEFAULT_LANGUAGE } from "./schema";
import { collator } from "./text";

// --- `cortex maintain synthesize` (docs/PIPELINE.md §8.4): the `synthesis` entries that the ingestion left in the queue
// (src/bridges.ts: a source linked two groups of pages that had no link) become a page of type Synthesis. The 4B writes it
// from the titles and summaries of the pages of the two groups (never from the sources: a synthesis cites pages, its
// `sources[]` stay empty), d3-mini says whether it relates the two groups, cortex writes.

const one = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const title = (p: { fm: { title?: unknown }; path: string }) => one(p.fm.title) || p.path;

const SYNTHESIS = {
  type: "object", additionalProperties: false, required: ["title", "description", "body"],
  properties: { title: { type: "string", maxLength: 80 }, description: { type: "string", maxLength: 160 }, body: { type: "string", maxLength: 6000 } },
};
const SUMMARY_CHARS = 600;
const BODY_MIN = 200;

type Side = { hub: Page; pages: Page[] };
type Written = { title: string; description: string; body: string; tags: string[]; refs: PageRef[] };
/** `review`: nothing written, a human looks (reason given); `failed`: the model server did not answer, nothing to queue. */
type Outcome = { page: Written; groups: [string[], string[]] } | { review: string } | { failed: string };

/** The page a path names, or the page that replaced it (`superseded_by`). */
function live(byPath: Map<string, Page>, path: string): Page | undefined {
  let p = byPath.get(path);
  for (let n = 0; p?.fm.status === "deprecated" && typeof p.fm.superseded_by === "string" && n < 5; n++) p = byPath.get(fromResource(p.fm.superseded_by));
  return p && p.fm.status !== "deprecated" ? p : undefined;
}

/** What a page says in a few lines for the prompt: its description, then its opening paragraph (or its first section), without notes, links or headings. */
function summary(p: Page): string {
  const { pre, blocks } = parseBody(p.body), text = pre || blocks[0]?.text.replace(/^## .*\n?/, "") || "";
  return clip(one(text.replace(/\[\^[\w-]+\]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")), SUMMARY_CHARS);
}

/** Compose of the two groups: each hub with the pages linked to it (most linked first), half of `synthesizePages` each. */
async function sides(w: Wiki, hubs: [Page, Page], byPath: Map<string, Page>): Promise<[Side, Side]> {
  const { links, backlinks } = await w.linkGraph(), taken = new Set(hubs.map((h) => h.path)), per = Math.floor(LIMITS.synthesizePages / 2);
  const degree = (p: string) => (links.get(p)?.size ?? 0) + (backlinks.get(p)?.size ?? 0);
  const side = (hub: Page): Side => {
    const near = [...new Set([...(links.get(hub.path) ?? []), ...(backlinks.get(hub.path) ?? [])])].map((p) => byPath.get(p))
      .filter((p): p is Page => !!p && !taken.has(p.path) && p.fm.status !== "deprecated" && ["Concept", "Entity", "Synthesis"].includes(String(p.fm.type)))
      .sort((a, b) => degree(b.path) - degree(a.path) || collator.compare(a.path, b.path)).slice(0, per - 1);
    for (const p of near) taken.add(p.path);
    return { hub, pages: [hub, ...near] };
  };
  return [side(hubs[0]), side(hubs[1])];
}

/** The `synthesize` call for one entry, checked; the pages it is made from are the two groups around the hubs of the entry (its first two pages). */
async function compose(w: Wiki, item: QueueItem): Promise<Outcome> {
  const root = w.root, cfg = await w.config(), language = cfg.language ?? DEFAULT_LANGUAGE;
  const pages = await openWiki(root).pages(), byPath = new Map(pages.map((p) => [p.path, p]));
  const hubs = item.pages.slice(0, 2).map((p) => live(byPath, p));
  if (item.pages.length < 2 || !hubs[0] || !hubs[1]) return { review: `les pages des deux groupes sont introuvables ou dépréciées : ${item.pages.slice(0, 2).join(", ")}` };
  if (hubs[0] === hubs[1]) return { review: "les deux groupes n'ont plus qu'une page de départ : plus rien à relier" };
  const [a, b] = await sides(openWiki(root), hubs as [Page, Page], byPath), all = [...a.pages, ...b.pages];
  const refs: PageRef[] = all.map((p) => ({ title: title(p), path: p.path }));
  const card = (p: Page, i: number) => `[[p:${i}]] ${title(p)} — ${one(p.fm.description)}\n${summary(p)}`;
  const user = [`Group A (around « ${title(a.hub)} »):`, ...a.pages.map((p, i) => card(p, i)), "", `Group B (around « ${title(b.hub)} »):`, ...b.pages.map((p, i) => card(p, a.pages.length + i))].join("\n");
  const tokens = estimateTokens(user);
  if (tokens > LIMITS.synthesizeInputTokens) return { review: `groupes trop longs pour un seul appel (${tokens} tokens, ${LIMITS.synthesizeInputTokens} au plus)` };

  const taken = new Set(pages.map((p) => slugify(title(p), Infinity)));
  const clean = (body: string) => tidy(body, "x", all.length).text.replace(/\s*\[\^x\]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim(); // no note, no link but `[[p:N]]`
  const zod = z.object({ title: z.string(), description: z.string(), body: z.string() }).superRefine((v, ctx) => {
    const add = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    const text = clean(v.body), used = new Set([...text.matchAll(/\[\[p:(\d+)\]\]/g)].map((m) => Number(m[1])));
    if (!one(v.title)) add("title", "empty title");
    else if (taken.has(slugify(one(v.title), Infinity))) add("title", `title already taken: ${one(v.title)}: pick another`);
    if (!one(v.description) || v.description.length > 160) add("description", "one sentence of 160 characters at most");
    if (text.length < BODY_MIN) add("body", `too short (${text.length} characters, at least ${BODY_MIN})`);
    if (![...used].some((n) => n < a.pages.length)) add("body", `no [[p:N]] link to group A (numbers 0 to ${a.pages.length - 1}): relate the pages of both groups`);
    if (![...used].some((n) => n >= a.pages.length)) add("body", `no [[p:N]] link to group B (numbers ${a.pages.length} to ${all.length - 1}): relate the pages of both groups`);
  });
  let r;
  try {
    r = await structured(cfg, { name: "synthesize", system: pipelinePrompt("synthesize", { language }), user, schema: SYNTHESIS, zod, maxTokens: LIMITS.synthesizeOutputTokens });
  } catch (e) {
    return /no valid answer/.test((e as Error).message) ? { review: `le modèle n'a pas rendu de synthèse valide : ${(e as Error).message}` } : { failed: (e as Error).message };
  }
  const tags = [...new Set([...a.hub.fm.tags ?? [], ...b.hub.fm.tags ?? []].map(String))];
  return { page: { title: one(r.title), description: one(r.description), body: linkPages(clean(r.body), refs), tags, refs }, groups: [a.pages.map(title), b.pages.map(title)] };
}

/** Creates the page (a draft, no source), the journal line; the caller closes the entry. Throws what `newPageCtx` refuses. */
async function write(w: Wiki, p: Pick<Written, "title" | "description" | "body" | "tags">, item: QueueItem, now: Date): Promise<string> {
  const root = w.root, cfg = await w.config(), pages = await openWiki(root).pages();
  const path = await newPageCtx(openWiki(root), "Synthesis", p.title, now, { fm: { description: p.description, tags: p.tags }, body: `${p.body}\n` });
  await stamp(root, [path], actor({ ...cfg, effort: "maintain" }), now, tagUsage(pages).inUse, new Set([path]), cfg.max_tags ?? LIMITS.maxTags);
  await logUpdate(w, `synthèse : « ${p.title} » écrite depuis l'entrée « ${item.title} » (${path})`, [path, ...item.pages.slice(0, 2)], now);
  return path;
}

/** The proposal of an entry the judge did not confirm: the page as a human reads it, and as `cortex queue apply` reads it back. */
const PROPOSAL = /^Title: (.+)\nDescription: (.+)\n\n([\s\S]+)$/;
const proposalText = (p: Pick<Written, "title" | "description" | "body">) => `Title: ${p.title}\nDescription: ${p.description}\n\n${p.body}`;

const JUDGE = { synthesis: { type: "noul", instructions: "Is `synthesis` a synthesis that relates the two groups of pages (`group_a` and `group_b`), not a list of their contents?" } } as const;

// --- the subcommand

export const maintainSynthesize: Task = async (w, o, say) => {
  const now = o.now ?? (() => new Date()), apply = !!o.apply;
  const items: Item[] = [], written: string[] = [];
  const entries = openItems(queueItems(w.queue().entries), "synthesis").sort((x, y) => x.n - y.n);
  if (!entries.length) { say("info", "Aucune synthèse à écrire dans la file."); return { ok: true, items }; }
  if (apply && !(await w.config()).model) { say("fail", "cortex maintain synthesize --apply a besoin d'un modèle : cortex config set model <nom>"); return { ok: false, items }; }
  const hasJudge = !!(await judgeConfig(w.root));
  let handled = 0, ok = true, proposed = 0;
  for (const e of entries) {
    const label = `« ${e.title} »`;
    if (e.proposal) { items.push({ action: "proposed", pages: e.pages, note: "proposition à relire" }); say("info", `proposition déjà dans la file, à relire (cortex queue apply ${e.n}) : ${label}`); continue; }
    if (o.limit !== undefined && handled >= o.limit) break;
    handled++;
    if (!apply) { items.push({ action: "would-write", pages: e.pages, note: e.title }); say("info", `à rédiger : ${label}`); continue; }
    if (!hasJudge) { items.push({ action: "candidate", pages: e.pages, note: "sans juge" }); say("info", `synthèse candidate, sans juge (rien n'est écrit) : ${label}`); continue; }
    const r = await compose(w, e);
    if ("review" in r) {
      const added = await enqueueOnce(w, { kind: "review", title: `Synthèse non écrite : ${e.title}`, reason: r.review, pages: e.pages, sources: e.sources }, now());
      items.push({ action: "review", pages: e.pages, note: r.review });
      say("warn", `${label} : ${r.review}${added ? " ; entrée de revue dans la file" : ""}`, "  ⚠");
      continue;
    }
    if ("failed" in r) { ok = false; items.push({ action: "failed", pages: e.pages, note: r.failed }); say("fail", `${label} : ${r.failed}`); continue; }
    const a = (await judge(w.root, { synthesis: clip(r.page.body, 2000), group_a: r.groups[0], group_b: r.groups[1] }, JUDGE))?.synthesis;
    if (a?.type !== "noul") { items.push({ action: "candidate", pages: e.pages, note: "sans juge" }); say("info", `juge indisponible : rien n'est écrit pour ${label}`); continue; }
    const score = a.noul.toFixed(2);
    if (confident(a.noul)) {
      try {
        const path = await write(w, r.page, e, now());
        await closeCtx(w, e.n, "done", now());
        written.push(path);
        items.push({ action: "written", pages: [path, ...e.pages.slice(0, 2)], note: score });
        say("ok", `synthèse écrite : « ${r.page.title} » (${path}, ${score})`);
      } catch (err) {
        const added = await enqueueOnce(w, { kind: "review", title: `Synthèse non écrite : ${e.title}`, reason: (err as Error).message, pages: e.pages, sources: e.sources, proposal: proposalText(r.page) }, now());
        items.push({ action: "review", pages: e.pages, note: (err as Error).message });
        say("warn", `${label} : ${(err as Error).message}${added ? " ; entrée de revue dans la file" : ""}`, "  ⚠");
      }
      continue;
    }
    // not confirmed: the page goes in a new entry (the queue is append-only), the old one is closed; `cortex queue apply` writes the proposal as it is
    proposed++;
    await enqueueCtx(w, { kind: "synthesis", title: e.title, reason: `d3-mini : ${score} (il faut ${LIMITS.maintainJudge} au moins pour écrire seul) : proposition à relire`, pages: e.pages, sources: e.sources, proposal: proposalText(r.page) }, now());
    await closeCtx(w, e.n, "done", now());
    items.push({ action: "proposed", pages: e.pages, note: score });
    say("info", `proposition mise dans la file, à relire : ${label} (${score})`);
  }
  if (written.length) await regenerateCtx(openWiki(w.root));
  say(ok ? "ok" : "warn", `${written.length} synthèse(s) écrite(s), ${proposed} proposition(s) à relire${apply ? "" : " ; --apply écrit (rien n'a été modifié)"}`);
  return { ok, items };
};

/** `cortex queue apply <n>` on a `synthesis` entry: the human has decided, so the judge is not asked again. A proposal is written as it is, an entry without one is written by the model. */
export async function applySynthesisEntry(w: Wiki, item: QueueItem, say: Say): Promise<boolean> {
  const now = new Date(), m = item.proposal ? PROPOSAL.exec(item.proposal) : null;
  let p: Pick<Written, "title" | "description" | "body" | "tags"> | undefined = m ? { title: m[1], description: m[2], body: m[3].trim(), tags: [] } : undefined;
  if (!p) {
    if (!(await w.config()).model) { say("fail", "il faut un modèle : cortex config set model <nom>"); return false; }
    const r = await compose(w, item);
    if (!("page" in r)) { say("fail", `#${item.n} : ${"review" in r ? r.review : r.failed}; l'entrée reste ouverte`); return false; }
    p = r.page;
  } else {
    const byPath = new Map((await w.pages()).filter((x) => !isReservedPage(x.path)).map((x) => [x.path, x]));
    p.tags = [...new Set(item.pages.slice(0, 2).flatMap((x) => byPath.get(x)?.fm.tags ?? []).map(String))];
  }
  try {
    const path = await write(w, p, item, now);
    await closeCtx(w, item.n, "done", now);
    await regenerateCtx(openWiki(w.root));
    say("ok", `#${item.n} appliquée : synthèse écrite dans ${path}`);
    return true;
  } catch (e) {
    say("fail", `#${item.n} : ${(e as Error).message}; l'entrée reste ouverte`);
    return false;
  }
}
