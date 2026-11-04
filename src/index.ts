import { join } from "node:path";
import { type Page, pageId, pageLink } from "./doc";
import { isReservedPage, readPages } from "./lib";
import { warn } from "./style";
import { writeLogMd } from "./log";

const ORDER: [string, string][] = [["Concept", "Concepts"], ["Entity", "Entités"], ["Synthesis", "Synthèses"], ["Source", "Sources"]];

/** wiki/index.md generated from the frontmatters (OKF-reserved: no frontmatter). */
export async function renderIndex(root: string): Promise<string> {
  const read = await readPages(root);
  for (const e of read.errors) warn(`page ignorée, frontmatter invalide : ${e.path} (${e.msg})`);
  const pages = read.pages.filter((d) => !isReservedPage(d.path));
  const title = (d: Page) => d.fm.title ?? pageId(d.path); // a page without title is listed by its id, never as « undefined »
  const bullets = (list: Page[]) => list.sort((a, b) => title(a).localeCompare(title(b)))
    .map((d) => `- [${title(d)}](${pageLink(d.path)})${d.fm.description ? ` — ${d.fm.description}` : ""}\n`).join("");
  let idx = "# Index\n";
  for (const [type, heading] of ORDER) idx += `\n## ${heading}\n${bullets(pages.filter((p) => p.fm.type === type))}`;
  // a mistyped or missing type must not remove the page from the catalogue (lint reports it)
  const other = pages.filter((p) => !ORDER.some(([type]) => type === p.fm.type));
  if (other.length) idx += `\n## Autres\n${bullets(other)}`;
  return idx;
}

/** The two generated wiki files: index.md (from the frontmatters) and log.md (from log.jsonl). */
export async function regenerate(root: string) {
  await Bun.write(join(root, "wiki/index.md"), await renderIndex(root));
  await writeLogMd(root);
}
