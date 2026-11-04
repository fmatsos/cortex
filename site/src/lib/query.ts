import { fold } from "./fold";

/**
 * Requête de la barre de recherche : texte libre (index inversé) + filtres structurés (métadonnées), tous combinés en ET.
 *   #tag  tag:x  type:concept|entity|synthesis|source  status:draft|stable|deprecated  is:fav  is:unverified
 *   "phrase exacte"   -mot   -#tag   -type:source …
 * Fonction pure, insensible aux accents et à la casse.
 */
export type Op = { key: "tag" | "type" | "status" | "is"; value: string; neg: boolean; raw: string };
export type Parsed = {
	words: string[]; // texte libre, repli
	phrases: { text: string; raw: string }[]; // "phrase exacte"
	exclude: { text: string; raw: string }[]; // -mot et -"phrase"
	ops: Op[];
};

export const KEYS = ["tag", "type", "status", "is"] as const;
const TYPES: Record<string, string> = {
	concept: "Concept", concepts: "Concept", entity: "Entity", entities: "Entity", entite: "Entity", entites: "Entity",
	synthesis: "Synthesis", syntheses: "Synthesis", synthese: "Synthesis", source: "Source", sources: "Source",
};
const IS: Record<string, string> = { fav: "fav", favori: "fav", favoris: "fav", favorite: "fav", unverified: "unverified", nonrelue: "unverified" };

/** Type canonique (Concept, Entity…) d'une valeur saisie : « synthèses », « entity »… ; sinon la valeur repliée. */
export const canonType = (v: string) => TYPES[fold(v)] ?? fold(v);

const TOKEN = /(-?)(?:"([^"]*)"|(#[^\s"]+)|([a-z]+):("[^"]*"|[^\s"]+)|([^\s"]+))/giu;

export function parseQuery(q: string): Parsed {
	const out: Parsed = { words: [], phrases: [], exclude: [], ops: [] };
	for (const m of q.matchAll(TOKEN)) {
		const [raw, dash, phrase, hashtag, key, val, word] = m;
		const neg = dash === "-", unq = (s: string) => s.replace(/^"|"$/g, "");
		if (phrase !== undefined) {
			const text = fold(phrase).trim();
			if (text) (neg ? out.exclude : out.phrases).push({ text, raw });
		} else if (hashtag) {
			const value = fold(hashtag.slice(1));
			if (value) out.ops.push({ key: "tag", value, neg, raw });
		} else if (key && (KEYS as readonly string[]).includes(fold(key))) {
			const k = fold(key) as Op["key"], v = fold(unq(val));
			if (v) out.ops.push({ key: k, value: k === "type" ? canonType(v) : k === "is" ? (IS[v.replace(/\W/g, "")] ?? v) : v, neg, raw });
		} else {
			const text = fold(word ?? raw.replace(/^-/, "")).trim();
			if (!text) continue;
			if (neg) out.exclude.push({ text, raw });
			else out.words.push(...(text.match(/[\p{L}\p{N}]+/gu) ?? []));
		}
	}
	return out;
}

export const isEmpty = (p: Parsed) => !p.words.length && !p.phrases.length && !p.exclude.length && !p.ops.length;

/** Retire de la requête toutes les occurrences du jeton brut `raw` (jeton entier : `#llm` ne touche pas `#llm2`), en nettoyant les espaces. */
export const removeToken = (q: string, raw: string) =>
	q.replace(new RegExp(`(^|\\s)${raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`, "g"), "").replace(/\s{2,}/g, " ").trimStart();

/** Puce de filtre : un libellé et le ou les jetons de la saisie qu'elle représente (un filtre répété donne une seule puce). */
export type Chip = { label: string; raws: string[] };
export function chips(p: Parsed): Chip[] {
	const out = new Map<string, Chip>();
	const all: [string, string][] = [
		...p.ops.map((o): [string, string] => [`${o.neg ? "sans " : ""}${o.key === "tag" ? "#" : `${o.key}:`}${o.value}`, o.raw]),
		...p.phrases.map((x): [string, string] => [`« ${x.text} »`, x.raw]),
		...p.exclude.map((x): [string, string] => [`sans ${x.text}`, x.raw]),
	];
	for (const [label, raw] of all) {
		const c = out.get(label);
		if (c) c.raws.push(raw); else out.set(label, { label, raws: [raw] });
	}
	return [...out.values()];
}

/** La requête demande les favoris (`is:fav`, non nié). */
export const wantsFav = (p: Parsed) => p.ops.some((o) => o.key === "is" && o.value === "fav" && !o.neg);

export type Doc = { id: string; title: string; description: string; type: string; tags: string[]; status: string; verified: boolean; text: string };

/** Les filtres structurés, les phrases et les exclusions sur les métadonnées et le texte (le texte libre reste à l'index). `hay` : texte replié précalculé. */
export function matches(d: Doc, p: Parsed, isFav: (id: string) => boolean, hay = fold(`${d.title} ${d.description} ${d.tags.join(" ")} ${d.text}`)): boolean {
	for (const o of p.ops) {
		const hit =
			o.key === "tag" ? d.tags.some((t) => fold(t) === o.value)
			: o.key === "type" ? d.type === o.value
			: o.key === "status" ? fold(d.status) === o.value
			: o.value === "fav" ? isFav(d.id)
			: o.value === "unverified" ? !d.verified
			: false;
		if (hit === o.neg) return false;
	}
	return p.phrases.every((x) => hay.includes(x.text)) && !p.exclude.some((x) => hay.includes(x.text));
}
