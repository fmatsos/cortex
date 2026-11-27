import { z } from "zod";
import type { ExtraTool } from "./backends/backend";
import { pageId } from "./doc";
import { render } from "./export";

// --- Display blocks of a site answer (cortex serve, POST /api/ask): the agent prepares them with render_blocks, then names
// each one ({{bloc-1}}) where it belongs in its Markdown. They travel inside the answer as a ```cortex-ui fence (the
// history keeps them), and the server turns the answer into segments the site draws with its own components.

const text = (what: string) => z.string().min(1).describe(`${what}, Markdown, links to wiki pages allowed`);
const title = z.string().min(1).optional().describe("short heading of the block");

export const BLOCK = z.discriminatedUnion("type", [
  z.object({ type: z.literal("callout"), tone: z.enum(["info", "warning", "success", "danger"]), title, text: text("the message") })
    .describe("a warning, an exception, a limit or an open point"),
  z.object({ type: z.literal("table"), title, columns: z.array(z.string().min(1)).min(1).max(6), rows: z.array(z.array(z.string())).min(1).max(40) })
    .describe("values that differ by case: one row per case, as many cells as columns (cells are Markdown)"),
  z.object({ type: z.literal("steps"), title, items: z.array(z.object({ title: z.string().min(1), text: text("detail of the step").optional() })).min(2).max(12) })
    .describe("an ordered process"),
  z.object({ type: z.literal("tabs"), tabs: z.array(z.object({ label: z.string().min(1), text: text("content of the tab") })).min(2).max(6) })
    .describe("one variant per tab (per tool, per case), each a few paragraphs"),
  z.object({ type: z.literal("facts"), title, items: z.array(z.object({ label: z.string().min(1), value: z.string().min(1) })).min(1).max(12) })
    .describe("key values: a figure, a date, a name, each short"),
  z.object({ type: z.literal("pages"), title, items: z.array(z.object({ path: z.string().regex(/^\/wiki\/.+\.md$/).describe("/wiki/….md"), summary: z.string().min(1).describe("one sentence: what this page brings to the answer") })).min(1).max(8) })
    .describe("the two to five pages that carry the answer, one sentence each"),
]);
export type Block = z.infer<typeof BLOCK>;

const LANG = "cortex-ui";
const FENCE = new RegExp("```" + LANG + "\\n([\\s\\S]*?)\\n```", "g");
const PLACEHOLDER = /\{\{\s*(bloc-\d+)\s*\}\}/g;
const HALF_NAME = /\{\{[^}]*\}?$/; // a name still being written at the end of a streamed text

/** A heading or a block title compared loosely: NFC, Markdown emphasis and trailing punctuation stripped, whitespace collapsed, case ignored. */
const sameTitle = (a: string, b: string) => {
  const norm = (s: string) => s.normalize("NFC").replace(/[*_`~]/g, "").replace(/\s+/g, " ").replace(/[\s:.!?;,…]+$/, "").trim().toLowerCase();
  return !!norm(a) && norm(a) === norm(b);
};

/** The text of the heading a block name directly follows (only blank lines between), if any. */
function headingBefore(before: string): string | undefined {
  const lines = before.split("\n");
  if (lines.pop()!.trim()) return undefined; // text on the name's own line
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  return /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(lines.at(-1) ?? "")?.[1];
}

/** Blocks as they travel in the answer text; a backtick is escaped so no text can close the fence. */
const fence = (b: Block) => `\n\n\`\`\`${LANG}\n${JSON.stringify(b).replaceAll("`", "\\u0060")}\n\`\`\`\n\n`;

/**
 * The blocks one answer prepared, and the render_blocks tool that fills it. Each block is drawn once, where the answer names
 * it; a block the answer never names closes it, so nothing prepared is lost. A second render_blocks call adds blocks (the
 * numbering goes on): the names the answer already uses stay valid, so it never forces a rewrite.
 */
export function blockRegistry(o: { titles?: Map<string, string>; log?: (m: string) => void } = {}) {
  const blocks = new Map<string, Block>();
  const exists = (path: string) => !o.titles || o.titles.has(path.slice(1)); // a wiki page, when the pages are known
  const tool: ExtraTool = {
    name: "render_blocks",
    description: "Prepares display blocks that the site draws inside the answer: callout, table, steps, tabs, facts, pages. Every answer uses it (at least one block). Returns one name per block ({{bloc-1}}); call it once, as soon as the reading shows the answer's shape, then write the answer and put each name on its own line where its block belongs. A second call only adds blocks: earlier names stay valid.",
    schema: z.object({ blocks: z.array(BLOCK).min(1).max(6) }),
    run: async ({ blocks: list }: { blocks: Block[] }) => {
      const names: string[] = [], notes: string[] = [];
      for (const b of list) {
        let kept = b;
        if (b.type === "pages") { // what answerSegments would drop silently is reported now, while the model can still correct
          const items = b.items.filter((p) => exists(p.path)), lost = b.items.filter((p) => !exists(p.path)).map((p) => p.path);
          if (!items.length) { notes.push(`Refused a pages block (no name): none of its paths exist in the wiki (${lost.join(", ")}). Use paths from the pages you read.`); continue; }
          if (lost.length) notes.push(`A pages block lost the paths that do not exist in the wiki: ${lost.join(", ")}.`);
          kept = { ...b, items };
        }
        const id = `bloc-${blocks.size + 1}`; blocks.set(id, kept); names.push(`{{${id}}} (${b.type})`);
      }
      return [names.length ? `Prepared: ${names.join(", ")}. Put each name on its own line in the answer where its block belongs; never repeat a block's content in the prose.` : "Nothing prepared.", ...notes].join(" ");
    },
  };
  /** Each name replaced by its block (the first time it appears); `rest`: the blocks never named, at the end; `lost`: the names dropped, with why. */
  const place = (md: string, rest: boolean, lost?: string[]) => {
    const placed = new Set<string>();
    const take = (id: string, named = true, before?: string) => {
      const b = blocks.get(id), why = !b ? "unknown" : placed.has(id) ? "duplicate" : b.type === "pages" && !b.items.some((p) => exists(p.path)) ? "undrawable" : "";
      if (why) { if (named) lost?.push(`{{${id}}} (${why})`); return ""; }
      placed.add(id);
      const h = before === undefined ? undefined : headingBefore(before); // a title the heading above already says is not repeated
      return fence(h !== undefined && "title" in b! && b.title && sameTitle(h, b.title) ? { ...b!, title: undefined } as Block : b!);
    };
    return md.replace(PLACEHOLDER, (_, id: string, at: number) => take(id, true, md.slice(0, at))) + (rest ? [...blocks.keys()].map((id) => take(id, false)).join("") : "");
  };
  /** The final answer, each name replaced by its block, the unnamed blocks at the end; the names dropped are logged, once. */
  const assemble = (md: string) => {
    const lost: string[] = [];
    const out = place(md, true, lost).trim();
    if (lost.length) o.log?.(`ask: dropped block ${lost.join(", ")}`);
    return out;
  };
  /** The text so far, for the stream: the blocks it names drawn in place as the final answer will, an unknown or half-written name dropped, the unnamed blocks left out until the end. */
  const draft = (md: string) => place(md.replace(HALF_NAME, ""), false);
  return { tool, assemble, draft, ready: () => blocks.size > 0 };
}

/** Streamed text as a draft when no block is known: every name, even half written, is dropped. */
export const draftMarkdown = (md: string) => md.replace(HALF_NAME, "").replace(PLACEHOLDER, "");

/** A block as plain Markdown: what the history carries, and what is shown when a fence does not parse. */
export function blockMarkdown(b: Block): string {
  const head = "title" in b && b.title ? `**${b.title}**\n\n` : "";
  switch (b.type) {
    case "callout": return `> ${head.trim() ? `${head.trim()} ` : ""}${b.text.replace(/\n/g, "\n> ")}`;
    case "table": return `${head}| ${b.columns.join(" | ")} |\n|${b.columns.map(() => " --- |").join("")}\n${b.rows.map((r) => `| ${r.join(" | ")} |`).join("\n")}`;
    case "steps": return `${head}${b.items.map((s, i) => `${i + 1}. **${s.title}**${s.text ? ` ${s.text}` : ""}`).join("\n")}`;
    case "tabs": return b.tabs.map((t) => `**${t.label}**\n\n${t.text}`).join("\n\n");
    case "facts": return `${head}${b.items.map((f) => `- **${f.label}** : ${f.value}`).join("\n")}`;
    case "pages": return `${head}${b.items.map((p) => `- [${p.path}](${p.path}) : ${p.summary}`).join("\n")}`;
  }
}

/** The blocks of a fence, or undefined when it is not what the site draws. */
function parse(json: string): Block | undefined {
  try { const r = BLOCK.safeParse(JSON.parse(json)); return r.success ? r.data : undefined; } catch { return undefined; }
}

/** The answer with its blocks as Markdown (history sent to the agent). */
export const flattenBlocks = (md: string) => md.replace(FENCE, (all, json: string) => { const b = parse(json); return b ? blockMarkdown(b) : all; });

/** A block whose text fields are sanitized HTML (wiki links resolved as in the prose), ready for the site's components. */
export type DrawnBlock =
  | { type: "callout"; tone: string; title?: string; html: string }
  | { type: "table"; title?: string; columns: string[]; rows: string[][] }
  | { type: "steps"; title?: string; items: { title: string; html: string }[] }
  | { type: "tabs"; tabs: { label: string; html: string }[] }
  | { type: "facts"; title?: string; items: { label: string; html: string }[] }
  | { type: "pages"; title?: string; items: { id: string; title: string; html: string }[] };
export type Segment = { html: string } | { block: DrawnBlock };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The Markdown without its empty sections: a heading followed (blank lines aside) by a heading of the same or a higher level, or by the end unless `partial`. */
function dropEmptyHeadings(md: string, partial: boolean): string {
  const lines = md.split("\n");
  let fenced = false;
  const level = lines.map((l) => (/^\s*```/.test(l) ? ((fenced = !fenced), 0) : fenced ? 0 : (/^(#{1,6})\s+\S/.exec(l)?.[1].length ?? 0)));
  const gone = new Set<number>();
  for (let i = lines.length - 1; i >= 0; i--) { // from the end, so a section emptied by the removal of its last subsection goes too
    if (!level[i]) continue;
    let j = i + 1;
    while (j < lines.length && (gone.has(j) || !lines[j]!.trim())) j++;
    if (j < lines.length ? level[j]! && level[j]! <= level[i]! : !partial) gone.add(i);
  }
  return gone.size ? lines.filter((_, i) => !gone.has(i)).join("\n") : md;
}

/** A link to a page of a space as an answer cites it: `](/s/<space>/wiki/x.md#frag)`, the file form `spaces/<space>/…` too. */
const SPACE_LINK = /\]\(\/(?:s|spaces)\/([a-z0-9][a-z0-9-]{0,39})\/(wiki\/[^)\s#]+)\.md(#[^)\s]*)?\)/g;

/**
 * An answer to a question that read several spaces: each citation of a page of `spaces` (space → wiki path → title) becomes the link to that
 * page on its own site, absolute (`/s/<space>/wiki/x/`), whatever space the visitor is in; a citation of a page that is not there, or of a
 * space that was not read, and a link with no space (it would mean the visitor's own space, which a several-spaces answer never meant), become
 * a missing page, never a link.
 */
export function qualifyLinks(md: string, spaces: Map<string, Map<string, string>>): string {
  const missing = "](/wiki/unknown-page.md)";
  return md.replace(/\]\(\/wiki\/[^)\s#]+\.md(?:#[^)\s]*)?\)/g, missing).replace(SPACE_LINK, (_all, space: string, path: string, frag = "") =>
    spaces.get(space)?.has(`${path}.md`) ? `](/s/${space}/${path}/${frag})` : missing);
}

/**
 * The answer as the site draws it: prose segments (sanitized HTML, wiki links relative to the site root, footnotes listed at
 * the end) and blocks. Labels are escaped; text fields go through the same rendering as the prose. A page of a `pages`
 * block that does not exist is dropped, and a heading left with nothing under it (its block was dropped) goes with it, unless
 * the text is still being written (`partial`: a heading at the very end may get its text). `titles`: wiki path → page title.
 */
export function answerSegments(md: string, titles: Map<string, string>, partial = false, spaces?: Map<string, Map<string, string>>): Segment[] {
  // an answer that read several spaces cites each page in its space; an answer of one space may still carry such a citation (the history of a conversation
  // that changed scope): the page on its own site, whether it exists is that site's to say, never a `.md` link
  md = spaces ? qualifyLinks(md, spaces) : md.replace(SPACE_LINK, (_all, space: string, path: string, frag = "") => `](/s/${space}/${path}/${frag})`);
  const paths = new Set(titles.keys());
  const html = (s: string) => render(s, "", paths).html;
  const inline = (s: string) => html(s).trim().replace(/^<p>([\s\S]*)<\/p>$/, "$1");
  const blocks: DrawnBlock[] = [];
  const draw = (b: Block): DrawnBlock | undefined => {
    const t = "title" in b && b.title ? { title: esc(b.title) } : {};
    switch (b.type) {
      case "callout": return { type: "callout", tone: b.tone, ...t, html: html(b.text) };
      case "table": return { type: "table", ...t, columns: b.columns.map(inline), rows: b.rows.map((r) => b.columns.map((_, i) => inline(r[i] ?? ""))) };
      case "steps": return { type: "steps", ...t, items: b.items.map((s) => ({ title: esc(s.title), html: s.text ? html(s.text) : "" })) };
      case "tabs": return { type: "tabs", tabs: b.tabs.map((x) => ({ label: esc(x.label), html: html(x.text) })) };
      case "facts": return { type: "facts", ...t, items: b.items.map((f) => ({ label: esc(f.label), html: inline(f.value) })) };
      case "pages": {
        const items = b.items.map((p) => ({ path: p.path.slice(1), summary: p.summary })).filter((p) => paths.has(p.path))
          .map((p) => ({ id: pageId(p.path), title: esc(titles.get(p.path)!), html: inline(p.summary) }));
        return items.length ? { type: "pages", ...t, items } : undefined;
      }
    }
  };
  // each block becomes a marker paragraph, so the prose is rendered once (its footnotes numbered across the whole answer)
  const prose = md.replace(FENCE, (all, json: string) => {
    const b = parse(json), d = b && draw(b);
    if (!d) return b ? "" : `\n\n${all}\n\n`;
    blocks.push(d);
    return `\n\nCORTEXBLOCK${blocks.length - 1}\n\n`;
  });
  const r = render(dropEmptyHeadings(prose, partial), "", paths);
  const notes = r.notes.length ? `<hr><ol class="ask-notes">${r.notes.map((n) => `<li id="fn-${n.id}">${n.html}</li>`).join("")}</ol>` : "";
  const parts = (r.html + notes).split(/<p>CORTEXBLOCK(\d+)<\/p>/);
  const out: Segment[] = [];
  parts.forEach((p, i) => {
    if (i % 2) out.push({ block: blocks[+p]! });
    else if (p.trim()) out.push({ html: p });
  });
  return out;
}
