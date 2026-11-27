/**
 * What a signed-in account keeps for the visitor (`GET/PUT /api/me/state`): the preferences that live in the browser,
 * theme, interface language, reading comfort (the two options of the preferences menu) and favorites. Pure functions: the stores that hold the values are read and written in
 * account.svelte.ts (`collectLocal` / `applyLocal`), so collecting and merging never live anywhere else.
 * Under `/s/<space>/` the favorites are the space's own (`/s/<space>/api/me/state`, `{ favs }`) and the other four stay at the root
 * (`prefsOf`, `joinServer`): the two never overwrite each other. Without a space prefix everything stays in the one object.
 * Not kept: the recent searches (a history, not a preference), the assistant panel's width and the offline-mode marker
 * (per device).
 */
export type SyncState = { theme: "system" | "dark" | "light"; lang: "system" | "en" | "fr"; reading: boolean; comfort: boolean; favs: string[] };

const THEMES: readonly string[] = ["system", "dark", "light"];
const LANGS: readonly string[] = ["system", "en", "fr"];
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The recognised, valid fields of what the server holds; anything else (other keys, wrong types) is ignored. */
export function readServer(raw: unknown): Partial<SyncState> {
	if (!isObject(raw)) return {};
	const out: Partial<SyncState> = {};
	if (typeof raw.theme === "string" && THEMES.includes(raw.theme)) out.theme = raw.theme as SyncState["theme"];
	if (typeof raw.lang === "string" && LANGS.includes(raw.lang)) out.lang = raw.lang as SyncState["lang"];
	if (typeof raw.reading === "boolean") out.reading = raw.reading;
	if (typeof raw.comfort === "boolean") out.comfort = raw.comfort;
	if (Array.isArray(raw.favs)) out.favs = [...new Set(raw.favs.filter((x): x is string => typeof x === "string" && x !== ""))];
	return out;
}

/**
 * First contact of a signed-in browser with its account. A server that holds nothing we know (the account's first
 * synchronisation) takes the local state; otherwise the server wins for theme, language and reading comfort (a key it does not
 * hold yet is completed from the local state: an account that predates the reading options), and the favorites are the union
 * of both (server order first), so nothing is ever lost. `push`: the result differs from what the server holds, send it.
 */
export function plan(local: SyncState, serverRaw: unknown): { apply: SyncState; push: boolean } {
	const s = readServer(serverRaw);
	if (Object.keys(s).length === 0) return { apply: local, push: true };
	const favs = [...new Set([...(s.favs ?? []), ...local.favs])];
	const apply: SyncState = { theme: s.theme ?? local.theme, lang: s.lang ?? local.lang, reading: s.reading ?? local.reading, comfort: s.comfort ?? local.comfort, favs };
	return { apply, push: (Object.keys(apply) as (keyof SyncState)[]).some((k) => s[k] === undefined) || favs.length !== s.favs!.length };
}

/** The body of a `PUT`: the whole object, the keys we do not know (a newer front end) kept as the server has them. */
export const toBody = (serverRaw: unknown, state: Partial<SyncState>): Record<string, unknown> => ({ ...(isObject(serverRaw) ? serverRaw : {}), ...state });

/** Stable text of a state, to tell whether it changed since the last send. */
export const stateKey = (s: SyncState): string => JSON.stringify([s.theme, s.lang, s.reading, s.comfort, s.favs]);

/** The preferences kept at the root of the server when the favorites are a space's own (the four of the account). */
export type Prefs = Omit<SyncState, "favs">;
export const prefsOf = ({ favs: _favs, ...prefs }: SyncState): Prefs => prefs;
/**
 * What `plan` reads when the account's state and the space's favorites are two objects: the root's preferences (its old `favs`
 * key, from before the favorites were per space, is not read) and the favorites of the space.
 */
export function joinServer(root: unknown, space: unknown): Record<string, unknown> {
	const { favs: _legacy, ...prefs } = isObject(root) ? root : ({} as Record<string, unknown>);
	return { ...prefs, ...(isObject(space) && Array.isArray(space.favs) ? { favs: space.favs } : {}) };
}
/** Stable text of the preferences alone / of the favorites alone, to tell which of the two objects changed. */
export const prefsKey = (s: SyncState): string => JSON.stringify([s.theme, s.lang, s.reading, s.comfort]);
export const favsKey = (s: SyncState): string => JSON.stringify(s.favs);
