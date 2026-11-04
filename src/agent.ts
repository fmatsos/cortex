import { join } from "node:path";
import { readDocs } from "./lib";

/**
 * L'agent est une commande externe ; le CLI ne contient aucun SDK LLM.
 * BRAIN_AGENT : session interactive (défaut `claude`), le prompt est passé en dernier argument.
 * BRAIN_AGENT_BATCH : non interactif (défaut `claude -p`), le prompt est envoyé sur l'entrée standard.
 */
const split = (s: string) => s.split(/\s+/).filter(Boolean);
const INTERACTIVE = () => split(process.env.BRAIN_AGENT ?? "claude");
const BATCH = () => split(process.env.BRAIN_AGENT_BATCH ?? "claude -p");
const isClaude = (cmd: string[]) => cmd[0] === "claude";

// outils accordés à `claude -p` (ignorés pour un autre agent, le garde-fou git couvre le reste)
const READ_TOOLS = ["Read", "Glob", "Grep", "Bash(brain search:*)"];
const WRITE_TOOLS = [...READ_TOOLS, "Write", "Edit", "Bash(brain index)", "Bash(brain lint:*)"];

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

async function run(root: string, prompt: string, batch: boolean, tools: string[]): Promise<number> {
  if (!batch) {
    return Bun.spawn([...INTERACTIVE(), prompt], { cwd: root, stdio: ["inherit", "inherit", "inherit"] }).exited;
  }
  const cmd = BATCH();
  // --allowedTools est variadique : le prompt passe par l'entrée standard, pas en argument
  const args = isClaude(cmd) ? [...cmd, "--allowedTools", ...tools] : cmd;
  return Bun.spawn(args, { cwd: root, stdin: new TextEncoder().encode(prompt), stdout: "inherit", stderr: "inherit" }).exited;
}

/** Bascule pending → compiled par remplacement de ligne : jamais de ré-sérialisation YAML (raw est immuable, commentaires compris). */
async function markCompiled(root: string, path: string) {
  const f = Bun.file(join(root, path));
  const txt = await f.text();
  await Bun.write(f, txt.replace(/^status: pending$/m, "status: compiled"));
}

async function isCited(root: string, path: string) {
  return (await readDocs(root, "wiki/sources")).some((d) => (d.fm.sources ?? []).some((s: any) => s.resource === `/${path}`));
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
    const prompt = `Applique le workflow INGEST de BRAIN.md à la source /${d.path}.` +
      (opts.batch ? " Mode non interactif : personne ne validera ta présentation ; écris directement, toutes les pages créées ou modifiées en status: draft. Ne touche pas au statut de la source raw : le CLI s'en charge." : " Ne touche pas au statut de la source raw : le CLI s'en charge.");
    console.log(`→ compile ${id}${opts.batch ? " (batch)" : ""}`);
    const before = await changed(root);
    const code = await run(root, prompt, !!opts.batch, WRITE_TOOLS);
    const stray = await outOfScope(root, before);
    if (stray.length) { console.error(`⚠ l'agent a modifié hors de wiki/ : ${stray.join(", ")}`); process.exitCode = 1; }
    if (await isCited(root, d.path)) {
      if (d.fm.status === "pending") await markCompiled(root, d.path);
      console.log(`✓ ${id} compilée`);
    } else { console.error(`✗ ${id} : aucune page wiki/sources ne cite la source (agent sorti avec ${code}) ; statut inchangé.`); process.exitCode = 1; }
  }
  const { renderIndex } = await import("./index");
  await Bun.write(join(root, "wiki/index.md"), await renderIndex(root));
}

export async function ask(root: string, question: string, opts: { file?: boolean; interactive?: boolean }) {
  const prompt = `Applique le workflow QUERY de BRAIN.md à la question : « ${question} ».` +
    (opts.file ? " Range la réponse dans wiki/syntheses/ (status: draft), ajoute l'entrée Query au log et lance brain index."
      : " Ne modifie aucun fichier : réponds seulement. Si la réponse mérite une synthèse, dis-le en une ligne (relancer avec --file).");
  const before = await changed(root);
  const code = await run(root, prompt, !opts.interactive, opts.file ? WRITE_TOOLS : READ_TOOLS);
  const after = await changed(root);
  const touched = [...after].filter(([p, h]) => before.get(p) !== h).map(([p]) => p);
  const stray = touched.filter((p) => opts.file ? !p.startsWith("wiki/") : true);
  if (stray.length) { console.error(`⚠ fichiers modifiés hors du périmètre autorisé : ${stray.join(", ")}`); process.exitCode = 1; }
  if (opts.file) {
    const { renderIndex } = await import("./index");
    await Bun.write(join(root, "wiki/index.md"), await renderIndex(root));
  }
  if (code) process.exitCode = code;
}
