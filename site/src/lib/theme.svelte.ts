// Thème : suit le système par défaut ; la palette de commandes peut forcer clair ou sombre (mémorisé dans localStorage).
const KEY = "brain:theme";
const MODES = ["system", "dark", "light"] as const;
type Mode = (typeof MODES)[number];
let mode = $state<Mode>("system");

const apply = () => {
	if (mode === "system") document.documentElement.removeAttribute("data-theme");
	else document.documentElement.setAttribute("data-theme", mode);
	window.dispatchEvent(new Event("themechange")); // le graphe relit ses couleurs
};

export const theme = {
	get mode() { return mode; },
	get label() { return { system: "système", dark: "sombre", light: "clair" }[mode]; },
	init() { try { const v = localStorage.getItem(KEY); if (v === "dark" || v === "light") mode = v; } catch { /* ignoré */ } },
	cycle() {
		mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
		try { mode === "system" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, mode); } catch { /* ignoré */ }
		apply();
	},
};
