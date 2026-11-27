import { api } from "./api";
import { spaceApi } from "./space";

/** Saved journeys belong to a space (`spaceApi`, like the conversations). A saved graph journey (`route`: the page ids, in order; dates are ISO strings). */
export type Journey = { id: string; title: string; route: string[]; created_at: string; updated_at: string };

export const listJourneys = (signal?: AbortSignal) => api<{ journeys: Journey[] }>(spaceApi("/api/journeys"), { signal }).then((r) => r.journeys);
export const getJourney = (id: string) => api<Journey>(spaceApi(`/api/journeys/${encodeURIComponent(id)}`));
export const renameJourney = (id: string, title: string) => api<Journey>(spaceApi(`/api/journeys/${encodeURIComponent(id)}`), { method: "PUT", body: { title } });
export const removeJourney = (id: string) => api(spaceApi(`/api/journeys/${encodeURIComponent(id)}`), { method: "DELETE" });

/** The first save of the journey on the graph page (title: the visitor's, else the server names it after its first and last pages). */
export const createJourney = (title: string | undefined, route: readonly string[]) => api<Journey>(spaceApi("/api/journeys"), { method: "POST", body: { title, route } });
/** Replaces the route of a saved journey (its title is kept). */
export const updateJourney = (id: string, route: readonly string[]) => api<Journey>(spaceApi(`/api/journeys/${encodeURIComponent(id)}`), { method: "PUT", body: { route } });

/**
 * What the account page can do with a saved journey: export it as Markdown (`registerJourneyActions`, once, from the layout);
 * until it is registered the button stays inactive. A result with `partial` says the file was written but the content of
 * some pages could not be loaded.
 */
export const journeyActions: { export?: (id: string) => Promise<{ partial?: boolean } | void> } = {};
export const exportJourney = (id: string) => journeyActions.export?.(id);
/** Plugs the export in, once, from the layout. The Markdown writer is loaded when it is first used. */
export const registerJourneyActions = () => { journeyActions.export = async (id) => (await import("./journey-session")).exportSaved(id); };
