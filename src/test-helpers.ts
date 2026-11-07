import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UUID_RE } from "./template";

/** Anchored any-version UUID, shared by the tests that check generated ids. */
export const UUID = new RegExp(`^${UUID_RE}$`);
/** A v7 id as the CLI generates them. */
export const newId = (at = new Date()) => Bun.randomUUIDv7("hex", at);

/** Throwaway root: 3 wiki pages linked by links, tags and a shared source, plus a raw source. */
export async function mcpRoot() {
  const root = mkdtempSync(join(tmpdir(), "cortex-"));
  const res = "/raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md";
  const page = (type: string, title: string, tags: string, body: string) =>
    `---\ntype: ${type}\ntitle: ${title}\ndescription: D ${title}.\ntags: [${tags}]\nsources:\n  - id: x\n    resource: ${res}\n    title: X\n---\n${body}\n`;
  await Bun.write(join(root, "cortex.json"), "{}");
  await Bun.write(join(root, "raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md"), "---\ntype: RawSource\ntitle: X\nnote: n\nstatus: compiled\n---\nUn texte sur le zythum.\n");
  await Bun.write(join(root, "wiki/concepts/a.md"), page("Concept", "Alpha", "llm, ctx", "Voir [B](/wiki/concepts/b.md)."));
  await Bun.write(join(root, "wiki/concepts/b.md"), page("Concept", "Beta", "ctx", "Rien."));
  await Bun.write(join(root, "wiki/entities/c.md"), page("Entity", "Gamma", "llm", "Voir [A](/wiki/concepts/a.md#x)."));
  await Bun.write(join(root, "wiki/index.md"), "# Index\n- [Alpha](/wiki/concepts/a.md)\n- [Beta](/wiki/concepts/b.md)\n- [Gamma](/wiki/entities/c.md)\n");
  await Bun.write(join(root, "wiki/log.jsonl"), '{"at":"2026-11-03","kind":"add","text":"y"}\n{"at":"2026-11-04T09:00:00+01:00","kind":"lint","text":"0 erreur"}\n{"at":"2026-11-04T10:00:00+01:00","kind":"add","text":"x","sources":["01a1a5c9-5e80-7075-ae13-aab03b0a8697"]}\n');
  return root;
}

// captured from the MCP `related` tool before reasons became structured (`related` on /wiki/concepts/a.md, mcpRoot fixture)
export const GOLDEN_MCP_RELATED = `[
 {
  "path": "/wiki/concepts/b.md",
  "title": "Beta",
  "score": 6,
  "reasons": [
   "outgoing link",
   "shared source: /raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md",
   "shared tag: ctx"
  ]
 },
 {
  "path": "/wiki/entities/c.md",
  "title": "Gamma",
  "score": 6,
  "reasons": [
   "incoming link",
   "shared source: /raw/2026/11/01a1a5c9-5e80-7075-ae13-aab03b0a8697/source.md",
   "shared tag: llm"
  ]
 }
]`;
