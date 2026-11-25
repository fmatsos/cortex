// Reading comfort: two local preferences, off by default (nothing changes unless the reader opts in), kept in this browser
// like the theme. They only set an attribute on <html>; app.css and the assistant panel size the text from it. The same
// attributes are set before first paint by the inline script of app.html, so there is no jump on load.
import { storageKey } from "./storage";

const KEYS = { reading: storageKey("reading"), comfort: storageKey("assistant-comfort") };
const ATTR = { reading: "data-reading", comfort: "data-assistant-comfort" };
type Which = keyof typeof KEYS;

let on = $state<Record<Which, boolean>>({ reading: false, comfort: false });

function set(which: Which, value: boolean, store = true) {
	on[which] = value;
	document.documentElement.toggleAttribute(ATTR[which], value);
	if (!store) return;
	try { value ? localStorage.setItem(KEYS[which], "1") : localStorage.removeItem(KEYS[which]); } catch { /* per-viewer convenience only */ }
}

export const reading = {
	/** "Lecture": larger text and a narrower measure on articles. */
	get article() { return on.reading; },
	/** "Texte confortable": larger body text for the assistant's answers. */
	get assistant() { return on.comfort; },
	/** Browser side, once (the header menu mounts it; the inline script of app.html has already set the attributes). */
	init() {
		for (const which of ["reading", "comfort"] as const) {
			try { set(which, localStorage.getItem(KEYS[which]) === "1", false); } catch { /* storage blocked: defaults */ }
		}
	},
	setArticle(value: boolean) { set("reading", value); },
	setAssistant(value: boolean) { set("comfort", value); },
};
