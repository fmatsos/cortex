import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { readFile, rename, writeFile } from "node:fs/promises";
import { rawId, toResource } from "./doc";
import { readPages, readRawSources } from "./lib";
import { backendFor, type Mode } from "./backends/index";
import { confine } from "./backends/sandbox";
import { agentFileFor } from "./config";
import { fail, paint, warn } from "./style";

async function git(root: string, ...args: string[]) {
  const p = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  return (await p.exited) === 0 ? out : undefined;
}

const unversioned = new Set<string>();

/** Modified/created files (porcelain v1, NUL-separated: no quoting of non-ASCII paths): serves as a scope guard, whatever the agent. */
export async function changed(root: string): Promise<Map<string, string>> {
  const out = await git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all");
  const m = new Map<string, string>();
  if (out === undefined) {
    if (!unversioned.has(root)) { unversioned.add(root); warn("pas de dépôt git : le périmètre de l'agent n'est pas vérifié"); }
    return m;
  }
  const fields = out.split("\0");
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f) continue;
    const paths = [f.slice(3)];
    // rename/copy: the origin path follows as the next NUL field
    if (f[0] === "R" || f[0] === "C" || f[1] === "R" || f[1] === "C") paths.push(fields[++i]);
    for (const path of paths) {
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
export async function outOfScope(root: string, before: Map<string, string>): Promise<string[]> {
  const after = await changed(root);
  return [...after].filter(([p, h]) => before.get(p) !== h && !p.startsWith("wiki/")).map(([p]) => p);
}

/** Bridge abstraction: the backend (agnostic, Claude, Codex, opencode) is chosen by config.json. */
async function run(root: string, prompt: string, batch: boolean, mode: Mode): Promise<number> {
  if (homeInside(root)) { fail("la racine du cerveau contient ton répertoire personnel : l'agent ne pourrait plus écrire son état (~/.claude…). Utilise un dossier dédié."); return 1; }
  const backend = await backendFor(root);
  prompt = `Racine du cerveau : ${root} (les chemins /raw/… et /wiki/… sont relatifs à cette racine). ` +
    (mode === "write" ? `Tu n'écris que sous ${join(root, "wiki")}/. ` : "Lecture seule. ") + prompt;
  // interactive session confined as well: a too-quick human approval cannot write outside wiki/
  if (!batch) {
    // Ctrl+C targets the agent; without this handler, cortex would die too (same process group) before checking the Source page and flipping the status
    const keep = () => {};
    process.on("SIGINT", keep);
    try { return await Bun.spawn(confine(root, backend.interactive(prompt), mode), { cwd: root, stdio: ["inherit", "inherit", "inherit"] }).exited; }
    finally { process.off("SIGINT", keep); }
  }
  try { console.log(await backend.run(root, prompt, mode)); return 0; }
  catch (e) { fail((e as Error).message); return 1; }
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

async function isCited(root: string, path: string) {
  return (await readPages(root)).pages.some((d) => d.fm.type === "Source" && (d.fm.sources ?? []).some((s) => s.resource === toResource(path)));
}

export async function compile(root: string, ids: string[], opts: { pending?: boolean; batch?: boolean }) {
  const raw = (await readRawSources(root)).raws;
  const targets = opts.pending
    ? raw.filter((d) => d.fm.status === "pending")
    : ids.map((id) => resolveRawId(raw, id));
  if (!targets.length) { console.log("Rien à compiler."); return; }

  for (const d of targets) {
    const id = rawId(d.path);
    if (!String(d.fm.note ?? "").trim()) { fail(`${id} : note vide. Renseigne l'intention (champ note) avant de compiler.`); process.exitCode = 1; continue; }
    if (d.fm.status !== "pending") console.log(paint.dim(`(${id} est déjà ${d.fm.status} : recompilation)`));
    const prompt = `Applique le workflow INGEST de ${await agentFileFor(root)} à la source ${toResource(d.path)}.` +
      (opts.batch ? " Mode non interactif : personne ne validera ta présentation ; écris directement, toutes les pages créées ou modifiées en status: draft. Ne touche pas au statut de la source raw : le CLI s'en charge." : " Ne touche pas au statut de la source raw : le CLI s'en charge.");
    console.log(`${paint.accent("→")} compile ${paint.bold(id)}${opts.batch ? paint.dim(" (batch)") : ""}`);
    const before = await changed(root);
    const code = await run(root, prompt, !!opts.batch, "write");
    const stray = await outOfScope(root, before);
    if (stray.length) { warn(`l'agent a modifié hors de wiki/ : ${stray.join(", ")}`, "⚠"); process.exitCode = 1; }
    if (await isCited(root, d.path)) {
      if (d.fm.status === "pending") {
        try { await markCompiled(root, d.path); }
        catch (e) { fail(`${id} : ${(e as Error).message}`); process.exitCode = 1; continue; }
      }
      console.log(`${paint.ok("✓")} ${id} compilée`);
    } else { fail(`${id} : aucune page Source ne cite la source (agent sorti avec ${code}) ; statut inchangé.`); process.exitCode = 1; }
  }
  await (await import("./index")).regenerate(root);
}

export async function ask(root: string, question: string, opts: { file?: boolean; interactive?: boolean }) {
  const prompt = `Applique le workflow QUERY de ${await agentFileFor(root)} à la question : « ${question} ».` +
    (opts.file ? " Range la réponse dans une page créée par cortex new Synthesis \"<titre>\" (status: draft), ajoute l'entrée Query au journal (cortex log add query \"…\" --page wiki/syntheses/….md) et lance cortex index."
      : " Ne modifie aucun fichier : réponds seulement. Si la réponse mérite une synthèse, dis-le en une ligne (relancer avec --file).");
  const before = await changed(root);
  const code = await run(root, prompt, !opts.interactive, opts.file ? "write" : "read");
  const after = await changed(root);
  const touched = [...after].filter(([p, h]) => before.get(p) !== h).map(([p]) => p);
  const stray = touched.filter((p) => opts.file ? !p.startsWith("wiki/") : true);
  if (stray.length) { warn(`fichiers modifiés hors du périmètre autorisé : ${stray.join(", ")}`, "⚠"); process.exitCode = 1; }
  if (opts.file) {
    await (await import("./index")).regenerate(root);
  }
  if (code) process.exitCode = code;
}
