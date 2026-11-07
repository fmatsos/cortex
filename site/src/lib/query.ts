import { fold } from "./fold";
import { t } from "./i18n/index";

/**
 * Search bar query: free text (inverted index) + structured filters (metadata), all combined with AND.
 *   #tag  tag:x  type:concept|entity|synthesis|source  status:draft|stable|deprecated  is:fav|unverified|review|partial
 *   "exact phrase"   -word   -#tag   -type:source …
 * Pure function, insensitive to accents and case.
 * `text`/`value`: folded form, for comparing; `display`: what the reader typed, to display it (accents kept).
 */
export type Op = { key: "tag" | "type" | "status" | "is"; value: string; neg: boolean; raw: string; display: string };
export type Parsed = {
	words: string[]; // free text, folded
	phrases: { text: string; raw: string; display: string }[]; // "exact phrase"
	exclude: { text: string; raw: string; display: string }[]; // -word and -"phrase"
	ops: Op[];
};

export const KEYS = ["tag", "type", "status", "is"] as const;
const TYPES: Record<string, string> = {
	concept: "Concept", concepts: "Concept", entity: "Entity", entities: "Entity", entite: "Entity", entites: "Entity",
	synthesis: "Synthesis", syntheses: "Synthesis", synthese: "Synthesis", source: "Source", sources: "Source",
};
const IS: Record<string, string> = {
	fav: "fav", favori: "fav", favoris: "fav", favorite: "fav",
	unverified: "unverified", nonrelue: "unverified", jamaisrelue: "unverified",
	review: "review", relire: "review", arelire: "review", needsreview: "review",
	partial: "partial", partiel: "partial", partielle: "partial",
};

/** Recognized values of each operator (except `tag`, free). */
export const TYPE_VALUES = ["Concept", "Entity", "Synthesis", "Source"] as const;
export const STATUS_VALUES = ["draft", "stable", "deprecated"] as const;
export const IS_VALUES = ["fav", "unverified", "review", "partial"] as const;

/** Canonical type (Concept, Entity…) of a typed value: "synthèses", "entity"…; otherwise the folded value. */
export const canonType = (v: string) => TYPES[fold(v)] ?? fold(v);

const TOKEN = /(-?)(?:"([^"]*)"|(#[^\s"]+)|([a-z]+):("[^"]*"|[^\s"]+)|([^\s"]+))/giu;

export function parseQuery(q: string): Parsed {
	const out: Parsed = { words: [], phrases: [], exclude: [], ops: [] };
	for (const m of q.matchAll(TOKEN)) {
		const [raw, dash, phrase, hashtag, key, val, word] = m;
		const neg = dash === "-", unq = (s: string) => s.replace(/^"|"$/g, "");
		if (phrase !== undefined) {
			const text = fold(phrase).trim();
			if (text) (neg ? out.exclude : out.phrases).push({ text, raw, display: phrase.trim() });
		} else if (hashtag) {
			const value = fold(hashtag.slice(1));
			if (value) out.ops.push({ key: "tag", value, neg, raw, display: hashtag.slice(1) });
		} else if (key && (KEYS as readonly string[]).includes(fold(key))) {
			const k = fold(key) as Op["key"], v = fold(unq(val));
			if (v) {
				const value = k === "type" ? canonType(v) : k === "is" ? (IS[v.replace(/\W/g, "")] ?? v) : v;
				out.ops.push({ key: k, value, neg, raw, display: k === "tag" ? unq(val).trim() : value });
			}
		} else {
			const text = fold(word ?? raw.replace(/^-/, "")).trim();
			if (!text) continue;
			if (neg) out.exclude.push({ text, raw, display: (word ?? raw.replace(/^-/, "")).trim() });
			else out.words.push(...(text.match(/[\p{L}\p{N}]+/gu) ?? []));
		}
	}
	return out;
}

export const isEmpty = (p: Parsed) => !p.words.length && !p.phrases.length && !p.exclude.length && !p.ops.length;

/** The query searches for text (free word or phrase): the only case where an excerpt and a highlight make sense. */
export const hasText = (p: Parsed) => p.words.length > 0 || p.phrases.length > 0;

/** Query to pass on to a page opened from a result (passage highlighting): empty if there is no searched text. */
export const passageQuery = (q: string) => (hasText(parseQuery(q)) ? q.trim() : "");
/** Link to a page, with the query that made it found (`?q=`) when it has text. `href`: already resolved link. */
export const withPassage = (href: string, q: string) => {
	const pq = passageQuery(q);
	return pq ? `${href}?q=${encodeURIComponent(pq)}` : href;
};

/** Removes from the query all occurrences of the raw token `raw` (whole token: `#llm` does not touch `#llm2`), cleaning up spaces. */
export const removeToken = (q: string, raw: string) =>
	q.replace(new RegExp(`(^|\\s)${raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`, "g"), "").replace(/\s{2,}/g, " ").trimStart();

/** Filter chip: a label and the input token(s) it represents (a repeated filter gives a single chip). */
export type Chip = { label: string; raws: string[] };
export function chips(p: Parsed): Chip[] {
	const out = new Map<string, Chip>();
	// key: folded form (deduplication); label: typed form, accents included
	const all: [string, string, string][] = [
		...p.ops.map((o): [string, string, string] => {
			const pre = `${o.neg ? `${t("query.without")} ` : ""}${o.key === "tag" ? "#" : `${o.key}:`}`;
			return [pre + o.value, pre + (o.key === "tag" ? o.display : o.value), o.raw];
		}),
		...p.phrases.map((x): [string, string, string] => [`"${x.text}"`, t("query.quoted", { text: x.display }), x.raw]),
		...p.exclude.map((x): [string, string, string] => [`-${x.text}`, `${t("query.without")} ${x.display}`, x.raw]),
	];
	for (const [key, label, raw] of all) {
		const c = out.get(key);
		if (c) c.raws.push(raw); else out.set(key, { label, raws: [raw] });
	}
	return [...out.values()];
}

/** The query asks for favorites (`is:fav`, not negated). */
export const wantsFav = (p: Parsed) => p.ops.some((o) => o.key === "is" && o.value === "fav" && !o.neg);

/** Folded values of the non-negated `key` operators of the query: state of the facets. */
export const activeValues = (p: Parsed, key: Op["key"]): Set<string> => new Set(p.ops.filter((o) => o.key === key && !o.neg).map((o) => o.value));

const token = (key: Op["key"], value: string) => (key === "tag" ? (/[\s"]/.test(value) ? `tag:"${value.replace(/"/g, "")}"` : `#${value}`) : `${key}:${value}`);

/**
 * Toggles a facet in the input: active → removes all its tokens; inactive → appends it at the end of the input.
 * `type` and `status` are single-choice (two values ANDed never match anything): picking one replaces the other.
 * `tag` and `is` add up (AND).
 */
export function toggleFacet(q: string, key: Op["key"], value: string): string {
	const v = key === "type" ? canonType(value) : fold(value);
	const p = parseQuery(q);
	const same = p.ops.filter((o) => o.key === key && !o.neg && o.value === v);
	if (same.length) return same.reduce((s, o) => removeToken(s, o.raw), q).trim();
	let out = q;
	if (key === "type" || key === "status") for (const o of p.ops) if (o.key === key && !o.neg) out = removeToken(out, o.raw);
	return `${out.trim()} ${token(key, key === "type" ? v : key === "tag" ? value : v)}`.trim();
}

/** Removes every filter (operator) from the input, keeping the searched text. */
export const clearOps = (q: string) => parseQuery(q).ops.reduce((s, o) => removeToken(s, o.raw), q).trim();

/** A query problem: the message, the faulty tokens and the label of the fix (remove those tokens). */
export type Issue = { text: string; raws: string[]; fix: string };
const VALID: Record<"type" | "status" | "is", readonly string[]> = { type: TYPE_VALUES, status: STATUS_VALUES, is: IS_VALUES };
const VALID_LABEL = { type: "concept, entity, synthesis, source", status: "draft, stable, deprecated", is: "fav, unverified, review, partial" } as const;

/**
 * Recognized but unusable operators: unknown value, two exclusive values ANDed, a filter and its opposite,
 * a tag no page carries (`knownTags`: folded tags, when known). Each problem names the tokens to remove:
 * this tells a typo apart from a valid query that simply finds nothing.
 */
export function diagnose(p: Parsed, knownTags?: Set<string>): Issue[] {
	const out: Issue[] = [];
	for (const o of p.ops) {
		if (o.key === "tag") {
			if (!o.neg && knownTags && !knownTags.has(o.value)) out.push({ text: t("query.issue.unknownTag", { tag: o.display }), raws: [o.raw], fix: t("query.fix.remove", { token: `#${o.display}` }) });
		} else if (!VALID[o.key].includes(o.value)) {
			out.push({ text: t("query.issue.unknownValue", { token: `${o.key}:${o.display}`, values: VALID_LABEL[o.key] }), raws: [o.raw], fix: t("query.fix.remove", { token: `${o.key}:${o.display}` }) });
		}
	}
	for (const key of ["type", "status"] as const) {
		const vs = p.ops.filter((o) => o.key === key && !o.neg && VALID[key].includes(o.value));
		const distinct = [...new Set(vs.map((o) => o.value))];
		if (distinct.length > 1) {
			const first = vs[0].value;
			out.push({
				text: t(key === "type" ? "query.issue.exclusiveType" : "query.issue.exclusiveStatus", { tokens: distinct.map((v) => `${key}:${v}`).join(` ${t("query.and")} `) }),
				raws: vs.filter((o) => o.value !== first).map((o) => o.raw),
				fix: t("query.fix.keepOnly", { token: `${key}:${first}` }),
			});
		}
	}
	for (const o of p.ops) {
		if (o.neg) continue;
		const opposite = p.ops.find((x) => x.neg && x.key === o.key && x.value === o.value);
		if (opposite) out.push({ text: t("query.issue.contradiction", { a: o.raw, b: opposite.raw }), raws: [opposite.raw], fix: t("query.fix.remove", { token: opposite.raw }) });
	}
	return out;
}

export type Doc = { id: string; title: string; description: string; type: string; tags: string[]; status: string; verified: boolean; needsReview?: boolean; partial?: boolean; text: string };

/** The structured filters, phrases and exclusions on the metadata and the text (free text stays with the index). `hay`: precomputed folded text. */
export function matches(d: Doc, p: Parsed, isFav: (id: string) => boolean, hay = fold(`${d.title} ${d.description} ${d.tags.join(" ")} ${d.text}`)): boolean {
	for (const o of p.ops) {
		const hit =
			o.key === "tag" ? d.tags.some((t) => fold(t) === o.value)
			: o.key === "type" ? d.type === o.value
			: o.key === "status" ? fold(d.status) === o.value
			: o.value === "fav" ? isFav(d.id)
			: o.value === "unverified" ? !d.verified
			: o.value === "review" ? !!d.needsReview
			: o.value === "partial" ? !!d.partial
			: false;
		if (hit === o.neg) return false;
	}
	return p.phrases.every((x) => hay.includes(x.text)) && !p.exclude.some((x) => hay.includes(x.text));
}
