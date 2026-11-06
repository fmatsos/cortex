import type { Page } from "./doc";
import { isReservedPage, wikiLinks } from "./lib";
import { LIMITS } from "./limits";

/**
 * Deterministic link suggestions (report only for now): a page that mentions the title (or an alias) of a Concept or
 * Entity page without linking to it. Three filters, all required:
 *  1. mention — the name appears as whole words in the prose (not in code, quotes, headings, existing links);
 *     a name shared by several pages is ambiguous and skipped; a short name (acronym) only counts in its exact case;
 *  2. keyphraseness — learnt from the wiki's own links (Mihalcea & Csomai 2007): of the pages that mention the name,
 *     how many link to its page; a name that is mentioned everywhere but rarely linked is a common word, not a subject;
 *  3. context — the two pages are about related things: a shared tag or raw source, or a similarity above a threshold.
 *     The similarity is a parameter: lexical (TF-IDF cosine) by default, embeddings later.
 * Same wiki, same suggestions: no model involved, every suggestion carries its reasons.
 */

/** Similarity of two pages in [0, 1]. Built once for the whole wiki: `prepare` sees every page. */
export type Similarity = { name: string; prepare(pages: Page[]): (a: Page, b: Page) => number };

export type LinkSuggestion = {
  path: string; from: string; target: string; title: string; term: string; score: number;
  /** Why: the mention, the keyphraseness evidence, the context that ties both pages. */
  reasons: string[];
};

const TARGET_TYPES = new Set(["Concept", "Entity"]);
const WORD = /[\p{L}\p{N}]+/gu;

/** The prose of a body: code, quotes and callouts, headings, footnote definitions and existing links removed. */
export function prose(body: string): string {
  return body
    .replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/^\s*(>|#{1,6}\s|\[\^[^\]]+\]:).*$/gm, " ")
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\^[^\]]+\]/g, " ");
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/** A short name (4 letters or less, e.g. « LLM », « Go ») is matched in its exact case only. */
const exact = (name: string) => name.replace(/[^\p{L}\p{N}]/gu, "").length <= 4;

/** Default context: cosine of TF-IDF vectors of the pages' prose. */
export const lexical: Similarity = {
  name: "tfidf",
  prepare(pages) {
    const tf = new Map<string, Map<string, number>>(), df = new Map<string, number>();
    for (const p of pages) {
      const m = new Map<string, number>();
      for (const w of fold(prose(p.body)).match(WORD) ?? []) if (w.length > 2) m.set(w, (m.get(w) ?? 0) + 1);
      tf.set(p.path, m);
      for (const w of m.keys()) df.set(w, (df.get(w) ?? 0) + 1);
    }
    const vec = new Map<string, Map<string, number>>();
    for (const [path, m] of tf) {
      const v = new Map<string, number>();
      let n = 0;
      for (const [w, c] of m) { const x = (1 + Math.log(c)) * Math.log(pages.length / df.get(w)!); v.set(w, x); n += x * x; }
      n = Math.sqrt(n) || 1;
      for (const [w, x] of v) v.set(w, x / n);
      vec.set(path, v);
    }
    return (a, b) => {
      const [va, vb] = [vec.get(a.path)!, vec.get(b.path)!];
      const [small, big] = va.size < vb.size ? [va, vb] : [vb, va];
      let s = 0;
      for (const [w, x] of small) s += x * (big.get(w) ?? 0);
      return s;
    };
  },
};

export function suggestLinks(all: Page[], sim: Similarity = lexical): LinkSuggestion[] {
  const pages = all.filter((d) => !isReservedPage(d.path));
  const targets = pages.filter((d) => TARGET_TYPES.has(String(d.fm.type)) && d.fm.title);

  // names → target; a name two pages share is ambiguous
  const owner = new Map<string, Page | null>();
  for (const t of targets) {
    const aliases = [(t.fm as Record<string, unknown>).aliases].flat().filter((a): a is string => typeof a === "string");
    for (const name of new Set([String(t.fm.title), ...aliases].map((n) => n.trim()).filter((n) => n.length >= LIMITS.linkMinName))) {
      const k = exact(name) ? name : fold(name);
      owner.set(k, owner.has(k) && owner.get(k) !== t ? null : t);
    }
  }
  const names = [...owner.entries()].filter(([, t]) => t) as [string, Page][];
  if (!names.length) return [];

  // filter 1: one pass per page, longest names first so « Qwen3 4B » wins over « Qwen3 »
  // ponytail: one big regex alternation; an Aho-Corasick automaton if tens of thousands of names make it slow
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const regex = (keys: string[]) =>
    keys.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${keys.sort((a, b) => b.length - a.length).map(esc).join("|")})(?![\\p{L}\\p{N}])`, "gu") : undefined;
  const byKey = new Map(names);
  const keys = names.map(([k]) => k);
  // short names in their exact case on the prose as written, the others on the folded prose (no case, no accents)
  const [reExact, reFold] = [regex(keys.filter(exact)), regex(keys.filter((k) => !exact(k)))];
  const mentions = new Map<string, Map<Page, string>>(); // page → target → name found
  for (const p of pages) {
    const m = new Map<Page, string>(), text = prose(p.body);
    for (const [re, t] of [[reExact, text], [reFold, fold(text)]] as const)
      for (const hit of re ? t.matchAll(re) : []) {
        const target = byKey.get(hit[0].replace(/\s+/g, " "))!;
        if (target && target !== p && !m.has(target)) m.set(target, String(target.fm.title));
      }
    mentions.set(p.path, m);
  }

  // filter 2: keyphraseness of each target's names = pages linking to it / pages mentioning it
  const linksOf = new Map(pages.map((p) => [p.path, new Set(wikiLinks(p.body))]));
  const mentionedIn = new Map<Page, number>(), linkedIn = new Map<Page, number>();
  for (const p of pages) for (const t of mentions.get(p.path)!.keys()) {
    mentionedIn.set(t, (mentionedIn.get(t) ?? 0) + 1);
    if (linksOf.get(p.path)!.has(t.path)) linkedIn.set(t, (linkedIn.get(t) ?? 0) + 1);
  }

  const similar = sim.prepare(pages);
  const out: LinkSuggestion[] = [];
  for (const p of pages) {
    const mine: LinkSuggestion[] = [];
    for (const [t, term] of mentions.get(p.path)!) {
      if (linksOf.get(p.path)!.has(t.path)) continue;
      const seen = mentionedIn.get(t)!, linked = linkedIn.get(t) ?? 0;
      const evidence = seen >= LIMITS.linkMinEvidence; // too few mentions: frequencies say nothing yet, the context decides
      if (evidence && seen / pages.length > LIMITS.linkMaxSpread) continue; // everywhere: a common word
      const kp = evidence ? linked / seen : undefined;
      if (kp !== undefined && kp < LIMITS.linkMinKeyphraseness) continue;
      const reasons = [`mentions « ${term} »`, kp === undefined ? `few mentions yet (${seen})` : `linked on ${linked} of the ${seen} pages that mention it`];
      const tags = (p.fm.tags ?? []).filter((x) => (t.fm.tags ?? []).includes(x));
      const srcs = (p.fm.sources ?? []).filter((s) => s.resource && (t.fm.sources ?? []).some((u) => u.resource === s.resource));
      const s = similar(p, t);
      if (tags.length) reasons.push(`shared tag ${tags.join(", ")}`);
      if (srcs.length) reasons.push("shared source");
      if (s >= LIMITS.linkMinSimilarity) reasons.push(`${sim.name} ${s.toFixed(2)}`);
      if (!tags.length && !srcs.length && s < LIMITS.linkMinSimilarity) continue;
      mine.push({ path: p.path, from: String(p.fm.title ?? ""), target: t.path, title: String(t.fm.title), term, reasons, score: (kp ?? 0.5) + s + (tags.length ? 0.25 : 0) + (srcs.length ? 0.25 : 0) });
    }
    out.push(...mine.sort((a, b) => b.score - a.score || a.target.localeCompare(b.target)).slice(0, LIMITS.linkMaxPerPage));
  }
  return out;
}
