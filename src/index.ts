import { readDocs } from "./lib";

const ORDER: [string, string][] = [["Concept", "Concepts"], ["Entity", "Entités"], ["Synthesis", "Synthèses"], ["Source", "Sources"]];

/** wiki/index.md généré depuis les frontmatters (réservé OKF : pas de frontmatter). */
export async function renderIndex(root: string): Promise<string> {
  const pages = (await readDocs(root, "wiki")).filter((d) => !/^wiki\/(index|log)\.md$/.test(d.path));
  let idx = "# Index\n";
  for (const [type, heading] of ORDER) {
    idx += `\n## ${heading}\n`;
    for (const d of pages.filter((p) => p.fm.type === type).sort((a, b) => String(a.fm.title).localeCompare(String(b.fm.title))))
      idx += `- [${d.fm.title}](/${d.path}) — ${d.fm.description}\n`;
  }
  return idx;
}
