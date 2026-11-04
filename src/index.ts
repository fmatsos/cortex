import { join } from "node:path";
import { readDocs } from "./lib";
import { writeLogMd } from "./log";

const ORDER: [string, string][] = [["Concept", "Concepts"], ["Entity", "Entités"], ["Synthesis", "Synthèses"], ["Source", "Sources"]];

/** wiki/index.md generated from the frontmatters (OKF-reserved: no frontmatter). */
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

/** The two generated wiki files: index.md (from the frontmatters) and log.md (from log.jsonl). */
export async function regenerate(root: string) {
  await Bun.write(join(root, "wiki/index.md"), await renderIndex(root));
  await writeLogMd(root);
}
