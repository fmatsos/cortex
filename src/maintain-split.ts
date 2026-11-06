import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { actor, stamp, tagUsage } from "./agent";
import { regenerateCtx } from "./catalog";
import { estimateTokens } from "./chunk";
import { addNoteDefs, noteDef } from "./cite";
import { openWiki, type Wiki } from "./context";
import { type Page } from "./doc";
import { embed, EMBED, embedConfig } from "./embed";
import { clip, judge, judgeConfig } from "./judge";
import { frontmatterError, isReservedPage, parseDoc, setFmLine, sha256, slugify } from "./lib";
import { LIMITS } from "./limits";
import { lint } from "./lint";
import { lexical, suggestLinks, writeLinks } from "./links";
import { structured } from "./llm";
import { confident, enqueueOnce, type Item, logUpdate, openEntry, readState, type Say, type Task, writeState } from "./maintain";
import { nearDuplicate, nearTitle, newPageCtx } from "./naming";
import { pipelinePrompt } from "./prompts";
import { closeCtx, type QueueItem } from "./queue";
import { DEFAULT_LANGUAGE } from "./schema";
import { collator } from "./text";

// --- `cortex maintain split` (docs/PIPELINE.md §8.3): a page that became a catch-all is cut. Candidates are found without a
// model (words, then the meaning of the `##` sections), d3-mini says whether the page has several subjects, the 4B only plans
// (which sections go where, titles, an intro), and cortex moves the sections as they are into new pages.

const one = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const title = (p: { fm: { title?: unknown }; path: string }) => one(p.fm.title) || p.path;
const localDay = (d: Date) => d.toISOString().slice(0, 10);
const withBody = (text: string, body: string) => text.slice(0, text.length - parseDoc("", text).body.length) + body;
const NOTE = /\[\^([\w-]+)\](?!:)/g;
const notesIn = (s: string) => new Set([...s.matchAll(NOTE)].map((m) => m[1]));

// --- 1. the sections of a body

/** A `##` section, its heading line included. `movable`: a section that is not only a list of links (« Pages liées », « Voir aussi »): those stay on the page and are not counted. */
export type Block = { heading: string; text: string; movable: boolean };
export type Parsed = { /** What comes before the first `##`: stays on the page. */ pre: string; blocks: Block[]; /** Note definitions by id: they are rewritten per page. */ defs: Map<string, string> };

const DEF = /^\[\^([\w-]+)\]:.*$/;
const LINK_ITEM = /^\s*[-*] \[[^\]]*\]\([^)]*\)\s*$/;

/** The body cut at its `##` headings (not those inside a code fence), note definitions set aside. */
export function parseBody(body: string): Parsed {
  const defs = new Map<string, string>(), pre: string[] = [], raw: string[][] = [];
  let fence = "";
  for (const line of body.split("\n")) {
    const d = DEF.exec(line);
    if (d && !fence) { defs.set(d[1], line); continue; }
    const f = /^\s*(```|~~~)/.exec(line)?.[1];
    if (f) fence = fence === f ? "" : fence || f;
    if (!fence && /^## /.test(line)) raw.push([line]); else (raw.length ? raw.at(-1)! : pre).push(line);
  }
  const blocks = raw.map((ls) => {
    const text = ls.join("\n").trimEnd(), rest = ls.slice(1).filter((l) => l.trim());
    return { heading: ls[0].replace(/^##\s+/, "").trim(), text, movable: !(rest.length && rest.every((l) => LINK_ITEM.test(l))) };
  });
  return { pre: pre.join("\n").trim(), blocks, defs };
}

const wordCount = (s: string) => (s.match(/\S+/g) ?? []).length;
/** The first non-empty line of a section under its heading, notes removed. */
const firstLine = (b: Block) => clip(one(b.text.split("\n").slice(1).find((l) => l.trim() && !/^\s*(```|~~~)/.test(l))?.replace(/\s*\[\^[\w-]+\]/g, "")), 160);

// --- 2. candidates

const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
type State = { model?: string; /** Vector of a section by hash of its text (the server is asked once per section). */ vectors: Record<string, number[]>; /** Hash of a page (path and text) a judge found to be one subject: not asked again until it changes. */ one: Record<string, string> };

/** Average-linkage clustering of the sections down to two groups; undefined unless they are far from each other and each one holds together. */
function twoGroups(vecs: number[][]): number[][] | undefined {
  let groups = vecs.map((_, i) => [i]);
  const avg = (a: number[], b: number[]) => a.reduce((s, i) => s + b.reduce((t, j) => t + cosine(vecs[i], vecs[j]), 0), 0) / (a.length * b.length);
  while (groups.length > 2) {
    let best = [0, 1], top = -Infinity;
    for (const [i, a] of groups.entries()) for (const [j, b] of groups.entries()) if (j > i && avg(a, b) > top) { top = avg(a, b); best = [i, j]; }
    groups = [...groups.filter((_, i) => !best.includes(i)), [...groups[best[0]], ...groups[best[1]]]];
  }
  const inner = (g: number[]) => (g.length < 2 ? 1 : g.reduce((s, i, k) => s + g.slice(k + 1).reduce((t, j) => t + cosine(vecs[i], vecs[j]), 0), 0) / ((g.length * (g.length - 1)) / 2));
  const [a, b] = groups.map((g) => [...g].sort((x, y) => x - y)).sort((x, y) => x[0] - y[0]);
  return avg(a, b) < LIMITS.splitSectionCosine && inner(a) > LIMITS.splitInnerCosine && inner(b) > LIMITS.splitInnerCosine ? [a, b] : undefined;
}

/** The two groups of sections (indices among the movable ones) when the page looks multi-subject by meaning; undefined without embeddings. The vectors come from `state` or are asked for what is missing. */
async function groupsOf(root: string, blocks: Block[], state: State, down: { done: boolean; seen?: Set<string> }, say?: Say): Promise<number[][] | undefined> {
  const movable = blocks.filter((b) => b.movable);
  const cfg = await embedConfig(root);
  if (!cfg || down.done || movable.length < 3 || movable.length > 12) return;
  if (state.model !== `${cfg.model}/${cfg.dims}`) { state.vectors = {}; state.model = `${cfg.model}/${cfg.dims}`; }
  const texts = movable.map((b) => b.text.replace(/\[\^[\w-]+\]/g, "").slice(0, 2000)), hashes = texts.map(sha256);
  hashes.forEach((h) => down.seen?.add(h));
  const missing = [...new Set(hashes.filter((h) => !state.vectors[h]))];
  try {
    for (let i = 0; i < missing.length; i += EMBED.batch) {
      const part = missing.slice(i, i + EMBED.batch), vecs = await embed(part.map((h) => texts[hashes.indexOf(h)]), cfg, EMBED.indexTimeoutMs);
      part.forEach((h, k) => { state.vectors[h] = vecs[k]; });
    }
  } catch (e) {
    down.done = true;
    say?.("warn", `embeddings : ${(e as Error).message} ; seules les pages longues sont examinées`, "  ⚠");
    return;
  }
  return twoGroups(hashes.map((h) => state.vectors[h]));
}

type Candidate = { page: Page; words: number; long: boolean; groups?: number[][] };

/** Concept and Entity pages (not deprecated) of at least 3 sections that are long, or whose sections fall in two distant groups. Longest first. */
async function candidates(w: Wiki, pages: Page[], state: State, say: Say, seen: Set<string>): Promise<Candidate[]> {
  const down = { done: false, seen }, out: Candidate[] = [];
  if (!(await embedConfig(w.root))) say("warn", "embeddings absentes (cortex index) : seules les pages longues sont examinées", "  ⚠");
  for (const p of pages.filter((p) => (p.fm.type === "Concept" || p.fm.type === "Entity") && p.fm.status !== "deprecated" && !isReservedPage(p.path)).sort((a, b) => collator.compare(a.path, b.path))) {
    const { blocks, pre } = parseBody(p.body);
    if (blocks.filter((b) => b.movable).length < 3) continue;
    const words = wordCount([pre, ...blocks.map((b) => b.text)].join(" ")), long = words > LIMITS.splitWords;
    const groups = await groupsOf(w.root, blocks, state, down, say);
    if (long || groups) out.push({ page: p, words, long, groups });
  }
  return out.sort((a, b) => b.words - a.words);
}

// --- 3. the judge

const CRITERIA = {
  one: "the page is about one subject: its sections are parts of the same whole",
  several: "the page covers several subjects that would each stand as a page of their own",
  unsure: "it is not clear whether the page has one subject or several",
};
type Verdict = { choice: "one" | "several" | "unsure"; p: number };

/** d3-mini on the title, the description and the sections with their first line; undefined without a judge (or when it is down). */
async function verdict(root: string, p: Page, blocks: Block[]): Promise<Verdict | undefined> {
  const sections = blocks.filter((b) => b.movable).slice(0, 14).map((b) => clip(`${b.heading}: ${firstLine(b)}`, 200));
  const r = (await judge(root, { title: title(p), description: clip(one(p.fm.description), 300), sections }, {
    shape: { type: "choice", instructions: "Is the wiki page `title` about one subject, or does it cover several subjects that should be separate pages? The `sections` are its `##` headings with their first line.", criteria: CRITERIA },
  }))?.shape;
  if (r?.type !== "choice" || !(r.choice in CRITERIA)) return;
  return { choice: r.choice as Verdict["choice"], p: r.probabilities[r.choice] ?? r.confidence ?? 0 };
}

// --- 4. the plan (the `split` call)

const PLAN = {
  type: "object", additionalProperties: false, required: ["keep", "pages"],
  properties: {
    keep: { type: "object", additionalProperties: false, required: ["title", "description", "sections"],
      properties: { title: { type: "string", maxLength: 80 }, description: { type: "string", maxLength: 160 }, sections: { type: "array", items: { type: "integer", minimum: 0 } } } },
    pages: { type: "array", minItems: 1, maxItems: 4, items: {
      type: "object", additionalProperties: false, required: ["kind", "title", "description", "sections", "intro"],
      properties: { kind: { enum: ["Concept", "Entity"] }, title: { type: "string", maxLength: 80 }, description: { type: "string", maxLength: 160 },
        sections: { type: "array", minItems: 1, items: { type: "integer", minimum: 0 } }, intro: { type: "string", maxLength: 600 } } } },
  },
};
type Plan = { keep: { title: string; description: string; sections: number[] }; pages: { kind: "Concept" | "Entity"; title: string; description: string; sections: number[]; intro: string }[] };

/** An intro as the model may have written it: no heading, no note, no link (it knows no path), one paragraph per line break kept. */
const cleanIntro = (s: string) => s.replace(/^\s*#+ .*\n?/gm, "").replace(/\[\^[\w-]+\]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();

/** `review`: nothing written, a human looks (reason given); `failed`: the model server did not answer, nothing to queue. */
type Outcome = { split: { page: string; created: string[] } } | { review: string } | { failed: string };
export type Split = { page: string; created: string[] };

/**
 * Cuts the page `path`: asks the model for the plan, checks it (every section once, titles free), then creates the new pages
 * (sections moved as they are), and rewrites the page last. Nothing is written when a title is refused: the pages created so
 * far are removed. A crash after the new pages and before the page itself leaves sections twice, never lost.
 */
async function splitPage(w: Wiki, path: string, groups: number[][] | undefined, now: Date): Promise<Outcome> {
  const root = w.root, cfg = await w.config(), language = cfg.language ?? DEFAULT_LANGUAGE;
  const pages = await openWiki(root).pages(), page = pages.find((p) => p.path === path);
  if (!page) return { review: `page introuvable : ${path}` };
  if ((page.fm.type !== "Concept" && page.fm.type !== "Entity") || page.fm.status === "deprecated") return { review: "la page n'est plus découpable (type ou page dépréciée)" };
  const text = readFileSync(join(root, path), "utf8");
  let doc;
  try { doc = parseDoc(path, text); } catch (e) { return { review: (e as Error).message }; }
  const parsed = parseBody(doc.body), movable = parsed.blocks.filter((b) => b.movable), n = movable.length;
  if (n < 3) return { review: "moins de 3 sections : rien à découper" };

  const others = pages.filter((p) => p.path !== path), slugs = new Set(pages.filter((p) => p.path !== path).map((p) => slugify(title(p), Infinity)));
  const sameKind = (kind: string) => others.filter((p) => p.fm.type === kind && p.fm.status !== "deprecated");
  const user = [`Title: ${title(page)}`, `Description: ${one(page.fm.description)}`,
    `Sections (numbered from 0):\n${movable.map((b, i) => `${i}. ${b.heading}${firstLine(b) ? ` — ${firstLine(b)}` : ""}`).join("\n")}`,
    groups && `Groups of sections close in meaning (a suggestion):\n${groups.map((g) => `- ${g.join(", ")}`).join("\n")}`].filter(Boolean).join("\n\n");
  const tokens = estimateTokens(user);
  if (tokens > LIMITS.splitInputTokens) return { review: `trop de sections pour un seul appel (${tokens} tokens, ${LIMITS.splitInputTokens} au plus)` };

  // what the grammar cannot carry: every section once, titles that are free
  const zod = z.object({
    keep: z.object({ title: z.string(), description: z.string(), sections: z.array(z.number().int().min(0)) }),
    pages: z.array(z.object({ kind: z.enum(["Concept", "Entity"]), title: z.string(), description: z.string(), sections: z.array(z.number().int().min(0)), intro: z.string() })).min(1).max(4),
  }).superRefine((v, ctx) => {
    const add = (p: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path: p, message });
    const seen = new Map<number, number>();
    for (const s of [...v.keep.sections, ...v.pages.flatMap((p) => p.sections)]) seen.set(s, (seen.get(s) ?? 0) + 1);
    const out = [...seen.keys()].filter((s) => s >= n), twice = [...seen].filter(([, c]) => c > 1).map(([s]) => s), lost = movable.map((_, i) => i).filter((i) => !seen.has(i));
    if (out.length) add(["pages"], `unknown section numbers: ${out.join(", ")} (0 to ${n - 1})`);
    if (twice.length) add(["pages"], `sections used more than once: ${twice.join(", ")}: each section goes to exactly one place`);
    if (lost.length) add(["pages"], `sections not placed: ${lost.join(", ")}: every section goes in \`keep\` or in a page`);
    if (!v.keep.sections.length) add(["keep", "sections"], "keep must hold at least one section");
    const own = one(v.keep.title) && slugify(v.keep.title, Infinity) !== slugify(title(page), Infinity) ? v.keep.title : title(page);
    if (own !== title(page) && slugs.has(slugify(own, Infinity))) add(["keep", "title"], `title already taken: ${own}`);
    const names = [own];
    for (const [i, p] of v.pages.entries()) {
      const t = one(p.title);
      if (!t) add(["pages", i, "title"], "empty title");
      else if (slugs.has(slugify(t, Infinity)) || names.some((o) => slugify(o, Infinity) === slugify(t, Infinity))) add(["pages", i, "title"], `title already taken: ${t}: pick another`);
      else if (names.some((o) => nearTitle(o, t)) || sameKind(p.kind).some((o) => nearTitle(title(o), t))) add(["pages", i, "title"], `title too close to the title of another page: ${t}: pick a title that tells them apart`);
      names.push(t);
      if (!one(p.description) || p.description.length > 160) add(["pages", i, "description"], "one sentence of 160 characters at most");
      if (!cleanIntro(p.intro)) add(["pages", i, "intro"], "empty intro");
    }
    if (v.keep.description.length > 160) add(["keep", "description"], "too long (160 characters at most)");
  });
  let plan: Plan;
  try {
    plan = await structured(cfg, { name: "split", system: pipelinePrompt("split", { language }), user, schema: PLAN, zod, maxTokens: LIMITS.splitOutputTokens });
  } catch (e) {
    return /no valid answer/.test((e as Error).message) ? { review: `le modèle n'a pas rendu de plan valide : ${(e as Error).message}` } : { failed: (e as Error).message };
  }

  // the meaning of the new pages (the page itself is left out: it holds what they are made of, every one would look like a copy of it)
  for (const p of plan.pages) {
    const dup = await nearDuplicate(root, others, p.kind, one(p.title), one(p.description));
    if (dup?.refuse) return { review: `la page « ${one(p.title)} » ferait doublon : ${dup.near.map((x) => `${x.path} « ${x.title} »`).join(", ")}` };
  }

  // the pages, built from the sections as they are
  const fr = /^fr/i.test(language), seeAlso = fr ? "Voir aussi" : "See also";
  const cited = Array.isArray(doc.fm.sources) ? (doc.fm.sources as { id?: unknown; title?: unknown; resource?: unknown }[]).filter((s) => s && typeof s === "object") : [];
  const defsFor = (body: string) => [...notesIn(body)].map((id) => parsed.defs.get(id) ?? (() => { const s = cited.find((c) => String(c.id) === id); return s ? noteDef(id, one(s.title) || id, s.resource ? String(s.resource) : undefined) : undefined; })()).filter((d): d is string => !!d);
  const created: string[] = [], undo = () => created.forEach((p) => rmSync(join(root, p), { force: true }));
  const refs: { title: string; path: string }[] = [];
  for (const p of plan.pages) {
    const moved = p.sections.map((i) => movable[i].text).join("\n\n"), body = `${cleanIntro(p.intro)}\n\n${moved}\n\n## ${seeAlso}\n- [${title(page).replace(/[[\]]/g, "")}](/${path})\n`;
    const ids = notesIn(body);
    try {
      const made = await newPageCtx(openWiki(root), p.kind, one(p.title), now, {
        force: true, // the guards were run above, without the page that is being cut
        fm: { description: one(p.description), tags: Array.isArray(doc.fm.tags) ? doc.fm.tags : [], ...(ids.size && { sources: cited.filter((s) => ids.has(String(s.id))) }) },
        body: addNoteDefs(body, defsFor(body)),
      });
      created.push(made);
      refs.push({ title: one(p.title), path: made });
    } catch (e) { undo(); return { review: `page « ${one(p.title)} » non créée : ${(e as Error).message}` }; }
  }

  // the page itself: its sections, the list of the new pages, its notes
  const keep = new Set(plan.keep.sections), kept = movable.filter((_, i) => keep.has(i));
  const blocks = parsed.blocks.filter((b) => !b.movable || kept.includes(b));
  const list = refs.map((r) => `- [${r.title.replace(/[[\]]/g, "")}](/${r.path})`);
  const at = blocks.findIndex((b) => !b.movable && /^(voir aussi|see also)$/i.test(b.heading));
  if (at >= 0) blocks[at] = { ...blocks[at], text: `${blocks[at].text}\n${list.filter((l) => !blocks[at].text.includes(l)).join("\n")}`.trimEnd() };
  else blocks.push({ heading: seeAlso, text: `## ${seeAlso}\n${list.join("\n")}`, movable: false });
  const body = `${[parsed.pre, ...blocks.map((b) => b.text)].filter(Boolean).join("\n\n")}\n`;
  let out = withBody(text, addNoteDefs(body, defsFor(body)));
  const name = one(plan.keep.title) && !slugs.has(slugify(plan.keep.title, Infinity)) ? one(plan.keep.title) : title(page);
  if (name !== title(page)) {
    out = setFmLine(out, "title", `title: ${JSON.stringify(name)}`);
    const aliases = [...new Set([[doc.fm.aliases].flat().filter((a): a is string => typeof a === "string"), title(page)].flat())];
    out = setFmLine(out, "aliases", `aliases: ${JSON.stringify(aliases)}`);
  }
  if (one(plan.keep.description)) out = setFmLine(out, "description", `description: ${JSON.stringify(one(plan.keep.description))}`);
  out = setFmLine(out, "status", "status: draft");
  const err = frontmatterError(out);
  if (err) { undo(); return { review: `${path} : le découpage casserait le frontmatter (${err})` }; }
  writeFileSync(join(root, path), out);
  await stamp(root, [path, ...created], actor({ ...cfg, effort: "maintain" }), now, tagUsage(pages).inUse, new Set(created), cfg.max_tags ?? LIMITS.maxTags);

  // mentions of the new titles elsewhere in the wiki point at the new pages
  const all = await openWiki(root).pages();
  await writeLinks(root, suggestLinks(all, lexical, { pages: new Set(all.filter((p) => !isReservedPage(p.path)).map((p) => p.path)), targets: new Set(created) }), now);

  const open = openEntry(w, "split", [path]);
  if (open) await closeCtx(w, open.n, "done", now);
  await logUpdate(w, `découpage : « ${title(page)} » en ${refs.map((r) => `« ${r.title} »`).join(", ")} (${n} sections, ${created.join(", ")})`, [path, ...created], now);
  return { split: { page: path, created } };
}

/** Lint errors of the pages a run wrote: by construction there should be none, so they are said. */
async function checkWritten(w: Wiki, done: Split[], say: Say) {
  const files = new Set(done.flatMap((s) => [s.page, ...s.created]));
  for (const i of (await lint(w.root)).filter((i) => i.level === "error" && files.has(i.path.replace(/:\d+$/, "")))) say("warn", `${i.path} : ${i.msg}`, "  ⚠");
}

// --- the subcommand

const proposal = (c: Candidate | undefined, blocks: Block[]) => {
  const names = (g: number[]) => g.map((i) => blocks.filter((b) => b.movable)[i]?.heading).join(", ");
  return c?.groups ? `Groupes de sections proposés :\n${c.groups.map((g) => `- ${names(g)}`).join("\n")}` : `${c?.words ?? 0} mots, sections : ${blocks.filter((b) => b.movable).map((b) => b.heading).join(", ")}`;
};

export const maintainSplit: Task = async (w, o, say) => {
  const now = o.now ?? (() => new Date()), root = w.root, apply = !!o.apply;
  const items: Item[] = [], done: Split[] = [];
  const pages = await w.pages(), state = readState<State>(root, "split", { vectors: {}, one: {} });
  const before = JSON.stringify(state.vectors), seen = new Set<string>();
  const found = await candidates(w, pages, state, say, seen);
  state.vectors = Object.fromEntries(Object.entries(state.vectors).filter(([h]) => seen.has(h))); // the vectors of sections that are gone are dropped
  if (!found.length) { say("info", "Aucune page à découper."); return { ok: true, items }; }
  if (apply && !(await w.config()).model) { say("fail", "cortex maintain split --apply a besoin d'un modèle : cortex config set model <nom>"); return { ok: false, items }; }
  const hasJudge = !!(await judgeConfig(root));
  let judged = 0, queued = 0, single = 0, ok = true, changed = false;
  for (const c of found) {
    if (o.limit !== undefined && judged >= o.limit) break;
    const p = c.page, label = `« ${title(p)} »`, key = sha256([p.path, readFileSync(join(root, p.path), "utf8")].join("\0"));
    if (state.one[key]) { single++; continue; }
    judged++;
    const blocks = parseBody(p.body).blocks, why = c.long ? `${c.words} mots` : "sections de sens éloigné";
    const v = hasJudge ? await verdict(root, p, blocks) : undefined;
    if (!v) { items.push({ action: "candidate", pages: [p.path], note: "sans juge" }); say("info", `page candidate (${why}), sans juge (rien n'est découpé) : ${label}`); continue; }
    const score = `${v.choice} ${v.p.toFixed(2)}`;
    if (v.choice === "one") {
      single++;
      if (apply && confident(v.p)) { state.one[key] = localDay(now()); changed = true; }
      continue;
    }
    if (v.choice === "several" && confident(v.p)) {
      if (!apply) { items.push({ action: "would-split", pages: [p.path], note: score }); say("info", `à découper : ${label} (${why}, ${score})`); continue; }
      const r = await splitPage(w, p.path, c.groups, now());
      if ("split" in r) {
        done.push(r.split);
        items.push({ action: "split", pages: [p.path, ...r.split.created], note: score });
        say("ok", `découpage : ${label} en ${r.split.created.length} page(s) (${score})`);
      } else if ("review" in r) {
        const added = await enqueueOnce(w, { kind: "review", title: `Découpage non fait : ${title(p)}`, reason: r.review, pages: [p.path], proposal: proposal(c, blocks) }, now());
        items.push({ action: "review", pages: [p.path], note: r.review });
        say("warn", `${label} : ${r.review}${added ? " ; entrée de revue dans la file" : ""}`, "  ⚠");
      } else { ok = false; items.push({ action: "failed", pages: [p.path], note: r.failed }); say("fail", `${label} : ${r.failed}`); }
      continue;
    }
    // several without enough certainty: `cortex queue apply <n>` cuts it; unsure: a human looks first
    queued++;
    const kind = v.choice === "several" ? "split" : "review";
    const reason = v.choice === "several" ? `d3-mini : ${score} (il faut « several » à ${LIMITS.maintainJudge} au moins pour découper seul)` : `d3-mini : ${score} : la page a-t-elle un ou plusieurs sujets ?`;
    if (!apply) { items.push({ action: "would-queue", pages: [p.path], note: score }); say("info", `à mettre en file : ${label} (${why}, ${score})`); continue; }
    const added = await enqueueOnce(w, { kind, title: `Page à restructurer : ${title(p)}`, reason, pages: [p.path], proposal: proposal(c, blocks) }, now());
    items.push({ action: added ? "queued" : "already-queued", pages: [p.path], note: score });
    say("info", `${added ? "en file" : "déjà en file"} : ${label} (${score})`);
  }
  if (apply && (changed || JSON.stringify(state.vectors) !== before)) writeState(root, "split", state);
  const added = items.filter((i) => i.action === "queued" || i.action === "review");
  if (added.length) await logUpdate(w, `maintenance split : ${done.length} découpage(s), ${added.length} entrée(s) ajoutée(s) à la file`, [...new Set(added.flatMap((i) => i.pages))], now()); // the splits wrote their own lines
  if (done.length) { await regenerateCtx(openWiki(root)); await checkWritten(w, done, say); }
  say(ok ? "ok" : "warn", `${done.length} découpage(s), ${queued} page(s) ${apply ? "en file" : "à mettre en file"}, ${single} page(s) à un seul sujet${apply ? "" : " ; --apply écrit (rien n'a été modifié)"}`);
  return { ok, items };
};

/** `cortex queue apply <n>` on a `split` entry: the human has decided, so the judge is not asked again; the plan has the same checks. */
export async function applySplitEntry(w: Wiki, item: QueueItem, say: Say): Promise<boolean> {
  if (item.pages.length !== 1) { say("fail", `l'entrée #${item.n} doit porter une page (${item.pages.length})`); return false; }
  if (!(await w.config()).model) { say("fail", "il faut un modèle : cortex config set model <nom>"); return false; }
  const page = (await w.pages()).find((p) => p.path === item.pages[0]);
  const groups = page && (await groupsOf(w.root, parseBody(page.body).blocks, readState<State>(w.root, "split", { vectors: {}, one: {} }), { done: false }));
  const r = await splitPage(w, item.pages[0], groups, new Date());
  if ("split" in r) {
    await regenerateCtx(openWiki(w.root));
    await checkWritten(w, [r.split], say);
    say("ok", `#${item.n} appliquée : ${r.split.page} coupée en ${r.split.created.join(", ")}`);
    return true;
  }
  say("fail", `#${item.n} : ${"review" in r ? r.review : r.failed}; l'entrée reste ouverte`);
  return false;
}
