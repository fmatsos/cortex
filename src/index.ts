import { join } from "node:path";
import { isReservedPage, readDocs } from "./lib";
import { warn } from "./style";
import { writeLogMd } from "./log";

const ORDER: [string, string][] = [["Concept", "Concepts"], ["Entity", "Entités"], ["Synthesis", "Synthèses"], ["Source", "Sources"]];

/** wiki/index.md generated from the frontmatters (OKF-reserved: no frontmatter). */
export async function renderIndex(root: string): Promise<string> {
  const read = await readDocs(root, "wiki");
  for (const e of read.errors) warn(`page ignorée, frontmatter invalide : ${e.path} (${e.msg})`);
  const pages = read.docs.filter((d) => !isReservedPage(d.path));
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
