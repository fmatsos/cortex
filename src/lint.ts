import { existsSync } from "node:fs";
import { join } from "node:path";
import { dateMs, type Page, pageState, type RawSource, rawId, REPORTED_FIELDS, toResource } from "./doc";
import { openWiki, type Wiki } from "./context";
import { isReservedPage, slugify, wikiLinks } from "./lib";
import { LIMITS } from "./limits";
import { pattern } from "./template";
import { renderLogMd } from "./log";
import { queueItems, renderQueueMd, staleItems } from "./queue";

export type Issue = { level: "error" | "warning" | "info"; path: string; msg: string };

const DAY = 86_400_000;
const issue = (level: Issue["level"], path: string, msg: string): Issue => ({ level, path, msg });

/** Everything a rule reads, computed once per lint run. */
type Ctx = {
  w: Wiki; root: string; now: Date;
  tpl: { raw_path: string; page_path: string }; pagePat: RegExp; rawPat: RegExp;
  /** Wiki pages (index.md and log.md excluded) and raw sources. */
  pages: Page[]; raws: RawSource[];
  /** Raw resource → Source pages that cite it. */
  cites: Map<string, Page[]>;
  /** Page path → number of links to it, counted per occurrence. */
  inbound: Map<string, number>;
  /** Slugified title → path of the first page that has it. */
  firstTitle: Map<string, string>;
  /** Raw id → path of the first source that has it. */
  firstRaw: Map<string, string>;
};
/** A check of the whole wiki; the issues come out in the order of its findings. */
type Rule = (c: Ctx) => Issue[] | Promise<Issue[]>;
/** A check of one wiki page / one raw source. */
type PageRule = (c: Ctx, d: Page) => Issue[];
type RawRule = (c: Ctx, d: RawSource) => Issue[];

// --- per-page rules (run page by page, in this order) ---

const fieldIssues: PageRule = (_, d) => d.issues.filter((i) => REPORTED_FIELDS.has(i.field)).map((i) => issue("error", d.path, i.msg)); // type, title, status, tags
const pageNaming: PageRule = (c, d) =>
  c.pagePat.test(d.path.replace(/^wiki\//, "").replace(/\.md$/, "")) ? [] : [issue("warning", d.path, `name outside the page_path template "${c.tpl.page_path}" (pages are created with cortex new)`)];
const noDescription: PageRule = (_, d) => (d.fm.description ? [] : [issue("error", d.path, "missing description")]);
const missingSources: PageRule = (c, d) =>
  (d.fm.sources ?? []).filter((s) => !s.resource || !existsSync(join(c.root, s.resource))).map((s) => issue("error", d.path, `source not found: ${s.resource}`));
const orphanFootnotes: PageRule = (_, d) => {
  const ids = new Set((d.fm.sources ?? []).map((s) => s.id));
  return [...d.body.matchAll(/\[\^([\w-]+)\]/g)].filter(([, id]) => !ids.has(id)).map(([, id]) => issue("error", d.path, `footnote [^${id}] has no sources[] entry`));
};
// duplicates kept: one error per broken link occurrence
const brokenLinks: PageRule = (c, d) => wikiLinks(d.body).filter((l) => !existsSync(join(c.root, l))).map((l) => issue("error", d.path, `broken link: /${l}`));
// a relative link to a .md is not a graph edge nor a working link on the site: only root-relative `/wiki/…md` links count
const relativeLinks: PageRule = (_, d) =>
  [...d.body.matchAll(/\]\((?![a-z][a-z0-9+.-]*:|\/|#)([^)\s]*\.md(?:#[^)\s]*)?)\)/gi)]
    .map(([, target]) => issue("warning", d.path, `relative link to a .md: ${target} (use a root-relative link: /wiki/….md)`));
const reviewState: PageRule = (_, d) =>
  !d.fm.verified ? [issue("info", d.path, "never reviewed")]
  : pageState(d.fm).needsReview ? [issue("warning", d.path, "modified since review (generated.at > verified.at): review again")] : [];
const stalePage: PageRule = (c, d) =>
  pageState(d.fm, c.now).stale ? [issue("warning", d.path, `stale since ${String(d.fm.stale_after).slice(0, 10)} (stale_after)`)] : [];
const duplicateTitle: PageRule = (c, d) => {
  const first = c.firstTitle.get(slugify(String(d.fm.title ?? "")));
  return first !== undefined && first !== d.path ? [issue("warning", d.path, `probable duplicate of ${first} (same title)`)] : [];
};
const pageRules: PageRule[] = [fieldIssues, pageNaming, noDescription, missingSources, orphanFootnotes, brokenLinks, relativeLinks, reviewState, stalePage, duplicateTitle];

// --- per-raw-source rules ---

const rawType: RawRule = (_, d) => (d.fm.type === "RawSource" ? [] : [issue("error", d.path, "expected type: RawSource")]);
const rawNaming: RawRule = (c, d) => {
  const dir = d.path.replace(/^raw\//, "").replace(/\/source\.md$/, ""); // the folder of the source, checked against raw_path
  return !d.path.endsWith("/source.md") || !c.rawPat.test(dir) ? [issue("warning", d.path, `path outside the raw_path template "${c.tpl.raw_path}" (sources are added with cortex add)`)] : [];
};
const duplicateRawId: RawRule = (c, d) => {
  const id = rawId(d.path), first = c.firstRaw.get(id);
  return first !== d.path ? [issue("error", d.path, `duplicate raw id: ${id} (also ${first}); the journal cannot tell them apart`)] : [];
};
const pendingSource: RawRule = (c, d) => {
  if (d.fm.status !== "pending") return [];
  const out: Issue[] = [];
  const fetched = dateMs(d.fm.fetched_at);
  if (fetched !== undefined && c.now.getTime() - fetched > LIMITS.pendingDays * DAY) out.push(issue("warning", d.path, `pending for more than ${LIMITS.pendingDays} days`));
  return out;
};
const compiledUncited: RawRule = (c, d) =>
  d.fm.status === "compiled" && !c.cites.has(toResource(d.path)) ? [issue("warning", d.path, "compiled but no Source page cites it")] : [];
const rawRules: RawRule[] = [rawType, rawNaming, duplicateRawId, pendingSource, compiledUncited];

// --- whole-wiki rules (run in this order) ---

const invalidYaml: Rule = (c) => [...c.w.errors.pages, ...c.w.errors.raws].map((e) => issue("error", e.path, `invalid YAML: ${e.msg}`));
const pagesRule: Rule = (c) => c.pages.flatMap((d) => pageRules.flatMap((r) => r(c, d)));
const orphans: Rule = (c) =>
  c.pages.filter((d) => d.fm.type !== "Source" && !c.inbound.get(d.path)).map((d) => issue("warning", d.path, "orphan: no incoming link"));
const duplicateSources: Rule = (c) =>
  [...c.cites].filter(([res, pages]) => pages.length > 1 && existsSync(join(c.root, res)))
    .map(([res, pages]) => issue("warning", pages[1].path, `probable duplicate of ${pages[0].path} (same raw source ${res})`));
const rawsRule: Rule = (c) => c.raws.flatMap((d) => rawRules.flatMap((r) => r(c, d)));
/** Two tags with the same key are near-synonyms (case, accents, a final s). */
export const tagKey = (tag: string) => slugify(String(tag)).replace(/s$/, "");
const tagSynonyms: Rule = (c) => {
  const out: Issue[] = [], tags = new Map<string, string>();
  for (const d of c.pages) for (const tag of d.fm.tags ?? []) {
    const k = tagKey(tag);
    const seen = tags.get(k);
    if (seen && seen !== tag) out.push(issue("warning", d.path, `near-synonym tags: "${seen}" and "${tag}"`));
    else tags.set(k, tag);
  }
  return out;
};
// journal: invalid lines = error; log.md must be exactly the generation of log.jsonl
const journalRule: Rule = async (c) => {
  const journal = c.w.journal();
  const out = journal.errors.map((e) => issue("error", `wiki/log.jsonl:${e.line}`, e.msg));
  const md = join(c.root, "wiki/log.md");
  if ((existsSync(md) || journal.entries.length)
    && (!existsSync(md) || (await Bun.file(md).text()) !== renderLogMd(journal.entries, await c.w.titles())))
    out.push(issue("warning", "wiki/log.md", "differs from its generation from wiki/log.jsonl (edited by hand?): cortex index regenerates it"));
  return out;
};

// queue: invalid lines = error; queue.md must be exactly the generation of queue.jsonl; open entries past queueStaleDays = one info
const queueRule: Rule = async (c) => {
  const queue = c.w.queue();
  const out = queue.errors.map((e) => issue("error", `wiki/queue.jsonl:${e.line}`, e.msg));
  const md = join(c.root, "wiki/queue.md");
  if ((existsSync(md) || queue.entries.length)
    && (!existsSync(md) || (await Bun.file(md).text()) !== renderQueueMd(queue.entries, await c.w.titles())))
    out.push(issue("warning", "wiki/queue.md", "differs from its generation from wiki/queue.jsonl (edited by hand?): cortex index regenerates it"));
  const stale = staleItems(queueItems(queue.entries), c.now);
  if (stale.length)
    out.push(issue("info", "wiki/queue.jsonl", `${stale.length} open entr${stale.length > 1 ? "ies" : "y"} older than ${LIMITS.queueStaleDays} days (${stale.map((i) => `#${i.n}`).join(", ")}): cortex queue`));
  return out;
};

export const rules: Rule[] = [invalidYaml, pagesRule, orphans, duplicateSources, rawsRule, tagSynonyms, journalRule, queueRule];

async function context(w: Wiki, now: Date): Promise<Ctx> {
  const tpl = await w.naming();
  const [all, raws] = [await w.pages(), await w.raws()];
  const pages = all.filter((d) => !isReservedPage(d.path));
  const cites = await w.citations();
  const inbound = new Map<string, number>(), firstTitle = new Map<string, string>(), firstRaw = new Map<string, string>();
  for (const d of pages) {
    for (const l of wikiLinks(d.body)) inbound.set(l, (inbound.get(l) ?? 0) + 1);
    const t = slugify(String(d.fm.title ?? ""));
    if (!firstTitle.has(t)) firstTitle.set(t, d.path);
  }
  for (const d of raws) if (!firstRaw.has(rawId(d.path))) firstRaw.set(rawId(d.path), d.path);
  return { w, root: w.root, now, tpl, pagePat: pattern(tpl.page_path), rawPat: pattern(tpl.raw_path), pages, raws, cites, inbound, firstTitle, firstRaw };
}

export async function lintCtx(w: Wiki, now = new Date()): Promise<Issue[]> {
  const c = await context(w, now);
  const out: Issue[] = [];
  for (const rule of rules) out.push(...await rule(c));
  return out;
}
export const lint = (root: string, now = new Date()) => lintCtx(openWiki(root), now);
