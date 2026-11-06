import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { actor, stamp, tagUsage } from "./agent";
import { regenerateCtx } from "./catalog";
import { estimateTokens } from "./chunk";
import { openWiki, type Wiki } from "./context";
import type { Page } from "./doc";
import { clip, judge, judgeConfig } from "./judge";
import { frontmatterError, isReservedPage, parseDoc, setFmLine, sha256 } from "./lib";
import { LIMITS } from "./limits";
import { lint } from "./lint";
import { structured } from "./llm";
import { confident, enqueueOnce, type Item, logUpdate, readState, type Say, type Task, writeState } from "./maintain";
import { pipelinePrompt } from "./prompts";
import { closeCtx, enqueueCtx, queueItems, type QueueItem } from "./queue";
import { DEFAULT_LANGUAGE } from "./schema";
import { collator } from "./text";

// --- `cortex maintain contradictions` (docs/PIPELINE.md §8.2): the `> [!warning] Contradiction` callouts the ingestion
// wrote (§4.4). For each section that carries one, the 4B settles it from the section and the summaries of the Source pages
// (never the raw sources), d3-mini checks that nothing was lost, and cortex replaces the section and drops the callout.
// Without `--apply` the callouts are listed (no model call, nothing written). With it, a verdict other than `unsure` that
// the judge confirms is written (the page goes back to `draft`); the others become `contradiction` queue entries holding the
// proposal, which `cortex queue apply <n>` writes as a human decision.

type Verdict = "newer_source_wins" | "older_text_wins" | "both_hold" | "unsure";
type State = { /** Hash of a section (page, heading, text) already proposed to the queue: not resolved again until it changes. */ queued: Record<string, string> };

const one = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const title = (p: { fm: { title?: unknown }; path: string }) => one(p.fm.title) || p.path;
const localDay = (d: Date) => d.toISOString().slice(0, 10);
const DEF = /^\[\^([\w-]+)\]:/;
const NOTE = /\[\^([\w-]+)\](?!:)/g;
const notesIn = (s: string) => new Set([...s.matchAll(NOTE)].map((m) => m[1]));
const PREAMBLE = "(préambule)";

// --- 1. the sections that carry a callout

/** A `##` section of a page body (the preamble is section 0, `title` null) holding at least one contradiction callout. */
type Unit = {
  page: Page; title: string | null; /** Lines [from, to) of the body. */ from: number; to: number;
  /** The section without its heading and its note definitions. */ text: string; callouts: string[];
  /** Hash of (page, heading, text): what a proposal was made from. */ base: string;
};

const CALLOUT = /^>\s*\[!warning\]\s*Contradiction\b/i;

/** The callouts of some lines: each one is its `> ` lines (marker and header line left out), joined. */
function calloutsOf(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!CALLOUT.test(lines[i])) continue;
    const body: string[] = [];
    while (i + 1 < lines.length && /^>/.test(lines[i + 1]) && !CALLOUT.test(lines[i + 1])) body.push(lines[++i].replace(/^>\s?/, ""));
    out.push(one(body.join(" ")));
  }
  return out;
}

/** The `##` sections of a body as line ranges; a `###` stays inside its `##`, fenced code is never a heading. */
function ranges(lines: string[]): { title: string | null; from: number; to: number }[] {
  const out: { title: string | null; from: number; to: number }[] = [{ title: null, from: 0, to: lines.length }];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) fence = !fence;
    const h = !fence && /^##\s+(\S.*?)\s*#*\s*$/.exec(l);
    if (h) { out.at(-1)!.to = i; out.push({ title: h[1], from: i, to: lines.length }); }
  });
  return out;
}

/** Sections of `page` (read from `text`) with a contradiction callout. */
function unitsOf(page: Page, text: string): Unit[] {
  const lines = parseDoc(page.path, text).body.split("\n");
  return ranges(lines).flatMap((r) => {
    const own = lines.slice(r.from, r.to), callouts = calloutsOf(own);
    if (!callouts.length) return [];
    const body = own.slice(r.title === null ? 0 : 1).filter((l) => !DEF.test(l)).join("\n").trim();
    return [{ page, title: r.title, from: r.from, to: r.to, text: body, callouts, base: sha256([page.path, r.title ?? "", body].join("\0")).slice(0, 12) }];
  });
}

/** Callouts are only found where the ingestion writes them: live Concept, Entity and Synthesis pages. */
const eligible = (p: Page) => p.fm.type !== "Source" && p.fm.status !== "deprecated" && !isReservedPage(p.path);
const heading = (u: { title: string | null }) => u.title ?? PREAMBLE;
const label = (u: Unit) => `« ${title(u.page)} » § ${heading(u)}`;

// --- 2. what the model reads: the Source pages behind the notes

type Cited = { id?: unknown; title?: unknown; resource?: unknown };
const citesOf = (p: { fm: Record<string, unknown> }): Cited[] => (Array.isArray(p.fm.sources) ? p.fm.sources : []).filter((s) => s && typeof s === "object");

/** The summary of the Source page that cites the note `id` of `page` (its opening text, else its description), or the note's title when there is no Source page. */
function sourceLine(pages: Page[], page: Page, id: string): string {
  const entry = citesOf(page).find((c) => c.id === id);
  const src = entry?.resource ? pages.find((p) => p.fm.type === "Source" && citesOf(p).some((c) => c.resource === entry.resource)) : undefined;
  if (!src) return `[^${id}] ${one(entry?.title) || id} (no summary page)`;
  const summary = one(src.body.split(/^##\s/m)[0].split("\n").filter((l) => !/^>/.test(l) && !DEF.test(l)).join(" ").replace(NOTE, "")) || one(src.fm.description);
  return `[^${id}] ${title(src)}: ${clip(summary, 900)}`;
}

// --- 3. the resolution

type Resolution = { verdict: Verdict; section: string; note: string };
type Outcome = { resolved: Resolution } | { review: string } | { failed: string };

const RESOLVE = (max: number) => ({
  type: "object", additionalProperties: false, required: ["verdict", "section", "note"],
  properties: {
    verdict: { enum: ["newer_source_wins", "older_text_wins", "both_hold", "unsure"] },
    section: { type: "string", maxLength: max }, note: { type: "string", maxLength: 400 },
  },
});

/** What the model's section becomes: no heading of the section, no `#`/`##` heading, no note definition, no leftover callout. */
function tidy(section: string, name: string | null): string {
  const lines = section.replace(/\r/g, "").split("\n");
  if (name !== null && lines.length && new RegExp(`^#{1,6}\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i").test(lines[0].trim())) lines.shift();
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (CALLOUT.test(lines[i])) { while (i + 1 < lines.length && /^>/.test(lines[i + 1]) && !CALLOUT.test(lines[i + 1])) i++; continue; }
    if (!DEF.test(lines[i])) out.push(lines[i].replace(/^#{1,2}(?=\s)/, "###"));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Asks the 4B to settle the contradiction of `u`: the grammar shapes the answer, zod checks the footnotes and the length. */
async function resolve(w: Wiki, u: Unit, pages: Page[]): Promise<Outcome> {
  const cfg = await w.config(), language = cfg.language ?? DEFAULT_LANGUAGE;
  const before = notesIn(u.text), fromCallout = [...notesIn(u.callouts.join(" "))];
  const valid = new Set([...citesOf(u.page).map((c) => String(c.id ?? "")).filter(Boolean), ...before]);
  const others = [...before].filter((id) => !fromCallout.includes(id)).slice(0, 4);
  const lines = [...fromCallout.map((id) => sourceLine(pages, u.page, id)), ...others.map((id) => sourceLine(pages, u.page, id))];
  const user = [`Page: ${title(u.page)}`, `Section: ${heading(u)}`, `Valid footnote ids: ${[...valid].join(", ") || "none"}`,
    `Contradiction callout${u.callouts.length > 1 ? "s" : ""}, written when the newer source${fromCallout.length > 1 ? "s were" : " was"} added (${fromCallout.map((i) => `[^${i}]`).join(", ") || "no footnote"}):\n${u.callouts.map((c) => `- ${c}`).join("\n")}`,
    `Summaries of the sources:\n${lines.join("\n") || "none"}`, `Section text (the callout${u.callouts.length > 1 ? "s" : ""} included):\n${u.text}`].join("\n\n");
  const tokens = estimateTokens(user);
  if (tokens > LIMITS.contradictionInputTokens) return { review: `section trop longue pour un seul appel (${tokens} tokens, ${LIMITS.contradictionInputTokens} au plus)` };

  const plain = (s: string) => s.replace(NOTE, "").replace(/\s+/g, " ").trim().length;
  const inner = u.text.split("\n").filter((l) => !/^>/.test(l)).join("\n");
  const zod = z.object({ verdict: z.enum(["newer_source_wins", "older_text_wins", "both_hold", "unsure"]), section: z.string(), note: z.string() }).superRefine((v, ctx) => {
    const add = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (!one(v.note)) add("note", "empty note: one sentence that explains how you settled it");
    if (v.note.length > 400) add("note", "too long (400 characters at most)");
    if (v.verdict === "unsure") return;
    const body = tidy(v.section, u.title), got = notesIn(body), lost = [...before].filter((id) => !got.has(id)), unknown = [...got].filter((id) => !valid.has(id));
    if (!body) add("section", "empty section");
    else if (plain(body) < plain(inner) / 2) add("section", "too short: keep every fact of the section and of the callout");
    if (unknown.length) add("section", `unknown footnote ids: ${unknown.join(", ")} (valid ids: ${[...valid].join(", ")})`);
    if (lost.length) add("section", `footnotes lost: ${lost.map((i) => `[^${i}]`).join(", ")}. Keep every fact of the section and of the callout, each with its footnote id`);
  });
  const maxTokens = Math.min(4096, Math.max(LIMITS.contradictionOutputTokens, estimateTokens(u.text) + 400));
  try {
    const r = await structured(cfg, { name: "resolve", system: pipelinePrompt("resolve", { language }), user, schema: RESOLVE(Math.max(4000, u.text.length * 2)), zod, maxTokens });
    return { resolved: { verdict: r.verdict, section: r.verdict === "unsure" ? "" : tidy(r.section, u.title), note: one(r.note) } };
  } catch (e) {
    return /no valid answer/.test((e as Error).message) ? { review: `le modèle n'a pas rendu de résolution valide : ${(e as Error).message}` } : { failed: (e as Error).message };
  }
}

/** d3-mini: does the rewritten section keep every fact of the section and of the callout, with its citation? Undefined without a judge. */
async function keepsFacts(w: Wiki, u: Unit, r: Resolution): Promise<number | undefined> {
  const a = (await judge(w.root, { before: clip(u.text, 1100), callout: clip(u.callouts.join(" "), 300), section: clip(r.section, 1400) }, {
    keeps: { type: "noul", instructions: "Does `section` keep every fact of `before` and of `callout`, each with its citation?" },
  }))?.keeps;
  return a?.type === "noul" ? a.noul : undefined;
}

// --- 4. the proposal of a queue entry (what `cortex queue apply` reads back)

const proposalOf = (u: Unit, r: Resolution) =>
  [`Verdict: ${r.verdict}`, `Section: ${heading(u)}`, `Base: ${u.base}`, `Note: ${r.note}`, ...(r.section ? ["", "---", "", r.section] : [])].join("\n");

/** The fields of a proposal written by `proposalOf`; undefined for an entry made by hand. */
function readProposal(s: string | undefined): { verdict: Verdict; section: string; base: string; note: string; body: string } | undefined {
  if (!s) return;
  const [head, ...rest] = s.split(/\n---\n/);
  const f = (k: string) => new RegExp(`^${k}: (.*)$`, "m").exec(head)?.[1]?.trim();
  const [verdict, section, base] = [f("Verdict"), f("Section"), f("Base")];
  if (!verdict || section === undefined || !base) return;
  return { verdict: verdict as Verdict, section, base, note: f("Note") ?? "", body: rest.join("\n---\n").trim() };
}

/** The open `contradiction` entry made for this section (same text), if any. */
const queuedEntry = (w: Wiki, u: Unit) => queueItems(w.queue().entries).find((i) => {
  const p = readProposal(i.proposal);
  return i.status === "open" && i.kind === "contradiction" && i.pages[0] === u.page.path && p?.section === heading(u) && p.base === u.base;
});

// --- 5. the write

/** Replaces the section of `text` (the lines [from, to) of the body) by `body`; the other lines stay byte for byte, the note definitions of the section stay under it. */
function replaceSection(text: string, u: Unit, body: string): string {
  const doc = parseDoc(u.page.path, text), head = text.slice(0, text.length - doc.body.length), lines = doc.body.split("\n");
  const own = lines.slice(u.from, u.to), defs = own.filter((l) => DEF.test(l));
  const next = [...(u.title === null ? [] : [own[0], ""]), ...body.split("\n"), ...(defs.length ? ["", ...defs] : []), ...(u.to < lines.length ? [""] : [])];
  return head + [...lines.slice(0, u.from), ...next, ...lines.slice(u.to)].join("\n");
}

type Applied = { ok: true } | { ok: false; why: string };

/**
 * Writes the rewritten section of the page: the callout goes with the old text, the page is `draft`, stamped, the entry
 * that proposed it (`entry`) is closed and the journal says what was settled. The section is looked up again by its heading
 * and its hash: when the page moved on since the proposal, nothing is written.
 */
async function writeResolution(w: Wiki, path: string, at: { section: string; base: string }, r: Resolution, now: Date, entry?: QueueItem): Promise<Applied> {
  const root = w.root, cfg = await w.config(), pages = await openWiki(root).pages(), page = pages.find((p) => p.path === path);
  if (!page) return { ok: false, why: `page introuvable : ${path}` };
  if (page.fm.status === "deprecated") return { ok: false, why: `${path} est dépréciée` };
  const text = readFileSync(join(root, path), "utf8");
  let u;
  try { u = unitsOf(page, text).find((x) => heading(x) === at.section && x.base === at.base); } catch (e) { return { ok: false, why: (e as Error).message }; }
  if (!u) return { ok: false, why: `la section « ${at.section} » n'a plus cet encadré ou a changé depuis la proposition (relancer cortex maintain contradictions --apply)` };
  let out = replaceSection(text, u, r.section);
  if (page.fm.status !== "draft") out = setFmLine(out, "status", "status: draft");
  const err = frontmatterError(out);
  if (err) return { ok: false, why: `${path} : la résolution casserait le frontmatter (${err})` };
  writeFileSync(join(root, path), out);
  await stamp(root, [path], actor({ ...cfg, effort: "maintain" }), now, tagUsage(pages).inUse, new Set(), cfg.max_tags ?? LIMITS.maxTags);
  const open = entry ?? queuedEntry(w, u);
  if (open) await closeCtx(w, open.n, "done", now);
  await logUpdate(w, `contradiction résolue dans « ${title(page)} » § ${at.section} (${r.verdict}) : ${r.note}`, [path], now);
  return { ok: true };
}

/** Lint errors of the pages a run wrote: by construction there should be none, so they are said. */
async function checkWritten(w: Wiki, paths: string[], say: Say) {
  const files = new Set(paths);
  for (const i of (await lint(w.root)).filter((i) => i.level === "error" && files.has(i.path.replace(/:\d+$/, "")))) say("warn", `${i.path} : ${i.msg}`, "  ⚠");
}

// --- the subcommand

export const maintainContradictions: Task = async (w, o, say) => {
  const now = o.now ?? (() => new Date()), root = w.root, apply = !!o.apply;
  const items: Item[] = [];
  const pages = await w.pages();
  const units = pages.filter(eligible).sort((a, b) => collator.compare(a.path, b.path)).flatMap((p) => {
    try { return unitsOf(p, readFileSync(join(root, p.path), "utf8")); } catch { return []; }
  });
  if (!units.length) { say("info", "Aucun encadré de contradiction à résoudre."); return { ok: true, items }; }
  if (apply && !(await w.config()).model) { say("fail", "cortex maintain contradictions --apply a besoin d'un modèle : cortex config set model <nom>"); return { ok: false, items }; }
  const state = readState<State>(root, "contradictions", { queued: {} });
  const hasJudge = !!(await judgeConfig(root));
  if (apply && !hasJudge) say("warn", "pas de juge (cortex config set judge.base_url) : rien n'est appliqué, les résolutions vont dans la file", "  ⚠");
  const written: string[] = [];
  let tried = 0, resolved = 0, queued = 0, seen = 0, ok = true, changed = false;

  /** A proposal for a human: one entry per section, and the section is not asked again until it changes. */
  const propose = async (u: Unit, kind: "contradiction" | "review", reason: string, r?: Resolution) => {
    const added = kind === "review"
      ? await enqueueOnce(w, { kind, title: `Contradiction non résolue : ${title(u.page)} § ${heading(u)}`, reason, pages: [u.page.path] }, now())
      : !queuedEntry(w, u) && (await enqueueCtx(w, { kind, title: `Contradiction : ${title(u.page)} § ${heading(u)}`, reason, pages: [u.page.path], proposal: proposalOf(u, r!) }, now()), true);
    state.queued[sha256([u.page.path, heading(u), u.text].join("\0"))] = localDay(now()); changed = true;
    queued++;
    items.push({ action: added ? (kind === "review" ? "review" : "queued") : "already-queued", pages: [u.page.path], note: `${heading(u)} : ${reason}` });
    say(kind === "review" ? "warn" : "info", `${added ? (kind === "review" ? "à revoir" : "en file") : "déjà en file"} : ${label(u)} (${reason})`, kind === "review" ? "  ⚠" : undefined);
  };

  for (const u of units) {
    if (state.queued[sha256([u.page.path, heading(u), u.text].join("\0"))]) { seen++; continue; }
    if (o.limit !== undefined && tried >= o.limit) break;
    tried++;
    if (!apply) { items.push({ action: "would-resolve", pages: [u.page.path], note: heading(u) }); say("info", `encadré de contradiction à résoudre : ${label(u)}`); continue; }
    const r = await resolve(w, u, pages);
    if ("failed" in r) { ok = false; items.push({ action: "failed", pages: [u.page.path], note: r.failed }); say("fail", `${label(u)} : ${r.failed}`); continue; }
    if ("review" in r) { await propose(u, "review", r.review); continue; }
    const v = r.resolved;
    if (v.verdict === "unsure") { await propose(u, "contradiction", "le modèle ne tranche pas (unsure) : à décider à la main", v); continue; }
    const keep = hasJudge ? await keepsFacts(w, u, v) : undefined;
    if (keep === undefined) { await propose(u, "contradiction", `${v.verdict}, sans juge pour vérifier que rien n'est perdu`, v); continue; }
    if (!confident(keep)) { await propose(u, "contradiction", `${v.verdict}, d3-mini : ${keep.toFixed(2)} (il faut ${LIMITS.maintainJudge} au moins pour appliquer seul)`, v); continue; }
    const wr = await writeResolution(w, u.page.path, { section: heading(u), base: u.base }, v, now());
    if (!wr.ok) { await propose(u, "review", wr.why); continue; }
    resolved++; written.push(u.page.path);
    items.push({ action: "resolved", pages: [u.page.path], note: `${heading(u)} : ${v.verdict} ${keep.toFixed(2)}` });
    say("ok", `contradiction résolue : ${label(u)} (${v.verdict} ${keep.toFixed(2)}) : ${v.note}`);
  }
  if (changed) writeState(root, "contradictions", state);
  const added = items.filter((i) => i.action === "queued" || i.action === "review");
  if (added.length) await logUpdate(w, `maintenance contradictions : ${resolved} résolue(s), ${added.length} entrée(s) ajoutée(s) à la file`, [...new Set(added.flatMap((i) => i.pages))], now()); // the resolutions wrote their own lines
  if (resolved) { await regenerateCtx(openWiki(root)); await checkWritten(w, written, say); }
  say(ok ? "ok" : "warn", `${apply ? `${resolved} résolue(s), ${queued} en file` : `${items.length} section(s) à résoudre`}${seen ? `, ${seen} déjà proposée(s)` : ""}${apply ? "" : " ; --apply écrit (rien n'a été modifié)"}`);
  return { ok, items };
};

/** `cortex queue apply <n>` on a `contradiction` entry: the human has read the proposal, so the judge is not asked again. */
export async function applyContradictionEntry(w: Wiki, item: QueueItem, say: Say): Promise<boolean> {
  const p = readProposal(item.proposal), path = item.pages[0];
  const fail = (why: string) => { say("fail", `#${item.n} : ${why}; l'entrée reste ouverte`); return false; };
  if (!p || item.pages.length !== 1) return fail("l'entrée n'a pas la proposition de cortex maintain contradictions, à résoudre à la main");
  if (p.verdict === "unsure" || !p.body) return fail("le modèle n'a pas tranché, à résoudre à la main");
  const r = await writeResolution(w, path, p, { verdict: p.verdict, section: p.body, note: p.note }, new Date(), item);
  if (!r.ok) return fail(r.why);
  await regenerateCtx(openWiki(w.root));
  await checkWritten(w, [path], say);
  say("ok", `#${item.n} appliquée : contradiction résolue dans ${path} § ${p.section} (${p.verdict})`);
  return true;
}
