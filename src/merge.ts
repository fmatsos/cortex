import { addNoteDefs, fold, noteDef, noteId, normalizeNotes } from "./cite";
import { frontmatterError, parseDoc, setFmLine } from "./lib";
import { nearTitle } from "./naming";

// --- Merge into an existing page (docs/PIPELINE.md §4.4): the model can only add. Sections, repeated sentences, the
// contradiction callout, `sources[]` and the note definition are cortex's work; nothing here calls a model.

export type Update = { section: string; addition: string; contradiction: string | null };
/** The source a note points at: `id` of the note (`[^id]`), title and raw path of the definition. */
export type Cited = { id: string; title: string; resource?: string };
export type Merged = { text: string; /** A contradiction callout was added: the page is back to `draft`. */ contradiction: boolean; /** Sentences left out because the page says them already. */ dropped: number };

/** Two sentences are the same when the Jaccard of their word trigrams goes above this. */
const SAME = 0.8;

const DEF = /^\[\^([\w-]+)\]:/;
/** Weave's « Pages liées » item, appended after the note definitions at the end of a page. */
const LINKED = /^\s*[-*] \[[^\]]*\]\(\/wiki\/[^)]*\)\s*$/;

/** The `sources[]` entries of a page text (a YAML that does not parse throws, like `parseDoc`). */
function sourcesOf(path: string, text: string): Cited[] {
  const s = parseDoc(path, text).fm.sources;
  return (Array.isArray(s) ? s : []).filter((x) => x && typeof x === "object") as Cited[];
}

/**
 * Note id of `source` on the page `text`: the id of the entry already citing this `resource` (so that a replay never adds
 * a second entry), else the slug of the title, `-2`… when taken. The `update` step is given this id before it writes.
 */
export function sourceId(path: string, text: string, source: { title: string; resource?: string }): string {
  const cites = sourcesOf(path, text);
  return cites.find((c) => source.resource && c.resource === source.resource && c.id)?.id ?? noteId(source.title, cites.map((c) => String(c.id ?? "")));
}

// --- sentences

/** What is compared: notes, link targets, list numbers and markup gone, folded. */
const plain = (s: string) => fold(s.replace(/\[\^[\w-]+\]/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/^\s*\d+[.)]\s/, ""));

/** A sentence ends at . ! ? … (a note may follow) and a space, unless a lowercase letter comes next (« 3.5 », « e.g. foo »). */
const END = /(?<=[.!?…](?:\[\^[\w-]+\])*)\s+(?=[^\p{Ll}])/u;
/** A line of a list, table, quote or heading stands alone: it is not split into sentences. */
const BLOCK = /^\s*(?:[-*+]|\d+[.)])\s|^\s*[|>#]|^\s*```/;

type Block = { units: string[]; glue: string };

/** The paragraphs of a text, each as the units compared one by one (sentences, or lines for a list) and how to glue them back. */
function blocks(text: string): Block[] {
  return text.split(/\n[ \t]*\n/).filter((p) => p.trim()).map((p) => {
    if (p.includes("```")) return { units: [p], glue: "" };
    if (p.split("\n").some((l) => BLOCK.test(l))) return { units: p.split("\n").filter((l) => l.trim()), glue: "\n" };
    return { units: p.replace(/\s*\n\s*/g, " ").trim().split(END), glue: " " };
  });
}

const grams = (n: string) => {
  const w = n.split(" ").filter(Boolean);
  return new Set(w.length < 3 ? [n] : w.slice(2).map((_, i) => w.slice(i, i + 3).join(" ")));
};

/** What a page already says: `known(unit)` is true for an empty unit, an identical sentence or a near one (Jaccard on word trigrams). */
function said(text: string) {
  const all: { n: string; g: Set<string> }[] = [];
  const add = (u: string) => { const n = plain(u); all.push({ n, g: grams(n) }); };
  for (const b of blocks(text)) b.units.forEach(add);
  return {
    add,
    known(u: string) {
      const n = plain(u);
      if (!n) return true;
      const g = grams(n);
      return all.some((o) => o.n === n || [...g].filter((x) => o.g.has(x)).length / new Set([...g, ...o.g]).size > SAME);
    },
  };
}

// --- sections

type Section = { title: string | null; lines: string[] };

/** `##` sections of a body (the preamble is section 0, without title); a `###` stays inside its `##`; fenced code is never a heading. */
function sections(lines: string[]): Section[] {
  const out: Section[] = [{ title: null, lines: [] }];
  let fence = false;
  for (const l of lines) {
    if (/^\s*```/.test(l)) fence = !fence;
    const h = !fence && /^##\s+(\S.*?)\s*#*\s*$/.exec(l);
    if (h) out.push({ title: h[1], lines: [l] }); else out.at(-1)!.lines.push(l);
  }
  return out;
}

const trimEnd = (lines: string[]) => { while (lines.length && !lines.at(-1)!.trim()) lines.pop(); return lines; };

/** Frontmatter `sources[]` and `status` set line by line: a replacement that would break the YAML throws, nothing is written. */
function setFm(path: string, text: string, src: Cited, known: boolean, draft: boolean): string {
  let out = text;
  if (!known) {
    const entries = [...sourcesOf(path, text), { id: src.id, ...(src.resource && { resource: src.resource }), ...(src.title && { title: src.title }) }];
    out = setFmLine(out, "sources", Bun.YAML.stringify({ sources: entries }, null, 2).trimEnd());
  }
  if (draft) out = setFmLine(out, "status", "status: draft");
  const err = frontmatterError(out);
  if (err) throw new Error(`${path}: the merge would break the frontmatter: ${err}`);
  if (!known && !sourcesOf(path, out).some((c) => c.id === src.id)) throw new Error(`${path}: no frontmatter to hold sources[]`);
  return out;
}

/**
 * Adds what a source brings to the page `text` (frontmatter and body) and returns the new text, or `undefined` when there
 * is nothing to write. The target section is the one whose title is the same (folded) or a near title; none → a new
 * `## section` before the note definitions; an empty `section` → the last section. Sentences the page already says
 * (identical, or Jaccard on word trigrams above 0.8) are dropped, a paragraph left empty disappears. The rest is added
 * at the end of the section. A `contradiction` becomes a `> [!warning] Contradiction` callout at the head of the section
 * (unless the page has it already) and puts the page back to `draft`. `sources[]` gets the entry of `src` (unless it is
 * there), the definition `[^id]:` goes with the others. Nothing but the addition is written: replayed, the same merge
 * returns `undefined`. A contradiction callout counts as an addition, even if every sentence next to it was known.
 */
export function mergeUpdate(path: string, text: string, u: Update, src: Cited): Merged | undefined {
  const doc = parseDoc(path, text);
  const head = text.slice(0, text.length - doc.body.length);
  const defs: string[] = [], lines: string[] = [];
  for (const l of doc.body.split("\n")) (DEF.test(l) ? defs : lines).push(l);
  const secs = sections(lines);
  const before = said(lines.join("\n"));

  // what is new
  let dropped = 0;
  // the model's own definitions go (cortex writes the note's), its `#` and `##` headings would cut the section: `###`
  const mine = normalizeNotes(u.addition, src.id).body.split("\n").filter((l) => !DEF.test(l)).map((l) => l.replace(/^#{1,2}(?=\s)/, "###")).join("\n");
  const add = blocks(mine).map((b) => {
    const keep = b.units.filter((x) => (before.known(x) ? (dropped++, false) : (before.add(x), true)));
    return keep.join(b.glue);
  }).filter(Boolean);
  let callout: string | undefined;
  const c = u.contradiction?.replace(/\s+/g, " ").trim();
  if (c) {
    const noted = normalizeNotes(c, src.id).body;
    if (!before.known(noted)) callout = `> [!warning] Contradiction\n> ${/\[\^[\w-]+\]/.test(noted) ? noted : `${noted} [^${src.id}]`}`;
  }
  if (!add.length && !callout) return undefined;

  // where: the section named (folded or near title), else a new one at the end, else the last
  const name = u.section.replace(/^[#\s]+/, "").replace(/\s+/g, " ").trim().slice(0, 80);
  let target = !name ? (secs.length > 1 ? secs.at(-1) : secs[0]) : secs.find((s) => s.title && fold(s.title) === fold(name)) ?? secs.find((s) => s.title && nearTitle(s.title, name));
  if (!target) { trimEnd(secs.at(-1)!.lines).push(""); target = { title: name, lines: [`## ${name}`] }; secs.push(target); }
  const body = add.join("\n\n");
  const at = target.title === null ? 0 : 1; // the heading line stays first
  if (body) {
    // before weave's list of links, when it ends the page
    const last = target === secs.at(-1);
    let end = target.lines.length;
    if (last) { while (end > at && (!target.lines[end - 1].trim() || LINKED.test(target.lines[end - 1]))) end--; }
    const tail = last && end < target.lines.length && target.lines.slice(end).some((l) => LINKED.test(l)) ? target.lines.splice(end).filter((l, i, a) => l.trim() || a.slice(0, i).some((x) => x.trim())) : []; // its leading blank lines go
    trimEnd(target.lines).push("", ...body.split("\n"), "", ...tail);
    if (!tail.length) trimEnd(target.lines);
  }
  if (callout) {
    const rest = target.lines.slice(at);
    while (rest.length && !rest[0].trim()) rest.shift();
    target.lines = [...target.lines.slice(0, at), ...(at ? [""] : []), ...callout.split("\n"), ...(rest.length ? ["", ...rest] : [])];
  }

  let content = secs.flatMap((s) => s.lines).join("\n").trimEnd();
  if (!doc.body.trim()) content = content.replace(/^\s+/, "");
  const next = addNoteDefs(`${content}${defs.length ? `\n\n${defs.join("\n")}` : ""}\n`, [noteDef(src.id, src.title, src.resource)]);
  const known = sourcesOf(path, text).some((x) => x.id === src.id);
  return { text: setFm(path, head + next, src, known, !!callout && doc.fm.status !== "draft" && doc.fm.status !== "deprecated"), contradiction: !!callout, dropped };
}
