import { join } from "node:path";
import { readDocs } from "./lib";
import { backendFor, type Mode } from "./backends/index";
import { confine } from "./backends/backend";

async function git(root: string, ...args: string[]) {
  const p = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  return (await p.exited) === 0 ? out : undefined;
}

/** Fichiers modifiés/créés (porcelain) : sert de garde-fou de périmètre, quel que soit l'agent. */
async function changed(root: string): Promise<Map<string, string>> {
  const out = await git(root, "status", "--porcelain", "--untracked-files=all");
  const m = new Map<string, string>();
  for (const line of (out ?? "").split("\n").filter(Boolean)) {
    const path = line.slice(3);
    m.set(path, (await Bun.file(join(root, path)).exists()) ? new Bun.CryptoHasher("sha1").update(await Bun.file(join(root, path)).arrayBuffer()).digest("hex") : "deleted");
  }
  return m;
}

/** Ce que l'agent a touché hors de wiki/ (le statut d'une source raw compilée est l'unique exception, géré par le CLI). */
async function outOfScope(root: string, before: Map<string, string>): Promise<string[]> {
  const after = await changed(root);
  return [...after].filter(([p, h]) => before.get(p) !== h && !p.startsWith("wiki/")).map(([p]) => p);
}

/** Abstraction du Bridge : le backend (agnostique, Claude, Codex, opencode) est choisi par config.json. */
async function run(root: string, prompt: string, batch: boolean, mode: Mode): Promise<number> {
  const backend = await backendFor(root);
  prompt = `Racine du cerveau : ${root} (les chemins /raw/… et /wiki/… sont relatifs à cette racine). ` +
    (mode === "write" ? `Tu n'écris que sous ${join(root, "wiki")}/. ` : "Lecture seule. ") + prompt;
  // session interactive confinée elle aussi : une validation humaine trop rapide ne peut pas écrire hors de wiki/
  if (!batch) {
    // Ctrl+C vise l'agent ; sans ce gestionnaire, cortex mourrait aussi (même groupe de processus) avant de vérifier la page Source et de basculer le statut
    const keep = () => {};
    process.on("SIGINT", keep);
    try { return await Bun.spawn(confine(root, backend.interactive(prompt), mode), { cwd: root, stdio: ["inherit", "inherit", "inherit"] }).exited; }
    finally { process.off("SIGINT", keep); }
  }
  try { console.log(await backend.run(root, prompt, mode)); return 0; }
  catch (e) { console.error(`✗ ${(e as Error).message}`); return 1; }
}

/** Bascule pending → compiled par remplacement de ligne : jamais de ré-sérialisation YAML (raw est immuable, commentaires compris). */
async function markCompiled(root: string, path: string) {
  const f = Bun.file(join(root, path));
  const txt = await f.text();
  await Bun.write(f, txt.replace(/^status: pending$/m, "status: compiled"));
}

async function isCited(root: string, path: string) {
  return (await readDocs(root, "wiki")).some((d) => d.fm.type === "Source" && (d.fm.sources ?? []).some((s: any) => s.resource === `/${path}`));
}

export async function compile(root: string, ids: string[], opts: { pending?: boolean; batch?: boolean }) {
  const raw = await readDocs(root, "raw");
  const targets = opts.pending
    ? raw.filter((d) => d.fm.status === "pending")
    : ids.map((id) => raw.find((d) => d.path.split("/").at(-2) === id || d.path.split("/").at(-2)?.includes(id)) ?? (() => { throw new Error(`Source introuvable : ${id}`); })());
  if (!targets.length) { console.log("Rien à compiler."); return; }

  for (const d of targets) {
    const id = d.path.split("/").at(-2)!;
    if (!String(d.fm.note ?? "").trim()) { console.error(`✗ ${id} : note vide. Renseigne l'intention (champ note) avant de compiler.`); process.exitCode = 1; continue; }
    if (d.fm.status !== "pending") console.log(`(${id} est déjà ${d.fm.status} : recompilation)`);
    const prompt = `Applique le workflow INGEST de CORTEX.md à la source /${d.path}.` +
      (opts.batch ? " Mode non interactif : personne ne validera ta présentation ; écris directement, toutes les pages créées ou modifiées en status: draft. Ne touche pas au statut de la source raw : le CLI s'en charge." : " Ne touche pas au statut de la source raw : le CLI s'en charge.");
    console.log(`→ compile ${id}${opts.batch ? " (batch)" : ""}`);
    const before = await changed(root);
    const code = await run(root, prompt, !!opts.batch, "write");
    const stray = await outOfScope(root, before);
    if (stray.length) { console.error(`⚠ l'agent a modifié hors de wiki/ : ${stray.join(", ")}`); process.exitCode = 1; }
    if (await isCited(root, d.path)) {
      if (d.fm.status === "pending") await markCompiled(root, d.path);
      console.log(`✓ ${id} compilée`);
    } else { console.error(`✗ ${id} : aucune page Source ne cite la source (agent sorti avec ${code}) ; statut inchangé.`); process.exitCode = 1; }
  }
  await (await import("./index")).regenerate(root);
}

export async function ask(root: string, question: string, opts: { file?: boolean; interactive?: boolean }) {
  const prompt = `Applique le workflow QUERY de CORTEX.md à la question : « ${question} ».` +
    (opts.file ? " Range la réponse dans une page créée par cortex new Synthesis \"<titre>\" (status: draft), ajoute l'entrée Query au journal (cortex log add query \"…\" --page wiki/syntheses/….md) et lance cortex index."
      : " Ne modifie aucun fichier : réponds seulement. Si la réponse mérite une synthèse, dis-le en une ligne (relancer avec --file).");
  const before = await changed(root);
  const code = await run(root, prompt, !opts.interactive, opts.file ? "write" : "read");
  const after = await changed(root);
  const touched = [...after].filter(([p, h]) => before.get(p) !== h).map(([p]) => p);
  const stray = touched.filter((p) => opts.file ? !p.startsWith("wiki/") : true);
  if (stray.length) { console.error(`⚠ fichiers modifiés hors du périmètre autorisé : ${stray.join(", ")}`); process.exitCode = 1; }
  if (opts.file) {
    await (await import("./index")).regenerate(root);
  }
  if (code) process.exitCode = code;
}
