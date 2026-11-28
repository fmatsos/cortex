import { existsSync } from "node:fs";
import { join } from "node:path";
import { rawId } from "./doc";

/** One source of raw/ waiting for its compilation. */
export type PendingSource = { id: string; path: string; title: string };

/** How much of a source is read to find its frontmatter: sources can be large, the scan must stay cheap. */
const HEAD = 8192;
const unquote = (v: string) => {
  const s = v.trim();
  if (s.startsWith('"')) { try { return String(JSON.parse(s)); } catch { /* not JSON: as written */ } }
  return s.length > 1 && s.startsWith("'") && s.endsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : s;
};

/**
 * The sources of `raw/**\/source.md` whose frontmatter says `status: pending`, in path order (the ids sort by time: oldest first).
 * Reads the head of each file only, with the same line rule as `markCompiled` (agent.ts), not a YAML parse: `GET /api/compile` calls it
 * every few seconds while the site shows the queue.
 */
export async function pendingSources(root: string): Promise<PendingSource[]> {
  const dir = join(root, "raw");
  if (!existsSync(dir)) return [];
  const out: PendingSource[] = [];
  for (const f of [...new Bun.Glob("**/source.md").scanSync(dir)].sort()) {
    const file = Bun.file(join(dir, f));
    let text = await file.slice(0, HEAD).text();
    const fm = (t: string) => /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(t)?.[1];
    let head = fm(text);
    if (head === undefined && file.size > HEAD) head = fm((text = await file.text())); // a frontmatter longer than the head: the whole file
    if (head === undefined || !/^status:[ \t]*["']?pending["']?[ \t]*\r?$/m.test(head)) continue;
    const path = `raw/${f}`, id = rawId(path);
    out.push({ id, path, title: unquote(/^title:[ \t]*(.*?)[ \t]*\r?$/m.exec(head)?.[1] ?? "") || id });
  }
  return out;
}
