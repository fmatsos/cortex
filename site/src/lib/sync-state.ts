/**
 * What a signed-in account keeps for the visitor (`GET/PUT /api/me/state`): the preferences that live in the browser,
 * theme, interface language and favorites. Pure functions: the stores that hold the values are read and written in
 * account.svelte.ts (`collectLocal` / `applyLocal`), so collecting and merging never live anywhere else.
 * Not kept: the recent searches (a history, not a preference), the assistant panel's width and the offline-mode marker
 * (per device).
 */
export type SyncState = { theme: "system" | "dark" | "light"; lang: "system" | "en" | "fr"; favs: string[] };

const THEMES: readonly string[] = ["system", "dark", "light"];
const LANGS: readonly string[] = ["system", "en", "fr"];
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The recognised, valid fields of what the server holds; anything else (other keys, wrong types) is ignored. */
export function readServer(raw: unknown): Partial<SyncState> {
	if (!isObject(raw)) return {};
	const out: Partial<SyncState> = {};
	if (typeof raw.theme === "string" && THEMES.includes(raw.theme)) out.theme = raw.theme as SyncState["theme"];
	if (typeof raw.lang === "string" && LANGS.includes(raw.lang)) out.lang = raw.lang as SyncState["lang"];
	if (Array.isArray(raw.favs)) out.favs = [...new Set(raw.favs.filter((x): x is string => typeof x === "string" && x !== ""))];
	return out;
}

/**
 * First contact of a signed-in browser with its account. A server that holds nothing we know (the account's first
 * synchronisation) takes the local state; otherwise the server wins for theme and language, and the favorites are the union
 * of both (server order first), so nothing is ever lost. `push`: the result differs from what the server holds, send it.
 */
export function plan(local: SyncState, serverRaw: unknown): { apply: SyncState; push: boolean } {
	const s = readServer(serverRaw);
	if (s.theme === undefined && s.lang === undefined && s.favs === undefined) return { apply: local, push: true };
	const favs = [...new Set([...(s.favs ?? []), ...local.favs])];
	const apply: SyncState = { theme: s.theme ?? local.theme, lang: s.lang ?? local.lang, favs };
	return { apply, push: s.theme === undefined || s.lang === undefined || s.favs === undefined || favs.length !== s.favs.length };
}

/** The body of a `PUT`: the whole object, the keys we do not know (a newer front end) kept as the server has them. */
export const toBody = (serverRaw: unknown, state: SyncState): Record<string, unknown> => ({ ...(isObject(serverRaw) ? serverRaw : {}), ...state });

/** Stable text of a state, to tell whether it changed since the last send. */
export const stateKey = (s: SyncState): string => JSON.stringify([s.theme, s.lang, s.favs]);
