import { join } from "node:path";
import type { Page } from "./doc";
import { dateMs } from "./doc";
import { frontmatterError, isReservedPage, localIso, parseDoc, setFmLine, wikiLinks } from "./lib";
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
  /** Where the first mention is in the page body (UTF-16 offset and length), for --write. */
  at: number; length: number;
  /** Why: the mention, the keyphraseness evidence, the context that ties both pages. */
  reasons: string[];
};

const TARGET_TYPES = new Set(["Concept", "Entity"]);
const WORD = /[\p{L}\p{N}]+/gu;

/**
 * The prose of a body: code, quotes and callouts, headings, footnote definitions, existing links and bold/italic
 * markers blanked out. Same length as the body (blanked, not removed): an offset in the prose is an offset in the body.
 */
export function prose(body: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return body
    .replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(/^\s*(>|#{1,6}\s|\[\^[^\]]+\]:|\|).*$/gm, blank)
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, blank)
    .replace(/\[\^[^\]]+\]/g, blank)
    .replace(/<[^>\n]*>/g, blank);
}

/** No case, no accents, one code unit for one: offsets stay those of the input. */
const fold = (s: string) => Array.from(s, (c) => { const f = c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(); return f.length === c.length ? f : c; }).join("");
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

/**
 * `scope` (compile): only the suggestions found in the pages of `scope.pages`, or aiming at the pages of `scope.targets`,
 * the same as the whole-wiki run would give for them, without matching every name in every page: the names are matched in
 * the scoped pages first, then only the names found there plus those of the scoped targets are matched in the whole wiki
 * (their keyphraseness counts every page; names sharing a word with them are matched too, as the longest match wins). One difference: in a page outside `scope.pages` the cap of `linkMaxPerPage`
 * counts only the suggestions aiming at `scope.targets`.
 */
export function suggestLinks(all: Page[], sim: Similarity = lexical, scope?: { pages: Set<string>; targets: Set<string> }): LinkSuggestion[] {
  const pages = all.filter((d) => !isReservedPage(d.path));
  const targets = pages.filter((d) => TARGET_TYPES.has(String(d.fm.type)) && d.fm.title && d.fm.status !== "deprecated"); // a deprecated page keeps its old title: its replacement carries it as an alias

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
  type Mention = { at: number; length: number };
  /** page → target → first mention of the `keys` names, in the pages `list`. */
  const scan = (list: Page[], keys: string[]) => {
    // short names in their exact case on the prose as written, the others on the folded prose (no case, no accents)
    const [reExact, reFold] = [regex(keys.filter(exact)), regex(keys.filter((k) => !exact(k)))];
    const out = new Map<string, Map<Page, Mention>>();
    for (const p of list) {
      const m = new Map<Page, Mention>(), text = prose(p.body);
      for (const [re, t] of [[reExact, text], [reFold, fold(text)]] as const)
        for (const hit of re ? t.matchAll(re) : []) {
          const target = byKey.get(hit[0].replace(/\s+/g, " "));
          const prev = target && m.get(target);
          if (target && target !== p && (!prev || hit.index! < prev.at)) m.set(target, { at: hit.index!, length: hit[0].length });
        }
      out.set(p.path, m);
    }
    return out;
  };
  let mentions: Map<string, Map<Page, Mention>>;
  if (scope) {
    const wanted = new Set(targets.filter((t) => scope.targets.has(t.path)));
    for (const m of scan(pages.filter((p) => scope.pages.has(p.path)), names.map(([k]) => k)).values()) for (const t of m.keys()) wanted.add(t);
    // plus the names sharing a word with them: a longer name that overlaps one would take the match away from it (« Qwen3 4B » / « Qwen3 »)
    const words = (k: string) => fold(k).match(WORD) ?? [], near = new Set(names.filter(([, t]) => wanted.has(t)).flatMap(([k]) => words(k)));
    mentions = scan(pages, names.filter(([k, t]) => wanted.has(t) || words(k).some((w) => near.has(w))).map(([k]) => k));
  } else mentions = scan(pages, names.map(([k]) => k));

  // filter 2: keyphraseness of each target's names = pages linking to it / pages mentioning it
  const linksOf = new Map(pages.filter((p) => mentions.get(p.path)?.size).map((p) => [p.path, new Set(wikiLinks(p.body))]));
  const mentionedIn = new Map<Page, number>(), linkedIn = new Map<Page, number>();
  for (const p of pages) for (const t of mentions.get(p.path)!.keys()) {
    mentionedIn.set(t, (mentionedIn.get(t) ?? 0) + 1);
    if (linksOf.get(p.path)!.has(t.path)) linkedIn.set(t, (linkedIn.get(t) ?? 0) + 1);
  }

  let prepared: ReturnType<Similarity["prepare"]> | undefined; // built (the whole wiki's TF-IDF) only when a mention gets that far
  const similar = (a: Page, b: Page) => (prepared ??= sim.prepare(pages))(a, b);
  const out: LinkSuggestion[] = [];
  for (const p of pages) {
    const mine: LinkSuggestion[] = [];
    for (const [t, { at, length }] of mentions.get(p.path)!) {
      if (scope && !scope.pages.has(p.path) && !scope.targets.has(t.path)) continue;
      const term = p.body.slice(at, at + length);
      if (linksOf.get(p.path)!.has(t.path)) continue;
      const seen = mentionedIn.get(t)!, linked = linkedIn.get(t) ?? 0;
      const evidence = seen >= LIMITS.linkMinEvidence; // too few mentions: frequencies say nothing yet, the context decides
      if (evidence && seen > Math.min(LIMITS.linkMaxSpread * pages.length, LIMITS.linkMaxSpreadPages)) continue; // everywhere: a common word
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
      mine.push({ path: p.path, from: String(p.fm.title ?? ""), target: t.path, title: String(t.fm.title), term, at, length, reasons, score: (kp ?? 0.5) + s + (tags.length ? 0.25 : 0) + (srcs.length ? 0.25 : 0) });
    }
    out.push(...mine.sort((a, b) => b.score - a.score || a.target.localeCompare(b.target)).slice(0, LIMITS.linkMaxPerPage));
  }
  return out;
}

/**
 * Writes the suggestions as links, on the mention itself: « … Codex … » → « … [Codex](/wiki/entities/….md) … ».
 * The body is read again and a mention that no longer sits where it was found is skipped. A page that changes gets
 * `generated: { by: cortex-links, at: now }`; a reviewed page that was up to date keeps its review (`verified.at` moves
 * along, `verified.by` stays): adding links is not a change of content to review again. A page already waiting for a
 * review still waits. The pages of `keep` (written by the compile that calls this) keep their stamp. Returns the
 * suggestions written.
 */
export async function writeLinks(root: string, found: LinkSuggestion[], now = new Date(), keep = new Set<string>()): Promise<LinkSuggestion[]> {
  const written: LinkSuggestion[] = [];
  const byPage = Map.groupBy(found, (s) => s.path);
  for (const [path, list] of byPage) {
    const file = join(root, path), text = await Bun.file(file).text();
    let body = parseDoc(path, text).body;
    const head = text.slice(0, text.length - body.length);
    const before = written.length;
    for (const s of [...list].sort((a, b) => b.at - a.at)) { // from the end: earlier offsets stay valid
      if (body.slice(s.at, s.at + s.length) !== s.term) continue;
      body = `${body.slice(0, s.at)}[${s.term}](/${s.target})${body.slice(s.at + s.length)}`;
      written.push(s);
    }
    if (written.length === before) continue;
    await Bun.write(file, keep.has(path) ? head + body : stampLinked(path, text, head + body, now));
  }
  return written;
}

/**
 * The page `next` (links added to `prev`) stamped: `generated: { by: cortex-links, at: now }`, and `verified.at`
 * moved to now when `prev` was reviewed and up to date. A stamp that would break the YAML is dropped, the links stay.
 */
export function stampLinked(path: string, prev: string, next: string, now = new Date()): string {
  const fm = parseDoc(path, prev).fm as { generated?: { at?: unknown }; verified?: { by?: unknown; at?: unknown } };
  const [gen, ver] = [dateMs(fm.generated?.at), dateMs(fm.verified?.at)];
  const upToDate = fm.verified && ver !== undefined && (gen === undefined || gen <= ver);
  let out = setFmLine(next, "generated", `generated: { by: "cortex-links", at: ${localIso(now)} }`);
  if (upToDate) out = setFmLine(out, "verified", `verified: { by: ${JSON.stringify(fm.verified!.by ?? null)}, at: ${localIso(now)} }`);
  return frontmatterError(out) ? next : out;
}
