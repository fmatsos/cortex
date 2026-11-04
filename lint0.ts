// ponytail: lint de l'étape 0, remplacé par `brain lint` à l'étape 2 (l'index vient de `brain index`)
const root = process.argv[2];
const files = [...new Bun.Glob("**/*.md").scanSync(root)].filter(f => !/^(archive|cli|node_modules)\//.test(f) && !f.includes("/node_modules/"));
const pages: Record<string, any> = {}; const errs: string[] = []; const inbound: Record<string, number> = {};
for (const f of files) {
  if (/(^|\/)(index|log)\.md$/.test(f)) continue;
  const txt = await Bun.file(`${root}/${f}`).text();
  const m = txt.match(/^---\n([\s\S]*?)\n---\n/); if (!m) { errs.push(`${f}: pas de frontmatter`); continue; }
  let fm: any; try { fm = Bun.YAML.parse(m[1]); } catch (e) { errs.push(`${f}: YAML invalide ${e}`); continue; }
  if (!fm.type) errs.push(`${f}: type manquant`);
  pages[f] = fm;
  if (f.startsWith("wiki/")) {
    if (!fm.description) errs.push(`${f}: description manquante`);
    const ids = new Set((fm.sources ?? []).map((s: any) => s.id));
    for (const s of fm.sources ?? []) if (!(await Bun.file(root + s.resource).exists())) errs.push(`${f}: source introuvable ${s.resource}`);
    for (const [, id] of txt.matchAll(/\[\^([\w-]+)\]/g)) if (!ids.has(id)) errs.push(`${f}: footnote [^${id}] sans sources[].id`);
    for (const [, l] of txt.matchAll(/\]\((\/wiki\/[^)]+)\)/g)) { inbound[l.slice(1)] = (inbound[l.slice(1)] ?? 0) + 1; if (!(await Bun.file(root + l).exists())) errs.push(`${f}: lien cassé ${l}`); }
  }
}
for (const f of Object.keys(pages)) if (f.startsWith("wiki/") && !inbound[f] && pages[f].type !== "Source") errs.push(`${f}: orphelin`);
console.log(errs.length ? errs.join("\n") : `OK — ${Object.keys(pages).length} pages, 0 erreur`);
// index
const order: [string, string][] = [["Concept","Concepts"],["Entity","Entités"],["Synthesis","Synthèses"],["Source","Sources"]];
let idx = "# Index\n";
for (const [t, h] of order) {
  idx += `\n## ${h}\n`;
  for (const [f, fm] of Object.entries(pages).filter(([f, fm]) => f.startsWith("wiki/") && fm.type === t).sort((a, b) => a[1].title.localeCompare(b[1].title)))
    idx += `- [${fm.title}](/${f}) — ${fm.description}\n`;
}
if (process.argv[3] === "--write-index") await Bun.write(`${root}/wiki/index.md`, idx);
