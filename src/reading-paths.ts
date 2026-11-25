import { existsSync } from "node:fs";
import { join } from "node:path";
import { type DocError, parseDoc } from "./lib";
import { fromResource, pageId } from "./doc";
import type { PathData } from "../site/src/lib/paths";

/**
 * Reading paths: editorial itineraries through the wiki, written by hand as Markdown files under `<root>/paths/` (next to
 * `wiki/` and `raw/`, never under `wiki/`: they are not wiki pages, so no command that reads the wiki sees them). A path
 * file has a `title` and a `goal` in its front matter, an optional introduction, then an ordered list of steps: each
 * step opens with a root-relative link to a wiki page, followed by the reason to read it at that point.
 *
 *   ---
 *   title: Learn fermentation
 *   goal: Understand the basics before reading the syntheses.
 *   ---
 *   Optional introduction.
 *
 *   1. [Lactic fermentation](/wiki/concepts/lactic-fermentation.md): the mechanism everything else builds on.
 *   2. [Brine](/wiki/entities/brine.md): the variable that matters most.
 *
 * Parsing is pure (`parsePath`); `readPaths` only reads the folder. Whether a linked page exists is not checked here:
 * lint reports it, the export drops the step.
 */

export type PathStepSrc = { page: string; label: string; reason: string };
export type ReadingPath = {
  /** File name without `.md`: the path's address on the site (`/paths/<slug>/`). */
  slug: string;
  /** Root-relative path of the file (`paths/x.md`). */
  file: string;
  title: string;
  goal: string;
  /** Markdown before the first step. */
  intro: string;
  steps: PathStepSrc[];
  /** What cannot be read as a path (a step without a link, an unusable file name): lint reports each one. */
  problems: string[];
};

/** A file name that is a safe address: lowercase letters, digits, dashes. */
export const PATH_SLUG = /^[a-z0-9][a-z0-9-]*$/;

const ITEM = /^ {0,3}\d+[.)][ \t]+(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** The opening link of a step: `[label](/wiki/…md)`, an optional fragment ignored. */
const STEP_LINK = /^\[((?:[^\]\\]|\\.)*)\]\((\/wiki\/[^)#\s]+\.md)(?:#[^)\s]*)?\)/;

/** Parses the text of `paths/<slug>.md`. Throws on an unreadable front matter (`readPaths` reports it). */
export function parsePath(slug: string, text: string): ReadingPath {
  const file = `paths/${slug}.md`, doc = parseDoc(file, text);
  const problems: string[] = [];
  if (!PATH_SLUG.test(slug)) problems.push(`file name "${slug}.md" is not a usable address: lowercase letters, digits and dashes only`);
  const intro: string[] = [], items: string[][] = [];
  let open = false, fence = "";
  for (const line of doc.body.split(/\r?\n/)) {
    const f = FENCE.exec(line);
    if (f) fence = !fence ? f[1]![0]! : line.trimStart().startsWith(fence) ? "" : fence;
    else if (!fence) {
      const m = ITEM.exec(line);
      if (m) { items.push([m[1]!]); open = true; continue; }
      // a step goes on over indented lines, lazy continuation lines and blank lines between its paragraphs; any other text closes the list
      if (open && !(line.trim() === "" || /^\s+\S/.test(line) || items.at(-1)!.at(-1) !== "")) open = false;
    }
    if (open) items.at(-1)!.push(line.trim());
    else if (!items.length) intro.push(line); // text after the list is not part of the path
  }
  const steps: PathStepSrc[] = [];
  items.forEach((lines, i) => {
    const text = lines.join("\n").trim(), m = STEP_LINK.exec(text);
    if (!m) { problems.push(`step ${i + 1} does not start with a link to a wiki page: [title](/wiki/….md)`); return; }
    steps.push({ page: fromResource(m[2]!), label: m[1]!.replace(/\\(.)/g, "$1"), reason: text.slice(m[0].length).replace(/^[\s:–—-]+/, "").trim() });
  });
  const str = (v: unknown) => (v == null ? "" : String(v).trim());
  return { slug, file, title: str(doc.fm.title), goal: str(doc.fm.goal), intro: intro.join("\n").trim(), steps, problems };
}

/** The reading paths of a wiki (`paths/*.md`, sorted by file name); a file whose front matter does not parse is reported in `errors`. */
export async function readPaths(root: string): Promise<{ paths: ReadingPath[]; errors: DocError[] }> {
  const paths: ReadingPath[] = [], errors: DocError[] = [];
  if (!existsSync(join(root, "paths"))) return { paths, errors };
  for (const f of [...new Bun.Glob("*.md").scanSync(join(root, "paths"))].sort()) { // dotfiles are skipped, like everywhere else
    try { paths.push(parsePath(f.replace(/\.md$/, ""), await Bun.file(join(root, "paths", f)).text())); }
    catch (e) { errors.push({ path: `paths/${f}`, msg: (e as Error).message.split("\n")[0] }); }
  }
  return { paths, errors };
}

/**
 * The paths as the site shows them. A step whose page does not exist is dropped (and reported through `say`), a page named
 * twice keeps its first step, a path left with no step or without title and goal is not published: lint reports all of it.
 * `titleOf` gives the title and type of an existing page by wiki path (undefined: no such page); `inline` renders a reason
 * (inline Markdown, links relative to the path's own page) and `block` the introduction.
 */
export function sitePaths(
  paths: ReadingPath[],
  pageOf: (wikiPath: string) => { title: string; type: string; description: string } | undefined,
  html: { inline: (md: string, from: string) => string; block: (md: string, from: string) => string; plain: (html: string) => string },
  say: (m: string) => void,
): PathData[] {
  const out: PathData[] = [];
  for (const p of paths) {
    if (p.problems.some((x) => x.startsWith("file name")) || !p.title || !p.goal) { say(`reading path skipped: ${p.file} (title, goal and a usable file name are required)`); continue; }
    const from = `paths/${p.slug}/`, seen = new Set<string>();
    const steps = p.steps.flatMap((s) => {
      const page = pageOf(s.page);
      if (!page) { say(`reading path ${p.file}: step dropped, unknown page ${s.page}`); return []; }
      if (seen.has(s.page)) return [];
      seen.add(s.page);
      const reason = html.inline(s.reason, from);
      return [{ id: pageId(s.page), ...page, reason, reasonText: html.plain(reason) }];
    });
    if (!steps.length) { say(`reading path skipped: ${p.file} (no step left)`); continue; }
    out.push({ slug: p.slug, title: p.title, goal: p.goal, intro: p.intro ? html.block(p.intro, from) : "", steps });
  }
  return out;
}
