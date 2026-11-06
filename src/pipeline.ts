import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { changed, markCompiled, outOfScope, prepareSource, sourceCallouts, stamp, tagUsage, weave, actor } from "./agent";
import { addNoteDefs, noteDef, noteId, normalizeNotes } from "./cite";
import { repairPage, updatePage, writePage, linkPages, type Addition, type PageRef, type Written } from "./compose";
import type { Config } from "./config";
import { openWiki, type Wiki } from "./context";
import { type ConnectUpdate, connectSource, linkLine, type Connected } from "./connect";
import { rawId, toResource, type RawSource } from "./doc";
import { type ChunkExtraction, type Extracted, extractSource, type SavedChunks, pool, type Fact, type Head, type Subject } from "./extraction";
import { frontmatterError, parseDoc, setFmLine, sha256, slugify } from "./lib";
import { LIMITS } from "./limits";
import { lint } from "./lint";
import { appendLogCtx } from "./log";
import { mergeUpdate, sourceId } from "./merge";
import { newPageCtx } from "./naming";
import type { Message, Report } from "./print";
import { enqueueCtx, queueItems } from "./queue";
import { type Candidates, routeCandidates, routeSubjects, type Routed } from "./route";
import { DEFAULT_LANGUAGE } from "./schema";
import { collator } from "./text";

// --- The pipeline compile mode (docs/PIPELINE.md): cortex runs the fixed steps of one source, the model only infers.
// Steps 0-6 call the model and write nothing: their results go to `.cortex/pipeline/<raw id>.json` as they come (§4.6), so
// a crash leaves the wiki intact and a rerun skips what is done. Step 7 (application) is cortex alone and can be replayed.

type Done<T> = T & { /** Note id the model was given. */ id: string };
/** What the steps gave so far. Written/updated entries are keyed by the subject (`new:<slug>`) and the page path. */
type State = {
  version: 1; model: string; source_sha256: string;
  steps: {
    candidates?: Candidates; /** Raw answers of the chunks, saved one by one while the extraction runs. */ chunks?: SavedChunks; extract?: Extracted; route?: { routes: Routed<Subject>[] }; connect?: Connected;
    write: Record<string, Done<Written>>; update: Record<string, Done<Addition>>;
  };
  /** What step 7 did: page path by subject key (`source` for the Source page), and the pages it created. */
  applied: { paths: Record<string, string>; created: string[] };
};

const stateFile = (root: string, id: string) => join(root, ".cortex/pipeline", `${id}.json`);
const emptyState = (model: string, sha: string): State => ({ version: 1, model, source_sha256: sha, steps: { write: {}, update: {} }, applied: { paths: {}, created: [] } });

/** The saved state when it belongs to the same source text and model, else a new one. */
function loadState(root: string, id: string, model: string, sha: string, fresh?: boolean): State {
  if (!fresh) {
    try {
      const s = JSON.parse(readFileSync(stateFile(root, id), "utf8")) as State;
      if (s.version === 1 && s.model === model && s.source_sha256 === sha) return s;
    } catch { /* none, or unreadable: start again */ }
  }
  return emptyState(model, sha);
}

function saveState(root: string, id: string, s: State) {
  const f = stateFile(root, id);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(`${f}.tmp`, JSON.stringify(s));
  renameSync(`${f}.tmp`, f);
}

export type PipelineOpts = { /** Ignore the saved state. */ fresh?: boolean; /** Keep the state after a success (the lab reads it). */ keepState?: boolean; /** The clock (tests). */ now?: () => Date };
export type PipelineStats = {
  chunks: number; /** Indexes of the chunks whose extraction failed. */ failedChunks: number[];
  /** Facts whose quote is not in the source. */ rejected: number; /** Subjects without a verified fact (not written). */ skipped: string[]; /** Subjects cut by `pipelineMaxSubjects`. */ dropped: string[];
  created: string[]; updated: string[]; /** Updates that added nothing new (not written). */ redundant: number;
  /** Model steps or applications that failed (the page is not written or not completed). */ failedSteps: string[]; contradictions: string[]; links: number;
};
export type PipelineResult = { ok: boolean; stats: PipelineStats };

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const read = (root: string, p: string) => readFileSync(join(root, p), "utf8");
const newKey = (s: { title: string }) => `new:${slugify(s.title, Infinity)}`;
const byTitle = (a: { title: string; path: string }, b: { title: string; path: string }) => collator.compare(a.title, b.title) || a.path.localeCompare(b.path);

/** Body of the Source page (§4.1): the callouts, summary and key points cited to the raw source, the linked pages, the definition of the note. */
function renderSource(o: { callouts: string; head: Head; links: string[]; id: string; title: string; resource: string; partial?: string }): string {
  const note = `[^${o.id}]`, fix = (s: string) => normalizeNotes(s, o.id).body;
  return `${[
    o.callouts, o.partial,
    `## Résumé\n${fix(o.head.summary.trim())}${note}`,
    `## Points clés\n${o.head.key_points.map((k) => `- ${fix(one(k))}${note}`).join("\n")}`,
    o.links.length && `## Pages liées\n${o.links.join("\n")}`,
    noteDef(o.id, o.title, o.resource),
  ].filter(Boolean).join("\n\n")}\n`;
}

/** The text of a page with another body, frontmatter untouched. */
const withBody = (text: string, body: string) => text.slice(0, text.length - parseDoc("", text).body.length) + body;

// --- Step 8: lint and repair (§4.5)

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Lint errors of the pages of `paths`, plus the body that is empty (nothing to lint, nothing to read). */
async function pageErrors(root: string, paths: string[]): Promise<{ path: string; msg: string }[]> {
  const files = new Set(paths);
  const out = (await lint(root)).filter((i) => i.level === "error" && files.has(i.path.replace(/:\d+$/, ""))).map((i) => ({ path: i.path.replace(/:\d+$/, ""), msg: i.msg }));
  for (const p of paths) {
    try { if (!parseDoc(p, read(root, p)).body.replace(/^\[\^[\w-]+\]:.*$/gm, "").trim()) out.push({ path: p, msg: "empty body" }); } catch { /* unreadable: lint says so */ }
  }
  return out;
}

/** What needs no model: a note without `sources[]` entry becomes the page's only one (else goes), a broken link keeps its text, a missing description is the extraction's. */
function mechanical(path: string, text: string, msgs: string[], description?: string): string {
  let doc;
  try { doc = parseDoc(path, text); } catch { return text; }
  const ids = (Array.isArray(doc.fm.sources) ? doc.fm.sources : []).map((s) => String((s as { id?: unknown })?.id ?? "")).filter(Boolean);
  let body = doc.body, out = text;
  for (const m of msgs) {
    const note = /^footnote \[\^([\w-]+)\] has no sources\[\] entry$/.exec(m)?.[1];
    if (note) body = body.replace(new RegExp(`^\\[\\^${escapeRe(note)}\\]:.*\\n?`, "gm"), "").replace(new RegExp(`\\[\\^${escapeRe(note)}\\](?!:)`, "g"), ids.length === 1 ? `[^${ids[0]}]` : "");
    const link = /^broken link: \/(.+)$/.exec(m)?.[1];
    if (link) body = body.replace(new RegExp(`\\[([^\\]]*)\\]\\(\\/${escapeRe(link.replace(/#.*$/, ""))}(?:#[^)\\s]*)?\\)`, "g"), "$1");
    if (m === "missing description" && description) out = setFmLine(out, "description", `description: ${JSON.stringify(one(description))}`);
  }
  out = withBody(out, body);
  return frontmatterError(out) ? text : out;
}

/**
 * Lint of the pages cortex wrote, then what is wrong is fixed: the mechanical corrections first, then `repair` (the
 * model returns a corrected body: one page at a time, one try) for the errors that concern the body. Returns the errors left.
 */
export async function settlePages(root: string, paths: string[], o: { cfg: Config; language: string; description?: string; source?: string; report?: Report }): Promise<string[]> {
  let errors = await pageErrors(root, paths);
  if (!errors.length) return [];
  const group = (list: typeof errors) => Map.groupBy(list, (e) => e.path);
  for (const [p, list] of group(errors)) {
    const text = read(root, p), fixed = mechanical(p, text, list.map((e) => e.msg), o.description);
    if (fixed !== text) writeFileSync(join(root, p), fixed);
  }
  errors = await pageErrors(root, paths);
  for (const [p, list] of group(errors)) {
    if (!list.some((e) => /^(footnote|broken link|relative link|empty body)/.test(e.msg))) continue; // the frontmatter is not the model's to fix
    try {
      const text = read(root, p), body = await repairPage(o.cfg, { body: parseDoc(p, text).body, errors: list.map((e) => e.msg), language: o.language, source: o.source, report: o.report });
      const next = withBody(text, `${body}\n`);
      if (!frontmatterError(next)) writeFileSync(join(root, p), next);
    } catch (e) { o.report?.({ level: "warn", text: `réparation de ${p} sans résultat (${(e as Error).message})`, mark: "  ⚠" }); }
  }
  return (await pageErrors(root, paths)).map((e) => `${e.path}: ${e.msg}`);
}

// --- The compile of one source

/** Compiles one raw source with the fixed steps of the pipeline. Never throws: a source that fails says why and leaves the wiki as it was (state kept for the rerun). */
export async function compilePipeline(w0: Wiki, d: RawSource, opts: PipelineOpts, report: Report): Promise<PipelineResult> {
  const id = rawId(d.path);
  const stats: PipelineStats = { chunks: 0, failedChunks: [], rejected: 0, skipped: [], dropped: [], created: [], updated: [], redundant: 0, failedSteps: [], contradictions: [], links: 0 };
  const say = (level: Message["level"], text: string, mark?: string) => report({ level, text, ...(mark && { mark }) });
  try { return { ok: await run(w0, d, opts, report, stats, say), stats }; } catch (e) {
    say("fail", `${id}: ${(e as Error).message}; state kept: run the same command to resume.`);
    return { ok: false, stats };
  }
}

async function run(w0: Wiki, d: RawSource, opts: PipelineOpts, report: Report, stats: PipelineStats, say: (l: Message["level"], t: string, m?: string) => void): Promise<boolean> {
  const root = w0.root, cfg = await w0.config(), id = rawId(d.path), resource = toResource(d.path);
  const title = String(d.fm.title ?? id).trim() || id, now = opts.now ?? (() => new Date()), language = cfg.language ?? DEFAULT_LANGUAGE;
  const source = d.body, by = actor({ ...cfg, effort: "pipeline" });
  const fail = (text: string) => (say("fail", `${id}: ${text}`), false);
  if (!cfg.model) return fail("the pipeline needs a model: cortex config set model <name>");
  if (!source.trim()) return fail("the source is empty, nothing to extract");

  const st = loadState(root, id, cfg.model, sha256(`${title}\n${source}`), opts.fresh);
  const save = () => saveState(root, id, st);
  const resumed = Object.keys(st.steps).filter((k) => k !== "write" && k !== "update" && (st.steps as Record<string, unknown>)[k]).map((k) => (k === "chunks" ? `chunks (${Object.keys(st.steps.chunks!.parts).length}/${st.steps.chunks!.of})` : k));
  if (resumed.length) say("info", `reprise : ${resumed.join(", ")} déjà faits (--fresh pour tout refaire)`);
  const before = await changed(root, report);
  const { inUse, top } = tagUsage(await openWiki(root).pages());

  // 0-1. candidates (routing, §4.7), then the extraction, which merges and verifies the subjects (steps 2-3)
  if (!st.steps.candidates) {
    try { st.steps.candidates = await routeCandidates(openWiki(root), { title, body: source }); } catch (e) {
      say("warn", `candidats : sans résultat (${(e as Error).message}), extraction sans pages proches`, "  ⚠");
      st.steps.candidates = { extract: [], pool: [] };
    }
    save();
  }
  const cands = st.steps.candidates;
  if (!st.steps.extract) {
    // a chunk answered is saved at once: a crash on the last one of a long source does not redo the others (a failed chunk is not saved: the rerun tries it again)
    const onChunk = (i: number, x: ChunkExtraction, of: number) => { st.steps.chunks = { of, parts: { ...(st.steps.chunks?.of === of ? st.steps.chunks.parts : {}), [i]: x } }; save(); };
    try { st.steps.extract = await extractSource(cfg, { source, title, tags: top, candidates: cands.extract, language, id, report, saved: st.steps.chunks, onChunk }); } catch (e) { return fail(`${(e as Error).message}; wiki unchanged`); }
    save();
  }
  const ex = st.steps.extract, head = ex.extraction;
  Object.assign(stats, { chunks: ex.chunks, failedChunks: ex.failed, rejected: ex.rejected, dropped: ex.dropped });

  // 4. one decision per subject: the page it updates, or a new page
  if (!st.steps.route) { st.steps.route = { routes: (await routeSubjects(openWiki(root), head.subjects, cands.extract)).routes }; save(); }
  const routes = st.steps.route.routes;
  stats.skipped = [...ex.skipped, ...head.subjects.filter((s) => !s.facts.length).map((s) => s.title)];
  say("info", `extraction : ${ex.chunks} morceau(x), ${stats.rejected} fait(s) sans citation rejeté(s), ${stats.skipped.length} sujet(s) ignoré(s), ${stats.failedChunks.length} morceau(x) sans résultat`);

  // 4bis. connections: pages the source touches without being about them
  if (!st.steps.connect) {
    st.steps.connect = await connectSource(cfg, { summary: head.summary, keyPoints: head.key_points, subjects: routes.map((r) => r.subject), pool: cands.pool, targeted: routes.flatMap((r) => (r.target ? [r.target] : [])), language, id, report });
    save();
  }
  const conn = st.steps.connect;
  stats.links = conn.links.length;

  // 5-6. the model's writing steps, in parallel; each result is saved as it comes
  const titles = new Map((await openWiki(root).pages()).map((p) => [p.path, String(p.fm.title ?? p.path)]));
  const news = routes.filter((r) => !r.target);
  type Edit = { path: string; title: string; facts: Fact[]; contradicts: boolean };
  const edits: Edit[] = [
    ...routes.filter((r) => r.target).map((r): Edit => ({ path: r.target!, title: titles.get(r.target!) ?? r.subject.title, facts: r.subject.facts, contradicts: false })),
    ...conn.updates.map((u: ConnectUpdate): Edit => ({ path: u.path, title: u.title, facts: u.facts, contradicts: u.contradiction })),
  ];
  /** Pages a new page may mention as `[[p:N]]`: the Source page, the other subjects, the connected pages, the candidates; a page not created yet has a `key`, its path comes later. */
  const refsFor = (self: string): (PageRef & { key?: string })[] => {
    const all: (PageRef & { key?: string })[] = [{ title, key: "source" }];
    for (const r of routes) if (r.target || newKey(r.subject) !== self) all.push(r.target ? { title: titles.get(r.target) ?? r.subject.title, path: r.target } : { title: r.subject.title, key: newKey(r.subject) });
    for (const p of [...conn.updates, ...conn.links, ...cands.extract]) all.push({ title: p.title, path: p.path });
    const seen = new Set<string>();
    return all.filter((r) => { const k = r.path ?? r.key!; return !seen.has(k) && seen.add(k); }).slice(0, LIMITS.pipelineLinkablePages);
  };
  const nid = noteId(title, []); // the note of a new page: the slug of the source's title
  const jobs: { label: string; run: () => Promise<void> }[] = [];
  for (const r of news) {
    const key = newKey(r.subject);
    if (!st.steps.write[key]) jobs.push({ label: `page « ${r.subject.title} »`, run: async () => {
      const wr = await writePage(cfg, { kind: r.subject.kind, title: r.subject.title, description: r.subject.description, facts: r.subject.facts, id: nid, pages: refsFor(key), language, source: id, report });
      st.steps.write[key] = { ...wr, id: nid }; save();
    } });
  }
  for (const e of edits) {
    if (!st.steps.update[e.path]) jobs.push({ label: `ajout à ${e.path}`, run: async () => {
      const text = read(root, e.path), uid = sourceId(e.path, text, { title, resource });
      const a = await updatePage(cfg, { title: e.title, body: parseDoc(e.path, text).body, facts: e.facts, id: uid, contradicts: e.contradicts, language, source: id, report });
      st.steps.update[e.path] = { ...a, id: uid }; save();
    } });
  }
  const errors: string[] = [];
  await pool(jobs, LIMITS.pipelineParallel, async (j) => { try { await j.run(); } catch (e) { errors.push(`${j.label} : ${(e as Error).message}`); } });
  errors.sort(collator.compare);
  if (errors.length && !Object.keys(st.steps.write).length && !Object.keys(st.steps.update).length) return fail(`aucune page n'a pu être rédigée, wiki intact, état gardé :\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  for (const e of errors) say("warn", `${e}`, "  ⚠");
  stats.failedSteps.push(...errors);

  // 7. application: only cortex writes, in the collator's order of the titles; each page created is noted in the state first
  const { paths } = st.applied, exists = (p?: string) => !!p && existsSync(join(root, p));
  let src = exists(paths.source) ? paths.source : (await openWiki(root).citations()).get(resource)?.[0]?.path;
  if (!src) {
    const skeleton = (await prepareSource(openWiki(root), d, by, now())) ?? (await prepareSource(openWiki(root), { ...d, fm: { ...d.fm, title: `${title} (source)` } }, by, now()));
    if (!skeleton) return fail("a page already has the title of the source and the Source page cannot be created; wiki unchanged");
    src = skeleton.path;
    st.applied.created.push(src);
  }
  paths.source = src; save();

  const link = (key: string) => (key === "source" ? src : paths[key]);
  const resolved = (self: string): PageRef[] => refsFor(self).map((r) => ({ title: r.title, path: r.path ?? (r.key ? link(r.key) : undefined) }));
  const updated = new Set<string>();
  for (const r of news) {
    const key = newKey(r.subject), wr = st.steps.write[key];
    if (!wr || exists(paths[key])) continue;
    const fm = { description: r.subject.description, tags: head.tags, sources: [{ id: wr.id, resource, title }] };
    try {
      paths[key] = await newPageCtx(openWiki(root), r.subject.kind, r.subject.title, now(), { fm, body: addNoteDefs(`${wr.body}\n`, [noteDef(wr.id, title, resource)]) });
      st.applied.created.push(paths[key]!); save();
    } catch (e) {
      // the title is taken (the routing missed it): the body goes to the page the error names, as a new section
      const named = /(wiki\/[^\s«»,]+\.md)/.exec((e as Error).message)?.[1];
      if (!named || !exists(named)) { stats.failedSteps.push(`page « ${r.subject.title} » : ${(e as Error).message}`); say("warn", `page « ${r.subject.title} » non créée (${(e as Error).message})`, "  ⚠"); continue; }
      const text = read(root, named), m = mergeUpdate(named, text, { section: r.subject.title, addition: linkPages(wr.body, resolved(key)), contradiction: null }, { id: sourceId(named, text, { title, resource }), title, resource });
      if (m) writeFileSync(join(root, named), m.text);
      paths[key] = named; save();
    }
  }
  for (const r of news) { const p = paths[newKey(r.subject)]; if (p && !st.applied.created.includes(p)) updated.add(p); } // added to a page named by a refusal
  // `[[p:N]]` → links, now that every path is known
  for (const r of news) {
    const key = newKey(r.subject), p = paths[key];
    if (!p || !st.applied.created.includes(p)) continue;
    const text = read(root, p);
    if (text.includes("[[p:")) writeFileSync(join(root, p), linkPages(text, resolved(key)));
  }
  for (const e of edits) {
    const a = st.steps.update[e.path];
    if (!a || !exists(e.path)) continue;
    try {
      const text = read(root, e.path), m = mergeUpdate(e.path, text, a, { id: a.id, title, resource });
      if (!m) { // nothing to add: a page that cites the source already (an earlier try wrote it) still counts as touched
        if ((parseDoc(e.path, text).fm.sources as { resource?: string }[] | undefined)?.some((s) => s?.resource === resource)) updated.add(e.path); else stats.redundant++;
        continue;
      }
      writeFileSync(join(root, e.path), a.noted ? m.text : setFmLine(m.text, "status", "status: draft")); // no note: the sentences cite nothing
      updated.add(e.path);
      if (m.contradiction) stats.contradictions.push(e.path);
    } catch (err) { stats.failedSteps.push(`${e.path} : ${(err as Error).message}`); say("warn", `${e.path} non complétée (${(err as Error).message})`, "  ⚠"); }
  }
  const made = st.applied.created.filter((p) => p !== src && exists(p));
  stats.created = [src, ...made].filter((p) => st.applied.created.includes(p));
  stats.updated = [...updated];

  // the Source page: callouts, summary and key points, then the pages it links (written, completed, connected)
  const names = new Map((await openWiki(root).pages()).map((p) => [p.path, String(p.fm.title ?? p.path)]));
  const linked = new Map<string, { path: string; title: string; why?: string }>();
  for (const p of [...made, ...updated]) linked.set(p, { path: p, title: names.get(p) ?? p });
  for (const l of conn.links) if (exists(l.path) && !linked.has(l.path)) linked.set(l.path, l);
  const partial = stats.failedChunks.length
    ? `> [!warning]\n> Extraction partielle : ${stats.failedChunks.length} morceau(x) sur ${ex.chunks} sans résultat (${stats.failedChunks.map((i) => i + 1).join(", ")}) ; leur contenu n'est pas dans cette page ni dans le wiki.` : undefined;
  let text = withBody(read(root, src), renderSource({ callouts: sourceCallouts(d), partial, head, links: [...linked.values()].sort(byTitle).map(linkLine), id, title, resource }));
  text = setFmLine(setFmLine(text, "description", `description: ${JSON.stringify(one(head.description))}`), "tags", `tags: ${JSON.stringify(head.tags)}`);
  if (!frontmatterError(text)) writeFileSync(join(root, src), text);

  const touched = [...new Set([src, ...made, ...updated])];
  await stamp(root, touched, by, now(), inUse, new Set(st.applied.created), cfg.max_tags ?? LIMITS.maxTags);
  await weave(root, src, resource, touched, String(d.fm.note ?? ""));
  // 7bis (bridges between groups of pages) is WP6b's: it hooks in here, before the lint

  // 8. lint and repair of the pages written
  const left = await settlePages(root, touched, { cfg, language, description: head.description, source: id, report });
  const stray = (await outOfScope(root, before, report)).filter((p) => !p.startsWith(".cortex/"));
  if (stray.length) { say("warn", `${id}: files modified outside wiki/: ${stray.join(", ")}`, "⚠"); return false; }
  if (left.length) { say("fail", `${id}: errors left in the pages written, status unchanged (state kept, fix them and run the same command):\n${left.map((e) => `  - ${e}`).join("\n")}`); return false; }
  if (!(await openWiki(root).citations()).has(resource)) return fail("no Source page cites the source after the write; status unchanged");

  // 9. close: compiled, targeted links, journal, the queue for what a human has to see, embeddings for the next source
  if (d.fm.status === "pending") {
    try { await markCompiled(root, d.path); } catch (e) { return fail((e as Error).message); }
  }
  const { lexical, suggestLinks, writeLinks } = await import("./links");
  const added = await writeLinks(root, suggestLinks(await openWiki(root).pages(), lexical, { pages: new Set(touched), targets: new Set(st.applied.created) }), now());
  if (added.length) say("info", `${added.length} link(s) added by cortex links`);
  const w = openWiki(root);
  if (stats.failedSteps.length) {
    const t = `Compile partiel : ${title}`;
    if (!queueItems(w.queue().entries).some((i) => i.status === "open" && i.title === t))
      await enqueueCtx(w, { kind: "review", title: t, reason: `${stats.failedSteps.length} étape(s) du pipeline sans résultat : ${stats.failedSteps.map(one).join(" ; ")}`, pages: touched, sources: [id] }, now());
  }
  const n = (k: number, s: string) => `${k} ${s}`;
  await appendLogCtx(w, { kind: "ingest", sources: [id], pages: touched, text: `compilé (pipeline) : ${n(stats.created.length, "page(s) créée(s)")}, ${n(touched.length - stats.created.length, "mise(s) à jour")}`
    + `${stats.contradictions.length ? `, contradiction sur ${stats.contradictions.join(", ")} (draft)` : ""}${stats.rejected ? `, ${n(stats.rejected, "fait(s) sans citation rejeté(s)")}` : ""}`
    + `${stats.failedChunks.length ? `, extraction partielle (${n(stats.failedChunks.length, "morceau(x) perdu(s)")})` : ""}.` }, now());
  const { refresh } = await import("./embed");
  await refresh(root);
  if (!opts.keepState) rmSync(stateFile(root, id), { force: true });
  if (stats.failedSteps.length) say("warn", `${stats.failedSteps.length} étape(s) sans résultat : entrée de revue dans la file (cortex queue)`, "  ⚠");
  say("ok", `${id} compiled (${stats.created.length} created, ${stats.updated.length} updated${stats.contradictions.length ? `, ${stats.contradictions.length} contradiction(s)` : ""})`);
  return true;
}
