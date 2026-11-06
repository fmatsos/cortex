import { slugify } from "./lib";

/** A fact a page states: the claim, and the passage of the source that proves it (only shown to the model). */
export type Fact = { claim: string; quote: string };

/** Words of a window searched when a quote is not found whole (PIPELINE §4.2). */
const WINDOW = 12;

/** Comparison form: lowercase, accents removed, punctuation and markup ignored, spaces folded. */
export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export type Match = "exact" | "partial" | "none";

/** `hay` is a folded source wrapped in spaces, so that a match always falls on word boundaries. */
function find(hay: string, quote: string): Match {
  const q = fold(quote);
  if (!q) return "none";
  if (hay.includes(` ${q} `)) return "exact";
  const words = q.split(" ");
  for (let i = 0; i + WINDOW <= words.length; i++) if (hay.includes(` ${words.slice(i, i + WINDOW).join(" ")} `)) return "partial";
  return "none";
}

const wrap = (source: string) => ` ${fold(source)} `;

/**
 * Is `quote` in `source`? Both are folded; found whole = `exact`; else any 12 consecutive words of the quote found in
 * the source = `partial` (a model that rewords the end of a quote still points at real text); else `none`. A quote
 * shorter than 12 words has to be exact; an empty one never matches.
 */
export const verifyQuote = (source: string, quote: string): Match => find(wrap(source), quote);

/** Splits facts into those whose `quote` is found in the source and the rejected ones (the guard against invented facts). */
export function verifyFacts<T extends { quote: string }>(source: string, facts: T[]): { kept: T[]; rejected: T[] } {
  const hay = wrap(source), kept: T[] = [], rejected: T[] = [];
  for (const f of facts) (find(hay, f.quote) === "none" ? rejected : kept).push(f);
  return { kept, rejected };
}

/** Note id for a source cited on a page: the slug of its title, `-2`, `-3`… when `taken` (ids already in the page's `sources[]`). */
export function noteId(title: string, taken: Iterable<string>): string {
  const used = new Set(taken), base = slugify(title, 40);
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Definition line of a note (schema.md): `[^id]: <source title>, <url or raw path>`, one line. */
export const noteDef = (id: string, title: string, resource?: string) => `[^${id}]: ${[title, resource].filter(Boolean).map((s) => s!.replace(/\s+/g, " ").trim()).join(", ")}`;

const DEF = /^\[\^([\w-]+)\]:/;

/** Adds definitions at the end of a body, after the existing ones; a note already defined is left alone (replayable). */
export function addNoteDefs(body: string, defs: string[]): string {
  const have = new Set(body.split("\n").map((l) => DEF.exec(l)?.[1]));
  const add = defs.filter((d) => { const id = DEF.exec(d)![1]; return !have.has(id) && have.add(id); });
  if (!add.length) return body;
  const text = body.trimEnd(), last = text.split("\n").at(-1) ?? "";
  return `${text}${!text || DEF.test(last) ? "\n".repeat(text ? 1 : 0) : "\n\n"}${add.join("\n")}\n`;
}

/** Points every `[^x]` of a model-written body at `id` (it only knows the one note it was given); `count` = notes in the result. */
export function normalizeNotes(body: string, id: string): { body: string; count: number } {
  let count = 0;
  const out = body.replace(/\[\^([\w-]+)\](?!:)/g, () => (count++, `[^${id}]`));
  return { body: out, count };
}
