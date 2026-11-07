// UI language of the exported site. The default is `language` of cortex.json, resolved by `cortex export` (src/export.ts)
// and injected at build time as __CORTEX_LOCALE__ (site/vite.config.ts): the prerendered HTML is in that language.
// Both dictionaries ship with the site; a visitor may switch (header selector, palette), see lang.svelte.ts.
import en from "./en.json";
import fr from "./fr.json";

export type Locale = "en" | "fr";
export type Dict = Record<string, string>;
export const LOCALES = ["en", "fr"] as const satisfies readonly Locale[];
export const DICTS: Record<Locale, Dict> = { en, fr };
/** Name of each locale in its own language (language selector). */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", fr: "Français" };

declare const __CORTEX_LOCALE__: string | undefined;
/** Locale of the export (cortex.json `language`): the prerendered HTML and the "default" choice. */
export const defaultLocale: Locale = typeof __CORTEX_LOCALE__ === "string" && __CORTEX_LOCALE__ === "fr" ? "fr" : "en";

let current: Locale = defaultLocale;
/** Locale in force; changed only by the language selector (browser side). */
export const getLocale = (): Locale => current;
export const setLocale = (l: Locale) => { current = l; };

/** Visitor's stored choice (`cortex:lang`) → locale: "en" or "fr" win; anything else (absent, "system", garbage) is the export's default. */
export const chooseLocale = (stored: string | null | undefined, fallback: Locale = defaultLocale): Locale =>
	stored === "en" || stored === "fr" ? stored : fallback;

/** BCP 47 tag for Intl (dates, numbers, plural rules). */
export const intlLocale = (l: Locale = current) => (l === "fr" ? "fr-FR" : "en-US");

/** Base keys: a plural pair `x_one` / `x_other` is called as `t("x", { count })`. */
type Base<K> = K extends `${infer B}_one` | `${infer B}_other` ? B : K;
export type Key = Base<keyof typeof en>;
export type Vars = Record<string, string | number>;

/** `{name}` placeholders filled from `vars`; with a numeric `count`, picks `key_one` / `key_other` by the plural rules. */
export function translate(dict: Dict, l: Locale, key: string, vars: Vars = {}): string {
	let s = dict[key];
	if (s === undefined && typeof vars.count === "number") s = dict[`${key}_${new Intl.PluralRules(intlLocale(l)).select(vars.count) === "one" ? "one" : "other"}`];
	if (s === undefined) return key; // a missing key shows itself instead of breaking the page (the key-parity test catches it)
	return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? (typeof vars[k] === "number" ? (vars[k] as number).toLocaleString(intlLocale(l)) : String(vars[k])) : m));
}

/** Translation in the locale in force. Call it at render time (not at module load): the visitor may switch language. */
export const t = (key: Key, vars?: Vars): string => translate(DICTS[current], current, key, vars);
