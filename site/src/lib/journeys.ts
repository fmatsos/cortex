import { api } from "./api";
import { serializeRoute } from "./journey";

/** A saved graph journey (`route`: the page ids, in order; dates are ISO strings). */
export type Journey = { id: string; title: string; route: string[]; created_at: string; updated_at: string };

export const listJourneys = (signal?: AbortSignal) => api<{ journeys: Journey[] }>("/api/journeys", { signal }).then((r) => r.journeys);
export const getJourney = (id: string) => api<Journey>(`/api/journeys/${encodeURIComponent(id)}`);
export const renameJourney = (id: string, title: string) => api<Journey>(`/api/journeys/${encodeURIComponent(id)}`, { method: "PUT", body: { title } });
export const removeJourney = (id: string) => api(`/api/journeys/${encodeURIComponent(id)}`, { method: "DELETE" });

/** The first save of the journey on the graph page (title: the visitor's, else the server names it after its first and last pages). */
export const createJourney = (title: string | undefined, route: readonly string[]) => api<Journey>("/api/journeys", { method: "POST", body: { title, route } });
/** Replaces the route of a saved journey (its title is kept). */
export const updateJourney = (id: string, route: readonly string[]) => api<Journey>(`/api/journeys/${encodeURIComponent(id)}`, { method: "PUT", body: { route } });

/**
 * The query string that opens a journey on the graph page (`?view=journey&route=…`), built like the graph page itself writes
 * it. `id` (a saved journey) links the page to its saved copy: Save then updates that copy and says whether it is up to date.
 */
export const journeyQuery = (route: readonly string[], id?: string): string => new URLSearchParams({ view: "journey", route: serializeRoute(route), ...(id ? { journey: id } : {}) }).toString();

/**
 * What the account page can do with a saved journey: export it as Markdown (`registerJourneyActions`, once, from the layout);
 * until it is registered the button stays inactive. A result with `partial` says the file was written but the content of
 * some pages could not be loaded.
 */
export const journeyActions: { export?: (id: string) => Promise<{ partial?: boolean } | void> } = {};
export const exportJourney = (id: string) => journeyActions.export?.(id);
/** Plugs the export in, once, from the layout. The Markdown writer is loaded when it is first used. */
export const registerJourneyActions = () => { journeyActions.export = async (id) => (await import("./journey-session")).exportSaved(id); };
