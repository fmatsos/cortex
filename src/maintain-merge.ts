import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { actor, stamp, tagUsage } from "./agent";
import { regenerateCtx } from "./catalog";
import { estimateTokens } from "./chunk";
import { addNoteDefs, noteDef } from "./cite";
import { openWiki, type Wiki } from "./context";
import { dateMs, type Page } from "./doc";
import { similar } from "./embed";
import { clip, judge, judgeConfig } from "./judge";
import { frontmatterError, isReservedPage, parseDoc, setFmLine, sha256, slugify } from "./lib";
import { LIMITS } from "./limits";
import { lint } from "./lint";
import { stampLinked } from "./links";
import { structured } from "./llm";
import { confident, enqueueOnce, type Item, logUpdate, openEntry, readState, type Say, type Task, writeState } from "./maintain";
import { nearTitle } from "./naming";
import { pipelinePrompt } from "./prompts";
import { closeCtx, type QueueItem } from "./queue";
import { DEFAULT_LANGUAGE } from "./schema";
import { collator } from "./text";

// --- `cortex maintain merge` (docs/PIPELINE.md §8.1): two pages on the same subject become one. Candidates come from the
// stored embeddings and from near titles, d3-mini says whether they are the same subject, the 4B writes the merged page, and
// cortex does the rest (target = the oldest page, the other one is deprecated and points at it, inbound links follow).

type Pair = { a: string; b: string; /** Cosine of the stored vectors; 0 for a pair found by its titles only. */ score: number };
type State = { /** Hash of the two pages (path and text) a judge found to be different subjects: not asked again until one changes. */ different: Record<string, string> };

const read = (root: string, p: string) => readFileSync(join(root, p), "utf8");
const one = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const title = (p: { fm: { title?: unknown }; path: string }) => one(p.fm.title) || p.path;
const localDay = (d: Date) => d.toISOString().slice(0, 10);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A page body with the model's or the page's note definitions removed (cortex writes those from `sources[]`). */
const noDefs = (body: string) => body.replace(/^\[\^[\w-]+\]:.*\n?/gm, "").trim();
const notesIn = (body: string) => new Set([...body.matchAll(/\[\^([\w-]+)\](?!:)/g)].map((m) => m[1]));
const withBody = (text: string, body: string) => text.slice(0, text.length - parseDoc("", text).body.length) + body;

// --- 1. candidate pairs

/** Same-type Concept and Entity pages (not deprecated) close in meaning (cosine of the stored vectors, no server call) or by title. Best first; `embeddings`: the vectors were there. */
async function candidates(w: Wiki, pages: Page[]): Promise<{ pairs: Pair[]; embeddings: boolean }> {
  const eligible = pages.filter((p) => (p.fm.type === "Concept" || p.fm.type === "Entity") && p.fm.status !== "deprecated" && !isReservedPage(p.path)).sort((a, b) => collator.compare(a.path, b.path));
  const byPath = new Map(eligible.map((p) => [p.path, p]));
  const found = new Map<string, Pair>();
  const add = (x: Page, y: Page, score: number) => {
    if (x.fm.type !== y.fm.type || x.path === y.path) return;
    const [a, b] = collator.compare(x.path, y.path) < 0 ? [x.path, y.path] : [y.path, x.path];
    found.set(`${a}\0${b}`, { a, b, score: Math.max(score, found.get(`${a}\0${b}`)?.score ?? 0) });
  };
  let embeddings = false;
  for (const p of eligible) {
    const near = await similar(w.root, p.path, 8);
    if (!near) continue;
    embeddings = true;
    for (const h of near) if (h.score >= LIMITS.mergeCosine && byPath.has(h.path)) add(p, byPath.get(h.path)!, h.score);
  }
  for (const [i, x] of eligible.entries()) for (const y of eligible.slice(i + 1)) {
    if (x.fm.title && y.fm.title && (slugify(x.fm.title, Infinity) === slugify(y.fm.title, Infinity) || nearTitle(title(x), title(y)))) add(x, y, 0);
  }
  return { pairs: [...found.values()].sort((p, q) => q.score - p.score || collator.compare(p.a, q.a) || collator.compare(p.b, q.b)), embeddings };
}

// --- 2. the judge

type Verdict = { choice: "same" | "overlapping" | "different"; p: number };
const CRITERIA = {
  same: "`a` and `b` are the same subject: one page would do",
  overlapping: "`a` and `b` overlap, but each one also has a subject of its own",
  different: "`a` and `b` are different subjects, even if related",
};

/** d3-mini on the titles and descriptions of the two pages; undefined without a judge (or when it is down). */
async function verdict(w: Wiki, a: Page, b: Page): Promise<Verdict | undefined> {
  const side = (p: Page) => ({ type: String(p.fm.type), title: title(p), description: clip(one(p.fm.description), 400) });
  const r = (await judge(w.root, { a: side(a), b: side(b) }, {
    pair: { type: "choice", instructions: "Do the wiki pages `a` and `b` cover the same subject, so that they should be a single page?", criteria: CRITERIA },
  }))?.pair;
  if (r?.type !== "choice" || !(r.choice in CRITERIA)) return;
  return { choice: r.choice as Verdict["choice"], p: r.probabilities[r.choice] ?? r.confidence ?? 0 };
}

// --- 3. which page stays

const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/i;
const stem = (p: string) => p.split("/").at(-1)!.replace(/\.md$/, "").toLowerCase();

/** Negative when `a` is the older page: UUID v7 of the file name (the first created), else `generated.at`, else the path. */
function older(a: Page, b: Page): number {
  if (UUID7.test(stem(a.path)) && UUID7.test(stem(b.path)) && stem(a.path) !== stem(b.path)) return stem(a.path) < stem(b.path) ? -1 : 1;
  const [x, y] = [dateMs(a.fm.generated?.at), dateMs(b.fm.generated?.at)];
  if (x !== undefined && y !== undefined && x !== y) return x - y;
  return collator.compare(a.path, b.path);
}

// --- 4. the merge of one pair

type Cited = { id?: unknown; title?: unknown; resource?: unknown };
const cites = (d: { fm: Record<string, unknown> }): Cited[] => (Array.isArray(d.fm.sources) ? d.fm.sources : []).filter((s) => s && typeof s === "object");
const MERGED = (max: number) => ({
  type: "object", additionalProperties: false, required: ["title", "description", "body"],
  properties: { title: { type: "string", maxLength: 80 }, description: { type: "string", maxLength: 160 }, body: { type: "string", maxLength: max } },
});
/** A link to a page of the wiki as the model may have written it. */
const LINK = /\[([^\]]*)\]\((\/wiki\/[^)\s#]*\.md)(?:#[^)\s]*)?\)/g;
/** An item of weave's « Pages liées »: a link alone on its line. */
const ITEM = /^\s*[-*] \[[^\]]*\]\((\/wiki\/[^)#\s]*)\)\s*$/;

export type Merge = { target: string; absorbed: string };
/** `review`: nothing written, a human looks (reason given); `failed`: the model server did not answer, nothing to queue. */
type Outcome = { merged: Merge } | { review: string } | { failed: string };

/**
 * Merges the pages `p` and `q` (the older one is the target). Reads both from disk, asks the model for the merged page,
 * checks it (footnotes, size), then writes the target, deprecates the other and rewrites the links to it. The target is
 * written first: a crash in between leaves two pages that a rerun merges again, never a deprecated page pointing at
 * a page that lacks its facts.
 */
async function mergePair(w: Wiki, p: string, q: string, now: Date): Promise<Outcome> {
  const root = w.root, cfg = await w.config(), language = cfg.language ?? DEFAULT_LANGUAGE;
  const pages = await openWiki(root).pages(), byPath = new Map(pages.map((x) => [x.path, x]));
  const [pa, pb] = [byPath.get(p), byPath.get(q)];
  if (!pa || !pb) return { review: `page introuvable : ${byPath.has(p) ? q : p}` };
  if (pa.fm.type !== pb.fm.type || pa.fm.status === "deprecated" || pb.fm.status === "deprecated") return { review: "les pages ne sont plus fusionnables (type différent ou page déjà dépréciée)" };
  const [t, x] = older(pa, pb) <= 0 ? [pa, pb] : [pb, pa];
  const tText = read(root, t.path), xText = read(root, x.path);
  let td, xd;
  try { [td, xd] = [parseDoc(t.path, tText), parseDoc(x.path, xText)]; } catch (e) { return { review: (e as Error).message }; }

  // footnote ids: the absorbed page's notes follow the target's when they cite the same resource, and are renamed when an id is taken for another one
  const entries: Cited[] = [...cites(td)], taken = new Set(entries.map((e) => String(e.id ?? ""))), rename = new Map<string, string>();
  for (const s of cites(xd)) {
    const same = s.resource ? entries.find((e) => e.resource === s.resource && e.id) : undefined;
    const id = String(s.id ?? "");
    if (same) { if (id) rename.set(id, String(same.id)); continue; }
    let to = id;
    for (let n = 2; id && taken.has(to); n++) to = `${id}-${n}`;
    if (id) { taken.add(to); if (to !== id) rename.set(id, to); }
    entries.push(to === id ? s : { ...s, id: to });
  }
  const bt = noDefs(td.body), bx = noDefs(xd.body).replace(/\[\^([\w-]+)\](?!:)/g, (m, id) => (rename.has(id) ? `[^${rename.get(id)}]` : m));
  const [nt, nx] = [notesIn(bt), notesIn(bx)], before = new Set([...nt, ...nx]), valid = new Set([...entries.map((e) => String(e.id ?? "")).filter(Boolean), ...before]);
  const tokens = estimateTokens(bt + bx);
  if (tokens > LIMITS.mergeInputTokens) return { review: `pages trop longues pour un seul appel (${tokens} tokens, ${LIMITS.mergeInputTokens} au plus ensemble)` };

  // the model: the schema sent to the server, then what cortex checks that a grammar cannot
  const plain = (b: string) => b.replace(/\[\^[\w-]+\]/g, "").replace(/\s+/g, " ").trim().length;
  const zod = z.object({ title: z.string(), description: z.string(), body: z.string() }).superRefine((v, ctx) => {
    const add = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    const got = notesIn(v.body), unknown = [...got].filter((id) => !valid.has(id)), lost = [...before].filter((id) => !got.has(id));
    if (!v.body.trim()) add("body", "empty body");
    else if (plain(v.body) < Math.max(plain(bt), plain(bx)) / 2) add("body", "too short: keep every fact of both pages");
    if (unknown.length) add("body", `unknown footnote ids: ${unknown.join(", ")} (valid ids: ${[...valid].join(", ")})`);
    if (before.size && before.size - lost.length < LIMITS.mergeKeepNotes * before.size) add("body", `footnotes lost: ${lost.join(", ")}. Keep every fact of both pages with its footnote id`);
    if (v.description.length > 160) add("description", "too long (160 characters at most)");
  });
  const user = [`Valid footnote ids: ${[...valid].join(", ") || "none"}`,
    `Page 1 (keep its structure where possible)\nTitle: ${title(t)}\nDescription: ${one(t.fm.description)}\nBody:\n${bt}`,
    `Page 2\nTitle: ${title(x)}\nDescription: ${one(x.fm.description)}\nBody:\n${bx}`].join("\n\n");
  // the spec's 2000 tokens hold two short pages; the output of two long ones is as long as their input
  const maxTokens = Math.min(8192, Math.max(LIMITS.mergeOutputTokens, tokens + 500));
  let m;
  try {
    m = await structured(cfg, { name: "merge", system: pipelinePrompt("merge", { language }), user, schema: MERGED(Math.max(8000, (bt + bx).length)), zod, maxTokens });
  } catch (e) {
    return /no valid answer/.test((e as Error).message) ? { review: `le modèle n'a pas rendu de page valide : ${(e as Error).message}` } : { failed: (e as Error).message };
  }

  // the merged page: its links only go to pages that exist and are not the pair, its notes are defined from `sources[]`
  const body = noDefs(m.body).replace(LINK, (all, text, path) => (path.slice(1) !== t.path && path.slice(1) !== x.path && byPath.has(path.slice(1)) ? all : text));
  const cited = notesIn(body), newTitle = one(m.title);
  const others = new Set(pages.filter((o) => o !== t && o !== x).map((o) => slugify(title(o), Infinity)));
  const name = newTitle && !others.has(slugify(newTitle, Infinity)) ? newTitle : title(t);
  const tags = [...new Set([...(Array.isArray(td.fm.tags) ? td.fm.tags : []), ...(Array.isArray(xd.fm.tags) ? xd.fm.tags : [])].map(String))];
  const aliases = [...new Set([...[td.fm.aliases, xd.fm.aliases].flat().filter((a): a is string => typeof a === "string"), title(t), title(x)])].filter((a) => slugify(a, Infinity) !== slugify(name, Infinity));
  let out = tText;
  out = setFmLine(out, "title", `title: ${JSON.stringify(name)}`);
  if (one(m.description)) out = setFmLine(out, "description", `description: ${JSON.stringify(one(m.description))}`);
  if (entries.length) out = setFmLine(out, "sources", Bun.YAML.stringify({ sources: entries }, null, 2).trimEnd());
  if (tags.length) out = setFmLine(out, "tags", `tags: ${JSON.stringify(tags)}`);
  if (aliases.length) out = setFmLine(out, "aliases", `aliases: ${JSON.stringify(aliases)}`);
  out = setFmLine(out, "status", "status: draft");
  const defs = entries.filter((e) => e.id && cited.has(String(e.id))).map((e) => noteDef(String(e.id), one(e.title) || String(e.id), e.resource ? String(e.resource) : undefined));
  out = withBody(out, addNoteDefs(`${body}\n`, defs));
  const gone = setFmLine(setFmLine(xText, "status", "status: deprecated"), "superseded_by", `superseded_by: ${JSON.stringify(`/${t.path}`)}`);
  const goneOut = withBody(gone, `${/^fr/i.test(language) ? "Remplacée par" : "Replaced by"} [${name}](/${t.path}).\n\n${xd.body.replace(/^\s+/, "")}`);
  for (const [path, text] of [[t.path, out], [x.path, goneOut]]) { const err = frontmatterError(text); if (err) return { review: `${path} : la fusion casserait le frontmatter (${err})` }; }
  writeFileSync(join(root, t.path), out);
  writeFileSync(join(root, x.path), goneOut);
  await stamp(root, [t.path, x.path], actor({ ...cfg, effort: "maintain" }), now, tagUsage(pages).inUse, new Set(), cfg.max_tags ?? LIMITS.maxTags);

  // links to the absorbed page, everywhere but in itself (and in the target, whose merged body has none): the target, without the anchor (its sections are not the old ones)
  const re = new RegExp(`\\]\\(/${escapeRe(x.path)}(?:#[^)\\s]*)?\\)`, "g");
  for (const o of pages) {
    if (o.path === x.path || o.path === t.path || isReservedPage(o.path)) continue;
    const prev = read(root, o.path);
    let d;
    try { d = parseDoc(o.path, prev); } catch { continue; }
    const next = d.body.replace(re, `](/${t.path})`), moved = d.fm.superseded_by === `/${x.path}`;
    if (next === d.body && !moved) continue;
    const seen = new Set<string>();
    const lines = next.split("\n").filter((l) => { const k = ITEM.exec(l)?.[1]; return k !== `/${t.path}` || !seen.has(k) && !!seen.add(k); });
    let text = withBody(prev, lines.join("\n"));
    if (moved) text = setFmLine(text, "superseded_by", `superseded_by: ${JSON.stringify(`/${t.path}`)}`);
    writeFileSync(join(root, o.path), stampLinked(o.path, prev, text, now));
  }

  const open = openEntry(w, "merge", [t.path, x.path]);
  if (open) await closeCtx(w, open.n, "done", now);
  await logUpdate(w, `fusion : « ${title(x)} » absorbée dans « ${name} » (${x.path} dépréciée, superseded_by ${t.path})`, [t.path, x.path], now);
  return { merged: { target: t.path, absorbed: x.path } };
}

/** Lint errors of the pages a run wrote: by construction there should be none, so they are said. */
async function checkWritten(w: Wiki, merged: Merge[], say: Say) {
  const files = new Set(merged.flatMap((m) => [m.target, m.absorbed]));
  for (const i of (await lint(w.root)).filter((i) => i.level === "error" && files.has(i.path.replace(/:\d+$/, "")))) say("warn", `${i.path} : ${i.msg}`, "  ⚠");
}

// --- the subcommand

export const maintainMerge: Task = async (w, o, say) => {
  const now = o.now ?? (() => new Date()), root = w.root, apply = !!o.apply;
  const items: Item[] = [], merged: Merge[] = [];
  const pages = await w.pages(), byPath = new Map(pages.map((p) => [p.path, p]));
  const { pairs, embeddings } = await candidates(w, pages);
  if (!embeddings) say("warn", "embeddings absentes ou pas à jour (cortex index) : seules les paires de titres proches sont examinées", "  ⚠");
  if (!pairs.length) { say("info", "Aucune paire de pages proches à fusionner."); return { ok: true, items }; }
  if (apply && !(await w.config()).model) { say("fail", "cortex maintain merge --apply a besoin d'un modèle : cortex config set model <nom>"); return { ok: false, items }; }
  const state = readState<State>(root, "merge", { different: {} });
  const hasJudge = !!(await judgeConfig(root));
  const touched = new Set<string>();
  let judged = 0, queued = 0, different = 0, ok = true, changed = false;
  for (const pr of pairs) {
    if (o.limit !== undefined && judged >= o.limit) break;
    if (touched.has(pr.a) || touched.has(pr.b)) continue; // a page is merged once per run; the next run sees the new state
    const [a, b] = [byPath.get(pr.a)!, byPath.get(pr.b)!], label = `« ${title(a)} » / « ${title(b)} »`;
    const key = sha256([pr.a, read(root, pr.a), pr.b, read(root, pr.b)].join("\0"));
    if (state.different[key]) { different++; continue; }
    judged++;
    const v = hasJudge ? await verdict(w, a, b) : undefined;
    if (!v) { items.push({ action: "candidate", pages: [pr.a, pr.b], note: "sans juge" }); say("info", `paire candidate, sans juge (rien n'est fusionné) : ${label}`); continue; }
    const score = `${v.choice} ${v.p.toFixed(2)}`;
    if (v.choice === "different") {
      different++;
      if (apply && confident(v.p)) { state.different[key] = localDay(now()); changed = true; }
      continue;
    }
    if (v.choice === "same" && confident(v.p)) {
      const [t, x] = older(a, b) <= 0 ? [a, b] : [b, a];
      if (!apply) { items.push({ action: "would-merge", pages: [t.path, x.path], note: score }); say("info", `à fusionner : « ${title(x)} » dans « ${title(t)} » (${score})`); continue; }
      const r = await mergePair(w, pr.a, pr.b, now());
      if ("merged" in r) {
        merged.push(r.merged); touched.add(r.merged.target); touched.add(r.merged.absorbed);
        items.push({ action: "merged", pages: [r.merged.target, r.merged.absorbed], note: score });
        say("ok", `fusion : « ${title(x)} » absorbée dans « ${title(t)} » (${score})`);
      } else if ("review" in r) {
        const added = await enqueueOnce(w, { kind: "review", title: `Fusion non faite : ${title(a)} / ${title(b)}`, reason: r.review, pages: [pr.a, pr.b] }, now());
        items.push({ action: "review", pages: [pr.a, pr.b], note: r.review });
        say("warn", `${label} : ${r.review}${added ? " ; entrée de revue dans la file" : ""}`, "  ⚠");
      } else { ok = false; items.push({ action: "failed", pages: [pr.a, pr.b], note: r.failed }); say("fail", `${label} : ${r.failed}`); }
      continue;
    }
    // overlapping, or the same subject without enough certainty: a human decides (`cortex queue apply <n>` merges them)
    queued++;
    const reason = `d3-mini : ${score} (il faut « same » à ${LIMITS.maintainJudge} au moins pour fusionner seul)`;
    if (!apply) { items.push({ action: "would-queue", pages: [pr.a, pr.b], note: score }); say("info", `à mettre en file : ${label} (${score})`); continue; }
    const added = await enqueueOnce(w, { kind: "merge", title: `Fusion possible : ${title(a)} / ${title(b)}`, reason, pages: [pr.a, pr.b], proposal: `- ${title(a)} : ${one(a.fm.description)}\n- ${title(b)} : ${one(b.fm.description)}` }, now());
    items.push({ action: added ? "queued" : "already-queued", pages: [pr.a, pr.b], note: score });
    say("info", `${added ? "en file" : "déjà en file"} : ${label} (${score})`);
  }
  if (changed) writeState(root, "merge", state);
  const added = items.filter((i) => i.action === "queued" || i.action === "review");
  if (added.length) await logUpdate(w, `maintenance merge : ${merged.length} fusion(s), ${added.length} entrée(s) ajoutée(s) à la file`, [...new Set(added.flatMap((i) => i.pages))], now()); // the merges wrote their own lines
  if (merged.length) { await regenerateCtx(openWiki(root)); await checkWritten(w, merged, say); }
  say(ok ? "ok" : "warn", `${merged.length} fusion(s), ${queued} paire(s) ${apply ? "en file" : "à mettre en file"}, ${different} paire(s) distincte(s)${apply ? "" : " ; --apply écrit (rien n'a été modifié)"}`);
  return { ok, items };
};

/** `cortex queue apply <n>` on a `merge` entry: the human has decided, so the judge is not asked again; the merge itself has the same checks. */
export async function applyMergeEntry(w: Wiki, item: QueueItem, say: Say): Promise<boolean> {
  const [a, b] = item.pages;
  if (item.pages.length !== 2) { say("fail", `l'entrée #${item.n} doit porter deux pages (${item.pages.length})`); return false; }
  if (!(await w.config()).model) { say("fail", "il faut un modèle : cortex config set model <nom>"); return false; }
  const r = await mergePair(w, a, b, new Date());
  if ("merged" in r) {
    await regenerateCtx(openWiki(w.root));
    await checkWritten(w, [r.merged], say);
    say("ok", `#${item.n} appliquée : ${r.merged.absorbed} absorbée dans ${r.merged.target}`);
    return true;
  }
  say("fail", `#${item.n} : ${"review" in r ? r.review : r.failed}; l'entrée reste ouverte`);
  return false;
}
