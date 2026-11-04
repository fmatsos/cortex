// Theme: follows the system by default; the command palette can force light or dark (remembered in localStorage).
const KEY = "brain:theme";
const MODES = ["system", "dark", "light"] as const;
export type Mode =(typeof MODES)[number];
let mode = $state<Mode>("system");

const apply = () => {
	if (mode === "system") document.documentElement.removeAttribute("data-theme");
	else document.documentElement.setAttribute("data-theme", mode);
	window.dispatchEvent(new Event("themechange")); // the graph re-reads its colors
};

export const theme = {
	get mode() { return mode; },
	get label() { return { system: "système", dark: "sombre", light: "clair" }[mode]; },
	init() { try { const v = localStorage.getItem(KEY); if (v === "dark" || v === "light") mode = v; } catch { /* ignored */ } },
	cycle() { this.set(MODES[(MODES.indexOf(mode) + 1) % MODES.length]); },
	/** Explicit choice (header selector); "system" removes `data-theme` and follows the system. */
	set(m: Mode) {
		mode = m;
		try { mode === "system" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, mode); } catch { /* ignored */ }
		apply();
	},
};
