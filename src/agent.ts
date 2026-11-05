import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";
import { existsSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { rawId, toResource, type RawSource } from "./doc";
import { openWiki, type Wiki } from "./context";
import { regenerateCtx } from "./catalog";
import { backendFor, type Mode } from "./backends/index";
import type { Check } from "./backends/backend";
import { confine } from "./backends/sandbox";
import { agentFile } from "./config";
import { collector, type Report, type Result } from "./print";
import { paint } from "./style";
import { LIMITS } from "./limits";
import { frontmatterError, identityChange, isReservedPage, localIso, parseDoc, setFmLine, sha256, stemClash } from "./lib";
import { newPageCtx } from "./naming";
import { appendLogCtx } from "./log";
import { split } from "./backends/backend";
import { collator } from "./text";
import { tagKey } from "./lint";
import { askPrompt, compilePrompt, scopePrefix } from "./prompts";

async function git(root: string, ...args: string[]) {
  const p = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  return (await p.exited) === 0 ? out : undefined;
}

const unversioned = new Set<string>();

/** Modified/created files (porcelain v1, NUL-separated: no quoting of non-ASCII paths): serves as a scope guard, whatever the agent. */
export async function changed(root: string, report?: Report): Promise<Map<string, string>> {
  // `-- .` limits the status to the wiki root; porcelain paths stay relative to the repository top, hence the prefix to strip
  const out = await git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ".");
  const m = new Map<string, string>();
  if (out === undefined) {
    if (!unversioned.has(root)) { unversioned.add(root); report?.({ level: "warn", text: "no git repository: the agent's scope is not checked" }); }
    return m;
  }
  const prefix = ((await git(root, "rev-parse", "--show-prefix")) ?? "").trim(); // "" when root is the repository top, else "sub/dir/"
  const fields = out.split("\0");
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f) continue;
    const paths = [f.slice(3)];
    // rename/copy: the origin path follows as the next NUL field
    if (f[0] === "R" || f[0] === "C" || f[1] === "R" || f[1] === "C") paths.push(fields[++i]);
    for (const top of paths) {
      if (!top.startsWith(prefix)) continue; // outside the wiki root (a rename origin): not ours to report
      const path = top.slice(prefix.length);
      const file = Bun.file(join(root, path));
      m.set(path, (await file.exists()) ? new Bun.CryptoHasher("sha1").update(await file.arrayBuffer()).digest("hex") : "deleted");
    }
  }
  return m;
}

/** A root holding the home directory would make the sandbox read-only on the agent's own state (~/.claude…). */
function homeInside(root: string): boolean {
  const r = realpathSync(root), h = realpathSync(homedir());
  return r === h || h.startsWith(r.endsWith(sep) ? r : r + sep);
}

/** What the agent touched outside wiki/ (the status of a compiled raw source is the only exception, handled by the CLI). */
export async function outOfScope(root: string, before: Map<string, string>, report?: Report): Promise<string[]> {
  const after = await changed(root, report);
  return [...after].filter(([p, h]) => before.get(p) !== h && !p.startsWith("wiki/")).map(([p]) => p);
}

/** Bridge abstraction: the backend (agnostic, Claude, Codex, opencode) is chosen by cortex.json. */
async function run(w: Wiki, prompt: string, batch: boolean, mode: Mode, report: Report, check?: Check): Promise<number> {
  const root = w.root;
  if (homeInside(root)) { report({ level: "fail", text: "the wiki root contains your home directory: the agent could no longer write its state (~/.claude…). Use a dedicated folder." }); return 1; }
  const backend = await backendFor(root, await w.config());
  process.env.CORTEX_IN_AGENT = "1"; // inherited by every agent process: cortex new --force stays a human-only option
  prompt = scopePrefix(root, mode === "write", (await w.config()).language) + prompt;
  // interactive session confined as well: a too-quick human approval cannot write outside wiki/
  if (!batch) {
    // Ctrl+C targets the agent; without this handler, cortex would die too (same process group) before checking the Source page and flipping the status
    const keep = () => {};
    process.on("SIGINT", keep);
    try { return await Bun.spawn(confine(root, backend.interactive(prompt), mode), { cwd: root, stdio: ["inherit", "inherit", "inherit"] }).exited; }
    catch (e) { report({ level: "fail", text: (e as Error).message }); return 1; }
    finally { process.off("SIGINT", keep); }
  }
  try { report({ level: "info", text: await backend.run(root, prompt, mode, report, check) }); return 0; }
  catch (e) { report({ level: "fail", text: (e as Error).message }); return 1; }
}

/** Hash of every file under wiki/ (pages, log.jsonl…): what the agent changed, with or without git. */
async function pageHashes(root: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const p of new Bun.Glob("wiki/**/*").scanSync({ cwd: root })) m.set(p, sha256(await Bun.file(join(root, p)).bytes()));
  return m;
}

/**
 * Write run checked by cortex, whatever the backend: lint errors of the wiki files it changed, plus `extra` (compile: a
 * Source page cites the raw source). The check goes to the backend (openai fixes in the same conversation); what is
 * still wrong afterwards gets a new agent run listing it, at most `LIMITS.lintFixPasses` times (batch only).
 */
async function runChecked(w: Wiki, prompt: string, batch: boolean, report: Report, extra?: Check): Promise<{ code: number; errors: () => Promise<string[]> }> {
  const root = w.root;
  const before = await pageHashes(root);
  const texts = new Map<string, string>();
  for (const p of before.keys()) if (p.endsWith(".md")) texts.set(p, await Bun.file(join(root, p)).text());
  /**
   * Errors of the files under wiki/ the agent changed: a page it replaced by another one (type, title or sources) comes
   * back as it was, a new page under the file name of an existing one goes, both reported; then lint errors.
   */
  const errors = async () => {
    const out: string[] = [];
    for (const [p, h] of await pageHashes(root)) {
      if (!p.endsWith(".md") || before.get(p) === h) continue;
      const prev = texts.get(p), file = join(root, p);
      const why = prev !== undefined ? identityChange(p, prev, await Bun.file(file).text()) : stemClash(p, texts.keys(), root);
      if (!why) continue;
      if (prev !== undefined) await Bun.write(file, prev); else await rm(file, { force: true });
      out.push(`${why} ${prev !== undefined ? "Restored as it was." : "Removed."}`);
    }
    const files = new Set([...await pageHashes(root)].filter(([p, h]) => before.get(p) !== h).map(([p]) => p));
    const { lint } = await import("./lint");
    return [...out, ...(files.size ? (await lint(root)).filter((i) => i.level === "error" && files.has(i.path.replace(/:\d+$/, ""))).map((i) => `${i.path}: ${i.msg}`) : [])];
  };
  const check: Check = async () => [...await errors(), ...(await extra?.() ?? [])];
  let code = await run(w, prompt, batch, "write", report, check);
  for (let pass = 1; batch && pass <= LIMITS.lintFixPasses; pass++) {
    const misses = await check();
    if (!misses.length) break;
    report({ level: "info", text: `${misses.length} error(s) left: agent run again to fix them (pass ${pass}/${LIMITS.lintFixPasses})`, mark: "  ↻" });
    code = await run(w, fixPrompt(agentFile((await w.config()).client), misses), batch, "write", report, check);
  }
  return { code, errors };
}

const fixPrompt = (file: string, misses: string[]) =>
  `The previous run left the wiki incomplete. Read the pages concerned and fix only these points, following ${file}:\n${misses.map((m) => `- ${m}`).join("\n")}`;

/** Flips pending → compiled by line replacement inside the frontmatter only: never a YAML re-serialization (raw is immutable, comments included). Atomic (tmp + rename); throws when no status line matched. */
export async function markCompiled(root: string, path: string) {
  const file = join(root, path);
  const txt = await readFile(file, "utf8");
  const fmEnd = txt.match(/^\uFEFF?---\r?\n(?:[\s\S]*?\r?\n)?---/)?.[0].length ?? 0;
  const head = txt.slice(0, fmEnd).replace(/^(status:[ \t]*)["']?pending["']?([ \t]*\r?)$/m, "$1compiled$2");
  if (head === txt.slice(0, fmEnd)) throw new Error(`pending status not found in ${path}`);
  await writeFile(`${file}.tmp`, head + txt.slice(fmEnd));
  await rename(`${file}.tmp`, file);
}

/** Resolves a raw source by id (folder name): exact match wins, else a unique prefix; ambiguous or unknown → error. */
export function resolveRawId<T extends { path: string }>(docs: T[], id: string): T {
  const idOf = (d: T) => rawId(d.path);
  const exact = docs.find((d) => idOf(d) === id);
  if (exact) return exact;
  const hits = docs.filter((d) => id !== "" && idOf(d).startsWith(id));
  if (hits.length > 1) throw new Error(`ambiguous id: ${hits.map(idOf).join(", ")}`);
  if (!hits.length) throw new Error(`Source not found: ${id}`);
  return hits[0]!;
}

/** `generated.by` of the pages an agent touched: client/model:effort, from cortex.json (agnostic: the batch command). */
export function actor(cfg: { client?: string; model?: string; effort?: string }): string {
  const client = cfg.client ?? basename(split(process.env.CORTEX_AGENT_BATCH ?? "claude")[0] ?? "agent");
  return `${client}/${cfg.model ?? "default"}${cfg.effort ? `:${cfg.effort}` : ""}`;
}

/**
 * Batch compile: the Source page is written by cortex from what it already knows (path, type, title, status, sources,
 * generated, note and partial-extraction callouts); the agent only adds what needs reading the source. Undefined when a
 * page with that title exists already (the agent then writes the Source page as before).
 */
async function prepareSource(w: Wiki, d: RawSource, by: string, at: Date): Promise<{ path: string; text: string } | undefined> {
  const id = rawId(d.path), title = String(d.fm.title ?? id).trim() || id;
  const note = String(d.fm.note).trim().split(/\r?\n/).map((l) => `> ${l}`).join("\n");
  const partial = d.fm.partial ? `\n\n> [!warning]\n> ${d.fm.partial === true ? "Partial extraction." : String(d.fm.partial)}` : "";
  try {
    const path = await newPageCtx(w, "Source", title, at, {
      fm: { generated: { by, at: localIso(at) }, sources: [{ id, resource: toResource(d.path), title }] },
      body: `> [!note] Note personnelle\n${note}${partial}\n`,
    });
    return { path, text: await Bun.file(join(w.root, path)).text() };
  } catch { return undefined; }
}

/**
 * On each page of `paths`, body untouched: sets `generated` (actor and time), and brings each tag back to the tag
 * already in use with the same key (`agents` → `agent`): a near-synonym never enters the wiki through an agent. A page
 * of `fresh` (created by the agent) keeps at most `maxTags` tags (cortex.json max_tags, default LIMITS.maxTags).
 * Only those two lines are rewritten (`setFmLine`): comments, order and style of the rest of the frontmatter stay.
 */
async function stamp(root: string, paths: string[], by: string, at: Date, inUse: Map<string, string>, fresh: Set<string>, maxTags: number) {
  for (const p of paths) {
    const f = Bun.file(join(root, p));
    if (!(await f.exists())) continue;
    let text = await f.text();
    let fm;
    try { fm = parseDoc(p, text).fm; } catch { continue; } // unreadable frontmatter: lint reports it, the page stays as written
    if (!/^﻿?---\r?\n/.test(text)) continue; // no frontmatter: nothing to stamp (lint reports the missing type)
    let tags = Array.isArray(fm.tags) ? [...new Set(fm.tags.map((t) => inUse.get(tagKey(String(t))) ?? String(t)))] : undefined;
    // a page the agent created gets at most maxTags tags, those already in use first (stable sort)
    if (tags && fresh.has(p) && tags.length > maxTags) tags = tags.map((t, i) => ({ t, k: (inUse.has(tagKey(t)) ? 0 : 1) * 1e6 + i })).sort((x, y) => x.k - y.k).slice(0, maxTags).map((x) => x.t);
    if (tags && JSON.stringify(tags) !== JSON.stringify(fm.tags)) text = setFmLine(text, "tags", `tags: ${JSON.stringify(tags)}`);
    text = setFmLine(text, "generated", `generated: { by: ${JSON.stringify(by)}, at: ${localIso(at)} }`);
    if (!frontmatterError(text)) await Bun.write(f, text); // a replacement that would break the YAML is dropped
  }
}

/**
 * Batch, after the agent: what a small model leaves undone, done by cortex. The Source page `src` links to every page
 * of `paths` citing the source, each of them links back to `src`, and the human note callout only stays on `src`.
 * A link already there (any text) is kept as is.
 */
async function weave(root: string, src: string, resource: string, paths: string[], note: string) {
  const read = async (p: string) => { try { const text = await Bun.file(join(root, p)).text(); return { text, doc: parseDoc(p, text) }; } catch { return undefined; } };
  const me = await read(src);
  if (!me) return;
  const link = (p: string, title: unknown) => `- [${String(title ?? p).replace(/[[\]]/g, "")}](/${p})`;
  const first = note.trim().split(/\r?\n/)[0]?.trim();
  const add: string[] = [];
  for (const p of paths) {
    if (p === src) continue;
    const page = await read(p);
    if (!page) continue;
    let body = page.doc.body;
    // the note copied onto another page, intact or broken (« !note », a lone « > »): the paragraph holding it goes
    if (first) body = body.split(/\n{2,}/).filter((b) => !b.includes(first)).join("\n\n").replace(/^\s+/, "");
    const cites = (page.doc.fm.sources ?? [] as unknown[]) as { resource?: string }[];
    if (Array.isArray(cites) && cites.some((c) => c?.resource === resource)) {
      if (!me.doc.body.includes(`(/${p})`)) add.push(link(p, page.doc.fm.title));
      if (!body.includes(`(/${src})`)) body = `${body.replace(/\s*$/, "")}\n\n${link(src, me.doc.fm.title)}\n`;
    }
    if (body !== page.doc.body) await Bun.write(join(root, p), page.text.slice(0, page.text.length - page.doc.body.length) + body);
  }
  if (add.length) await Bun.write(join(root, src), `${me.text.replace(/\s*$/, "")}\n${/\n- [^\n]*$/.test(me.text.trimEnd()) ? "" : "\n"}${add.join("\n")}\n`);
}

/** Does a Source page cite the raw source at `path`? */
const isCited = async (w: Wiki, path: string) => (await w.citations()).has(toResource(path));

type CompileOpts = { pending?: boolean; batch?: boolean };
/** Compiles raw sources one agent session at a time. Progress goes to `report` live; `ok` is false on any failure. */
export async function compileCtx(w: Wiki, ids: string[], opts: CompileOpts, report?: Report): Promise<Result> {
  const { say, done } = collector(report);
  const root = w.root;
  const raw = await w.raws();
  const targets = opts.pending
    ? raw.filter((d) => d.fm.status === "pending")
    : ids.map((id) => resolveRawId(raw, id));
  if (!targets.length) { say("info", "Nothing to compile."); return done(true); }

  let ok = true;
  const sink: Report = (m) => say(m.level, m.text, m.mark);
  for (const d of targets) {
    const id = rawId(d.path);
    if (!String(d.fm.note ?? "").trim()) { say("fail", `${id}: empty note. Fill in the intent (note field) before compiling.`); ok = false; continue; }
    if (d.fm.status !== "pending") say("info", paint.dim(`(${id} is already ${d.fm.status}: recompiling)`));
    const cfg = await w.config();
    const by = actor(cfg), started = new Date();
    const pagesBefore = await pageHashes(root);
    // batch: cortex writes the mechanical part of the Source page; interactive: the agent presents its plan first
    const prepared = opts.batch && !(await isCited(openWiki(root), d.path)) ? await prepareSource(openWiki(root), d, by, started) : undefined;
    const tags = [...new Set((await openWiki(root).pages()).flatMap((p) => p.fm.tags ?? []))].sort(collator.compare);
    const inUse = new Map(tags.map((t) => [tagKey(t), t] as const));
    const prompt = compilePrompt({ agentFile: agentFile(cfg.client), source: toResource(d.path), id, batch: opts.batch, language: cfg.language, page: prepared?.path, tags, maxTags: cfg.max_tags ?? LIMITS.maxTags });
    say("info", `${paint.accent("→")} compile ${paint.bold(id)}${opts.batch ? paint.dim(" (batch)") : ""}`);
    const before = await changed(root, sink);
    // the same test as below, run by cortex after the agent (and by openai inside its conversation)
    /** The prepared page must carry its summary in the body: a model may put it in the frontmatter instead, which lint accepts (OKF is extensible). */
    const bodyless = async () => {
      const text = prepared && await Bun.file(join(root, prepared.path)).text().catch(() => undefined);
      if (!text) return [];
      const callout = parseDoc(prepared.path, prepared.text).body.trim();
      if (!text.includes(callout)) return [`${prepared.path}: the note callout written by the CLI was changed. Put it back exactly, as the first lines of the body:\n${callout}`];
      const prose = (() => { try { return parseDoc(prepared.path, text).body.split("\n").filter((l) => l.trim() && !l.startsWith(">")); } catch { return []; } })();
      return prose.length ? [] : [`${prepared.path}: the body holds only the note callout. Write the summary, the key points and the links as Markdown in the body, after the callout, never as frontmatter keys.`];
    };
    const cited: Check = async () => {
      const now = openWiki(root), res = toResource(d.path);
      if (prepared && await Bun.file(join(root, prepared.path)).text().catch(() => "") === prepared.text)
        return [`${prepared.path}: the Source page is still as the CLI created it. Add its description, tags, summary, key points and links.`];
      const empty = await bodyless();
      if (empty.length) return empty;
      if (await isCited(now, d.path)) return [];
      // what the agent wrote instead: a Source page with another resource, a page of another type…
      const near = (await now.pages()).filter((p) => p.path.includes(id) || JSON.stringify(p.fm.sources ?? "").includes(id))
        .map((p) => `${p.path} has type ${JSON.stringify(p.fm.type)} and sources ${JSON.stringify(p.fm.sources ?? [])}`);
      return [`no Source page cites ${res}. The Source page needs \`type: Source\` and exactly this in its frontmatter: ` +
        `sources: [{ id: ${id}, resource: ${res} }]${near.length ? `. Now: ${near.join("; ")}` : ""}`];
    };
    const { code, errors } = await runChecked(w, prompt, !!opts.batch, sink, cited);
    // a prepared page the agent never filled in goes: nothing half-done stays in the wiki
    if (prepared && await Bun.file(join(root, prepared.path)).text().catch(() => "") === prepared.text) await rm(join(root, prepared.path), { force: true });
    const pagesAfter = await pageHashes(root);
    const touched = [...pagesAfter].filter(([p, h]) => pagesBefore.get(p) !== h && p.endsWith(".md") && !isReservedPage(p)).map(([p]) => p);
    if (opts.batch) {
      await stamp(root, touched, by, new Date(), inUse, new Set(touched.filter((p) => !pagesBefore.has(p))), cfg.max_tags ?? LIMITS.maxTags);
      if (prepared && existsSync(join(root, prepared.path))) await weave(root, prepared.path, toResource(d.path), touched, String(d.fm.note ?? ""));
    }
    const stray = await outOfScope(root, before, sink);
    if (stray.length) { say("warn", `the agent modified files outside wiki/: ${stray.join(", ")}`, "⚠"); ok = false; }
    const left = [...await errors(), ...await bodyless()];
    if (left.length) { // the Source page may cite the source, but the wiki is not left broken under a `compiled` status
      say("fail", `${id}: errors left in the files the agent changed, status unchanged:\n${left.map((e) => `  - ${e}`).join("\n")}`);
      ok = false;
    } else if (await isCited(openWiki(root), d.path)) { // fresh context: the agent just wrote pages
      if (d.fm.status === "pending") {
        try { await markCompiled(root, d.path); }
        catch (e) { say("fail", `${id}: ${(e as Error).message}`); ok = false; continue; }
      }
      // the Ingest entry, unless the agent wrote one for this source itself
      if (opts.batch && !openWiki(root).journal().entries.some((e) => e.kind === "ingest" && e.sources?.includes(id) && e.at >= localIso(started))) {
        const created = touched.filter((p) => !pagesBefore.has(p)).length;
        await appendLogCtx(openWiki(root), { kind: "ingest", text: `compiled: ${created} page(s) created, ${touched.length - created} updated.`, sources: [id], pages: touched });
      }
      say("ok", `${id} compiled`);
    } else { say("fail", `${id}: no Source page cites the source (agent exited with ${code}); status unchanged.`); ok = false; }
  }
  await regenerateCtx(openWiki(root));
  return done(ok);
}
export const compile = (root: string, ids: string[], opts: CompileOpts, report?: Report) => compileCtx(openWiki(root), ids, opts, report);

type AskOpts = { file?: boolean; interactive?: boolean };
export async function askCtx(w: Wiki, question: string, opts: AskOpts, report?: Report): Promise<Result> {
  const { say, done } = collector(report);
  const sink: Report = (m) => say(m.level, m.text, m.mark);
  const root = w.root;
  const cfg = await w.config();
  const prompt = askPrompt({ agentFile: agentFile(cfg.client), question, file: opts.file, language: cfg.language });
  const before = await changed(root, sink);
  const checked = opts.file ? await runChecked(w, prompt, !opts.interactive, sink) : undefined;
  const code = checked ? checked.code : await run(w, prompt, !opts.interactive, "read", sink);
  const left = checked ? await checked.errors() : [];
  if (left.length) say("warn", `errors left in the files the agent changed:\n${left.map((e) => `  - ${e}`).join("\n")}`, "⚠");
  const after = await changed(root, sink);
  const touched = [...after].filter(([p, h]) => before.get(p) !== h).map(([p]) => p);
  const stray = touched.filter((p) => opts.file ? !p.startsWith("wiki/") : true);
  let ok = !code;
  if (stray.length) { say("warn", `files modified outside the allowed scope: ${stray.join(", ")}`, "⚠"); ok = false; }
  if (opts.file) {
    await regenerateCtx(openWiki(root)); // fresh context: the agent just wrote pages
  }
  return done(ok);
}
export const ask = (root: string, question: string, opts: AskOpts, report?: Report) => askCtx(openWiki(root), question, opts, report);
