import { join } from "node:path";
import { regenerateCtx } from "./catalog";
import { openWiki, type Wiki } from "./context";
import { pageId } from "./doc";
import { frontmatterError, isReservedPage, localIso, setFmLine } from "./lib";
import { appendLogCtx } from "./log";

/**
 * A human reviewed a page: `status: stable` (a draft; a deprecated page stays so), `verified: { by: "human:<name>", at }`, the journal and the index
 * regenerated. The page is looked up by its id among the existing pages (never a path taken as is from a request).
 * `at` uses `generated.at`'s format, so `needsReview` clears. Returns the page path.
 */
export async function verifyPage(w: Wiki, id: string, reviewer: string, now = new Date()): Promise<string> {
  const page = (await w.pages()).find((d) => !isReservedPage(d.path) && pageId(d.path) === id);
  if (!page) throw new Error(`unknown page: ${id}`);
  const f = Bun.file(join(w.root, page.path));
  let text = await f.text();
  if (!page.fm.status || page.fm.status === "draft") text = setFmLine(text, "status", "status: stable"); // deprecated stays deprecated
  text = setFmLine(text, "verified", `verified: { by: ${JSON.stringify(`human:${reviewer}`)}, at: ${localIso(now)} }`);
  const err = frontmatterError(text);
  if (err) throw new Error(`${page.path}: ${err}`);
  await Bun.write(f, text);
  await appendLogCtx(w, { kind: "update", text: `reviewed by human:${reviewer}: ${page.fm.title ?? id}`, pages: [page.path] }, now);
  await regenerateCtx(openWiki(w.root)); // fresh context: the page just changed
  return page.path;
}
