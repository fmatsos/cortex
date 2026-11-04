import { fold } from "./fold";

/**
 * Requête de la barre de recherche : texte libre (index inversé) + filtres structurés (métadonnées), tous combinés en ET.
 *   #tag  tag:x  type:concept|entity|synthesis|source  status:draft|stable|deprecated  is:fav|unverified|review|partial
 *   "phrase exacte"   -mot   -#tag   -type:source …
 * Fonction pure, insensible aux accents et à la casse.
 * `text`/`value` : forme repliée, pour comparer ; `display` : ce que le lecteur a tapé, pour l'afficher (accents conservés).
 */
export type Op = { key: "tag" | "type" | "status" | "is"; value: string; neg: boolean; raw: string; display: string };
export type Parsed = {
	words: string[]; // texte libre, repli
	phrases: { text: string; raw: string; display: string }[]; // "phrase exacte"
	exclude: { text: string; raw: string; display: string }[]; // -mot et -"phrase"
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

/** Valeurs reconnues de chaque opérateur (hors `tag`, libre). */
export const TYPE_VALUES = ["Concept", "Entity", "Synthesis", "Source"] as const;
export const STATUS_VALUES = ["draft", "stable", "deprecated"] as const;
export const IS_VALUES = ["fav", "unverified", "review", "partial"] as const;

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

/** La requête cherche du texte (mot libre ou phrase) : seul cas où un extrait et un surlignage ont un sens. */
export const hasText = (p: Parsed) => p.words.length > 0 || p.phrases.length > 0;

/** Requête à transmettre à une page ouverte depuis un résultat (surlignage du passage) : vide s'il n'y a pas de texte cherché. */
export const passageQuery = (q: string) => (hasText(parseQuery(q)) ? q.trim() : "");
/** Lien vers une page, avec la requête qui l'a fait trouver (`?q=`) quand elle a du texte. `href` : lien déjà résolu. */
export const withPassage = (href: string, q: string) => {
	const pq = passageQuery(q);
	return pq ? `${href}?q=${encodeURIComponent(pq)}` : href;
};

/** Retire de la requête toutes les occurrences du jeton brut `raw` (jeton entier : `#llm` ne touche pas `#llm2`), en nettoyant les espaces. */
export const removeToken = (q: string, raw: string) =>
	q.replace(new RegExp(`(^|\\s)${raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`, "g"), "").replace(/\s{2,}/g, " ").trimStart();

/** Puce de filtre : un libellé et le ou les jetons de la saisie qu'elle représente (un filtre répété donne une seule puce). */
export type Chip = { label: string; raws: string[] };
export function chips(p: Parsed): Chip[] {
	const out = new Map<string, Chip>();
	// clé : forme repliée (dédoublonnage) ; libellé : forme saisie, accents compris
	const all: [string, string, string][] = [
		...p.ops.map((o): [string, string, string] => {
			const pre = `${o.neg ? "sans " : ""}${o.key === "tag" ? "#" : `${o.key}:`}`;
			return [pre + o.value, pre + (o.key === "tag" ? o.display : o.value), o.raw];
		}),
		...p.phrases.map((x): [string, string, string] => [`« ${x.text} »`, `« ${x.display} »`, x.raw]),
		...p.exclude.map((x): [string, string, string] => [`sans ${x.text}`, `sans ${x.display}`, x.raw]),
	];
	for (const [key, label, raw] of all) {
		const c = out.get(key);
		if (c) c.raws.push(raw); else out.set(key, { label, raws: [raw] });
	}
	return [...out.values()];
}

/** La requête demande les favoris (`is:fav`, non nié). */
export const wantsFav = (p: Parsed) => p.ops.some((o) => o.key === "is" && o.value === "fav" && !o.neg);

/** Valeurs repliées des opérateurs `key` non niés de la requête : état des facettes. */
export const activeValues = (p: Parsed, key: Op["key"]): Set<string> => new Set(p.ops.filter((o) => o.key === key && !o.neg).map((o) => o.value));

const token = (key: Op["key"], value: string) => (key === "tag" ? (/[\s"]/.test(value) ? `tag:"${value.replace(/"/g, "")}"` : `#${value}`) : `${key}:${value}`);

/**
 * Bascule une facette dans la saisie : active → retire tous ses jetons ; inactive → l'ajoute en fin de saisie.
 * `type` et `status` sont à choix unique (deux valeurs en ET ne donnent jamais rien) : choisir l'une remplace l'autre.
 * `tag` et `is` s'additionnent (ET).
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

/** Retire tous les filtres (opérateurs) de la saisie, en gardant le texte cherché. */
export const clearOps = (q: string) => parseQuery(q).ops.reduce((s, o) => removeToken(s, o.raw), q).trim();

/** Un problème de la requête : le message, les jetons fautifs et le libellé de la correction (retirer ces jetons). */
export type Issue = { text: string; raws: string[]; fix: string };
const VALID: Record<"type" | "status" | "is", readonly string[]> = { type: TYPE_VALUES, status: STATUS_VALUES, is: IS_VALUES };
const VALID_LABEL = { type: "concept, entity, synthesis, source", status: "draft, stable, deprecated", is: "fav, unverified, review, partial" } as const;

/**
 * Opérateurs reconnus mais inutilisables : valeur inconnue, deux valeurs exclusives en ET, filtre et son contraire,
 * tag qu'aucune page ne porte (`knownTags` : tags repliés, si on les connaît). Chaque problème nomme les jetons à retirer :
 * on distingue ainsi une faute de saisie d'une requête valide qui ne trouve simplement rien.
 */
export function diagnose(p: Parsed, knownTags?: Set<string>): Issue[] {
	const out: Issue[] = [];
	for (const o of p.ops) {
		if (o.key === "tag") {
			if (!o.neg && knownTags && !knownTags.has(o.value)) out.push({ text: `Aucune page n'a le tag « ${o.display} ».`, raws: [o.raw], fix: `Retirer #${o.display}` });
		} else if (!VALID[o.key].includes(o.value)) {
			out.push({ text: `« ${o.key}:${o.display} » n'existe pas : valeurs possibles ${VALID_LABEL[o.key]}.`, raws: [o.raw], fix: `Retirer ${o.key}:${o.display}` });
		}
	}
	for (const key of ["type", "status"] as const) {
		const vs = p.ops.filter((o) => o.key === key && !o.neg && VALID[key].includes(o.value));
		const distinct = [...new Set(vs.map((o) => o.value))];
		if (distinct.length > 1) {
			const first = vs[0].value;
			out.push({
				text: `Les filtres s'additionnent (ET) : une page n'a qu'un ${key === "type" ? "type" : "statut"}, ${distinct.map((v) => `${key}:${v}`).join(" et ")} ensemble ne donnent rien.`,
				raws: vs.filter((o) => o.value !== first).map((o) => o.raw),
				fix: `Garder ${key}:${first} seulement`,
			});
		}
	}
	for (const o of p.ops) {
		if (o.neg) continue;
		const opposite = p.ops.find((x) => x.neg && x.key === o.key && x.value === o.value);
		if (opposite) out.push({ text: `« ${o.raw} » et « ${opposite.raw} » se contredisent.`, raws: [opposite.raw], fix: `Retirer ${opposite.raw}` });
	}
	return out;
}

export type Doc = { id: string; title: string; description: string; type: string; tags: string[]; status: string; verified: boolean; needsReview?: boolean; partial?: boolean; text: string };

/** Les filtres structurés, les phrases et les exclusions sur les métadonnées et le texte (le texte libre reste à l'index). `hay` : texte replié précalculé. */
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
