// Language of the interface (never of the wiki content): the export's default (cortex.json `language`) unless the visitor
// picked one in the header or the palette, remembered in localStorage like the theme.
import { storageKey } from "./storage";
import { chooseLocale, defaultLocale, setLocale, type Locale } from "./i18n/index";

const KEY = storageKey("lang");
export type LangChoice = "system" | Locale;
export const LANG_CHOICES = ["system", "en", "fr"] as const satisfies readonly LangChoice[];

let choice = $state<LangChoice>("system");
let current = $state<Locale>(defaultLocale);

const apply = () => {
	const l = chooseLocale(choice);
	setLocale(l);
	current = l; // the layout re-renders under {#key lang.current}: every t() and Intl format follows
	document.documentElement.lang = l;
};

export const lang = {
	get choice() { return choice; },
	get current() { return current; },
	/** To call once on the browser side (not at prerender). */
	init() {
		try { const v = localStorage.getItem(KEY); if (v === "en" || v === "fr") choice = v; } catch { /* ignored */ }
		if (choice !== "system") apply();
	},
	/** Next choice (palette command): default → English → Français → default. */
	cycle() { this.set(LANG_CHOICES[(LANG_CHOICES.indexOf(choice) + 1) % LANG_CHOICES.length]); },
	set(c: LangChoice) {
		choice = c;
		try { c === "system" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, c); } catch { /* ignored */ }
		apply();
	},
};
