import type { Wiki } from "./context";
import { fromResource, PAGE_TYPES } from "./doc";
import { CortexError, isReservedPage, rawPath, related } from "./lib";
import { getFile, reasonText } from "./mcp";
import { collator } from "./text";

/** `cortex ls`: wiki pages (reserved ones excluded), sorted by title, optionally of one type. */
export async function lsCtx(w: Wiki, type?: string) {
  if (type && !PAGE_TYPES.includes(type as any)) throw new CortexError(`--type attend ${PAGE_TYPES.join(" | ")}`, "usage");
  return (await w.pages())
    .filter((p) => !isReservedPage(p.path) && (!type || p.fm.type === type))
    .map((p) => ({ path: p.path, type: p.fm.type, status: p.fm.status, title: p.fm.title ?? p.path }))
    .sort((a, b) => collator.compare(a.title, b.title));
}

/** Path of `ref`: a wiki/ or raw/ path (leading `/` optional), a raw id, or the exact title of a page. */
export async function resolveRef(w: Wiki, ref: string): Promise<string> {
  const p = fromResource(ref);
  if (/^(wiki|raw)\//.test(p)) return p;
  const raw = rawPath(w.root, ref);
  if (raw) return raw;
  const hits = (await w.pages()).filter((d) => d.fm.title === ref);
  if (hits.length === 1) return hits[0].path;
  throw new Error(hits.length ? `Titre ambigu : ${ref} (${hits.map((h) => h.path).join(", ")})` : `Introuvable : ${ref} (chemin, id raw ou titre exact)`);
}

/** `cortex show`: the file, with the same confinement as MCP `get` (a .md under wiki/ or raw/). */
export const showCtx = async (w: Wiki, ref: string) => getFile(w.root, await resolveRef(w, ref));

/** `cortex related`: the pages related to one page, strongest first. */
export async function relatedCtx(w: Wiki, ref: string, limit: number) {
  const path = await resolveRef(w, ref);
  return related(await w.pages(), path, await w.linkGraph()).slice(0, limit)
    .map((r) => ({ path: r.path, title: r.title, score: r.score, reasons: r.reasons.map(reasonText) }));
}

/** System tools `cortex doctor` looks for: name, what needs it, how to install it. */
const TOOLS: [string, string, string][] = [
  ["git", "compile (contrôle des écritures hors wiki/)", "apt install git"],
  ["pdftotext", "add d'un PDF", "apt install poppler-utils"],
  process.platform === "darwin"
    ? ["sandbox-exec", "compile/ask sans SDK (confinement)", "fourni par macOS"]
    : ["bwrap", "compile/ask sans SDK (confinement)", "apt install bubblewrap"],
];

/** `cortex doctor`: which system tools are present. Report only: a missing tool disables one feature, not the CLI. */
export const doctor = () => TOOLS.map(([name, use, install]) => ({ name, use, install, path: Bun.which(name) ?? undefined }));
