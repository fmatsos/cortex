import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { readFile, rename, writeFile } from "node:fs/promises";
import { rawId, toResource } from "./doc";
import { openWiki, type Wiki } from "./context";
import { backendFor, type Mode } from "./backends/index";
import { confine } from "./backends/sandbox";
import { agentFile } from "./config";
import { collector, type Report, type Result } from "./print";
import { paint } from "./style";
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
    if (!unversioned.has(root)) { unversioned.add(root); report?.({ level: "warn", text: "pas de dépôt git : le périmètre de l'agent n'est pas vérifié" }); }
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

/** Bridge abstraction: the backend (agnostic, Claude, Codex, opencode) is chosen by config.json. */
async function run(w: Wiki, prompt: string, batch: boolean, mode: Mode, report: Report): Promise<number> {
  const root = w.root;
  if (homeInside(root)) { report({ level: "fail", text: "la racine du cerveau contient ton répertoire personnel : l'agent ne pourrait plus écrire son état (~/.claude…). Utilise un dossier dédié." }); return 1; }
  const backend = await backendFor(root, await w.config());
  prompt = scopePrefix(root, mode === "write", (await w.config()).language) + prompt;
  // interactive session confined as well: a too-quick human approval cannot write outside wiki/
  if (!batch) {
    // Ctrl+C targets the agent; without this handler, cortex would die too (same process group) before checking the Source page and flipping the status
    const keep = () => {};
    process.on("SIGINT", keep);
    try { return await Bun.spawn(confine(root, backend.interactive(prompt), mode), { cwd: root, stdio: ["inherit", "inherit", "inherit"] }).exited; }
    finally { process.off("SIGINT", keep); }
  }
  try { report({ level: "info", text: await backend.run(root, prompt, mode, report) }); return 0; }
  catch (e) { report({ level: "fail", text: (e as Error).message }); return 1; }
}

/** Flips pending → compiled by line replacement inside the frontmatter only: never a YAML re-serialization (raw is immutable, comments included). Atomic (tmp + rename); throws when no status line matched. */
export async function markCompiled(root: string, path: string) {
  const file = join(root, path);
  const txt = await readFile(file, "utf8");
  const fmEnd = txt.match(/^\uFEFF?---\r?\n(?:[\s\S]*?\r?\n)?---/)?.[0].length ?? 0;
  const head = txt.slice(0, fmEnd).replace(/^(status:[ \t]*)["']?pending["']?([ \t]*\r?)$/m, "$1compiled$2");
  if (head === txt.slice(0, fmEnd)) throw new Error(`statut pending introuvable dans ${path}`);
  await writeFile(`${file}.tmp`, head + txt.slice(fmEnd));
  await rename(`${file}.tmp`, file);
}

/** Resolves a raw source by id (folder name): exact match wins, else a unique prefix; ambiguous or unknown → error. */
export function resolveRawId<T extends { path: string }>(docs: T[], id: string): T {
  const idOf = (d: T) => rawId(d.path);
  const exact = docs.find((d) => idOf(d) === id);
  if (exact) return exact;
  const hits = docs.filter((d) => id !== "" && idOf(d).startsWith(id));
  if (hits.length > 1) throw new Error(`id ambigu : ${hits.map(idOf).join(", ")}`);
  if (!hits.length) throw new Error(`Source introuvable : ${id}`);
  return hits[0]!;
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
  if (!targets.length) { say("info", "Rien à compiler."); return done(true); }

  let ok = true;
  const sink: Report = (m) => say(m.level, m.text, m.mark);
  for (const d of targets) {
    const id = rawId(d.path);
    if (!String(d.fm.note ?? "").trim()) { say("fail", `${id} : note vide. Renseigne l'intention (champ note) avant de compiler.`); ok = false; continue; }
    if (d.fm.status !== "pending") say("info", paint.dim(`(${id} est déjà ${d.fm.status} : recompilation)`));
    const cfg = await w.config();
    const prompt = compilePrompt({ agentFile: agentFile(cfg.client), source: toResource(d.path), batch: opts.batch, language: cfg.language });
    say("info", `${paint.accent("→")} compile ${paint.bold(id)}${opts.batch ? paint.dim(" (batch)") : ""}`);
    const before = await changed(root, sink);
    const code = await run(w, prompt, !!opts.batch, "write", sink);
    const stray = await outOfScope(root, before, sink);
    if (stray.length) { say("warn", `l'agent a modifié hors de wiki/ : ${stray.join(", ")}`, "⚠"); ok = false; }
    if (await isCited(openWiki(root), d.path)) { // fresh context: the agent just wrote pages
      if (d.fm.status === "pending") {
        try { await markCompiled(root, d.path); }
        catch (e) { say("fail", `${id} : ${(e as Error).message}`); ok = false; continue; }
      }
      say("ok", `${id} compilée`);
    } else { say("fail", `${id} : aucune page Source ne cite la source (agent sorti avec ${code}) ; statut inchangé.`); ok = false; }
  }
  await (await import("./index")).regenerateCtx(openWiki(root));
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
  const code = await run(w, prompt, !opts.interactive, opts.file ? "write" : "read", sink);
  const after = await changed(root, sink);
  const touched = [...after].filter(([p, h]) => before.get(p) !== h).map(([p]) => p);
  const stray = touched.filter((p) => opts.file ? !p.startsWith("wiki/") : true);
  let ok = !code;
  if (stray.length) { say("warn", `fichiers modifiés hors du périmètre autorisé : ${stray.join(", ")}`, "⚠"); ok = false; }
  if (opts.file) {
    await (await import("./index")).regenerateCtx(openWiki(root)); // fresh context: the agent just wrote pages
  }
  return done(ok);
}
export const ask = (root: string, question: string, opts: AskOpts, report?: Report) => askCtx(openWiki(root), question, opts, report);
